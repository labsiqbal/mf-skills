// The 9:16 centring pass: render the move at 8 sampled times, take the union
// of the foreground ink boxes, and when its centre sits 2% of the height or
// more off the frame centre, write a vertical offset into vars.json (and the
// page's inline copy), keeping the content 120 px (at 1080 wide) from the edges.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Engine } from '../engine/index';
import { screenshot, seek, withPage } from '../media/chrome';
import { type Frame, frameAt } from '../media/pixels';
import { type VarsDoc, replaceInlineVars } from './build/move';
import { parseHex } from './oklch';
import type { Rect } from './safe';

export const CENTRE = {
  samples: 8,
  /** Re-centre when the content centre is this fraction of the height off. */
  minOffsetFraction: 0.02,
  /** Distance kept from the top and bottom edges, in px at 1080 wide. */
  edgeMarginPx: 120,
  /** A pixel is ink when a channel differs from the ground by more than this (frame0.inkMin's delta). */
  inkDelta: 24,
} as const;

/** Sample times: the middles of 8 equal slices of the duration. */
export function centreTimes(durationSec: number, samples: number = CENTRE.samples): number[] {
  return Array.from({ length: samples }, (_, i) => Math.round(((i + 0.5) * durationSec * 1000) / samples) / 1000);
}

/** Bounding box of the pixels that differ from `ground` (or, with ground null, of non-transparent pixels). */
export function inkBox(frame: Frame, ground: readonly number[] | null, delta: number = CENTRE.inkDelta): Rect | null {
  if (frame.format !== 'rgba') throw new Error('inkBox needs an rgba frame');
  let x0 = frame.width;
  let y0 = frame.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const i = (y * frame.width + x) * 4;
      const ink = ground
        ? Math.abs((frame.data[i] ?? 0) - (ground[0] ?? 0)) > delta || Math.abs((frame.data[i + 1] ?? 0) - (ground[1] ?? 0)) > delta || Math.abs((frame.data[i + 2] ?? 0) - (ground[2] ?? 0)) > delta
        : (frame.data[i + 3] ?? 0) > delta;
      if (!ink) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The smallest rectangle holding every box. */
export function unionBox(boxes: Array<Rect | null>): Rect | null {
  const real = boxes.filter((box): box is Rect => box !== null);
  if (real.length === 0) return null;
  const x0 = Math.min(...real.map((box) => box.x));
  const y0 = Math.min(...real.map((box) => box.y));
  const x1 = Math.max(...real.map((box) => box.x + box.width));
  const y1 = Math.max(...real.map((box) => box.y + box.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The vertical offset that centres `union` in the frame, or 0 when it is
 * already within 2% of the height; clamped so the content keeps the edge margin.
 */
export function centringOffset(union: Rect | null, frame: { width: number; height: number }): number {
  if (!union) return 0;
  const off = frame.height / 2 - (union.y + union.height / 2);
  if (Math.abs(off) < CENTRE.minOffsetFraction * frame.height) return 0;
  const margin = (CENTRE.edgeMarginPx * frame.width) / 1080;
  // The farthest the content may move up and down while staying the margin from the edges.
  const up = Math.min(0, margin - union.y);
  const down = Math.max(0, frame.height - margin - (union.y + union.height));
  const clamped = Math.max(up, Math.min(down, off));
  return Math.round(clamped);
}

export interface CentreResult {
  offsetPx: number;
  union: Rect | null;
  boxes: Array<Rect | null>;
  times: number[];
}

/**
 * Measure a built move (its offset at 0) and write the offset into
 * assets/vars.json and the page's inline vars. Only full-frame 9:16 moves are
 * centred; others return offset 0 untouched.
 */
export async function centreMove(buildDir: string, options: { engine?: Engine; browserPath?: string; entry?: string } = {}): Promise<CentreResult> {
  const varsFile = path.join(buildDir, 'assets', 'vars.json');
  const doc = JSON.parse(readFileSync(varsFile, 'utf8')) as VarsDoc;
  const times = centreTimes(doc.ctx.durationSec);
  if (doc.ctx.aspect !== '9:16') return { offsetPx: 0, union: null, boxes: [], times };
  const entry = options.entry ?? 'index.html';
  const pagePath = path.join(buildDir, entry);
  // Measure from the uncentred layout.
  const measured = { ...doc, ctx: { ...doc.ctx, centreOffsetPx: 0 } };
  const original = readFileSync(pagePath, 'utf8');
  writeFileSync(pagePath, replaceInlineVars(original, measured));
  const ground = doc.ctx.mode === 'alpha' ? null : doc.ctx.mode === 'key' && doc.ctx.keyColor ? parseHex(doc.ctx.keyColor) : null;
  const work = mkdtempSync(path.join(tmpdir(), 'mfm-centre-'));
  try {
    const boxes = await withPage(
      { dir: buildDir, entry, width: doc.ctx.width, height: doc.ctx.height, ...(options.engine ? { engine: options.engine } : {}), ...(options.browserPath ? { browserPath: options.browserPath } : {}) },
      async (page) => {
        // Full mode: the ground is the brand ground, read from the root's computed background.
        const groundHex = ground ? null : await page.evaluate(() => getComputedStyle(document.getElementById('mf-root') as HTMLElement).backgroundColor);
        const groundRgb = ground ?? (groundHex ? (groundHex.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number) : null);
        const found: Array<Rect | null> = [];
        for (const [i, time] of times.entries()) {
          await seek(page, time);
          const file = path.join(work, `${i}.png`);
          writeFileSync(file, await screenshot(page, doc.ctx.mode === 'alpha' ? { omitBackground: true } : {}));
          found.push(inkBox(await frameAt(file, 0, { format: 'rgba' }), doc.ctx.mode === 'alpha' ? null : groundRgb));
        }
        return found;
      },
    );
    const union = unionBox(boxes);
    const offsetPx = centringOffset(union, { width: doc.ctx.width, height: doc.ctx.height });
    const next: VarsDoc = { ...doc, ctx: { ...doc.ctx, centreOffsetPx: offsetPx } };
    writeFileSync(varsFile, `${JSON.stringify(next, null, 2)}\n`);
    writeFileSync(pagePath, replaceInlineVars(original, next));
    return { offsetPx, union, boxes, times };
  } catch (error) {
    writeFileSync(pagePath, original);
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Cards and UI surfaces (MFM-026): every surface builds and renders in 16:9,
// 9:16 and 1:1 for the three demo brands with zero lint errors, stays inside
// the frame-safe box, keeps contrast.textMin for every text against what is
// behind it, enters at `at` and leaves at `out`; builds are byte-stable; the
// press, tick, caret and progress states animate; piece CSS holds no literal
// colours or pixel sizes.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../../../../src/engine/index';
import { html } from '../../../../../src/kit/build/html';
import { flat } from '../../../../../src/kit/build/materials';
import { type Composition, type MoveCtx, moveCtx, writeMoveBuild } from '../../../../../src/kit/build/move';
import { SURFACE_IDS, SURFACES, type SurfaceId } from '../../../../../src/kit/build/surfaces';
import { type AspectKey, NUMBERS } from '../../../../../src/kit/numbers';
import { lint } from '../../../../../src/lint/index';
import { screenshot, seek, withPage } from '../../../../../src/media/chrome';
import { contrastRatio, relativeLuminance } from '../../../../../src/media/pixels';
import { audit } from '../../../../../src/quality/audit';
import { testBrowser } from '../../../../helpers/engine';
import { buildRuntime, packageRoot } from '../../type/page';

const BRANDS = ['tessarine', 'mossmallow', 'quillfen'] as const;
const ASPECTS: AspectKey[] = ['16:9', '9:16', '1:1'];
const WIDTH = { '16:9': 960, '9:16': 540, '1:1': 720 } as Record<AspectKey, number>;
const DURATION = 2.4;
const AT = 0.3;
const OUT = 1.8;
const brandDoc = (id: string) => JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', id, 'brand.json'), 'utf8'));
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

let engine: Engine;
let browserPath = '';

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

function build(surface: SurfaceId, aspect: AspectKey, brand: string) {
  const ctx = moveCtx({ aspect, mode: 'full', layer: 'broll', brand: brandDoc(brand), seed: 4, durationSec: DURATION, width: WIDTH[aspect] });
  const ground = flat(ctx);
  const piece = SURFACES[surface](ctx, { id: 'piece', xU: 24, yU: 24, at: AT, out: OUT });
  const composition: Composition = {
    id: `surface-${surface}`,
    html: html`${ground.html}${piece.html}`,
    css: `${ground.css}\n${piece.css}`,
    script: piece.script,
    assets: [],
    needsThree: false,
    holds: [],
  };
  const dir = mkdtempSync(path.join(tmpdir(), `mfm-surface-${surface}-`));
  writeMoveBuild(dir, ctx, composition, {}, { engineDir: engine.dir });
  return { ctx, dir, piece };
}

interface Measured {
  box: { x: number; y: number; width: number; height: number };
  opacity: { before: number; after: number; gone: number };
  contrasts: Array<{ text: string; contrast: number }>;
}

/** Box, entrance and exit opacity, and each static text's contrast against the pixels behind it. */
async function measure(dir: string, ctx: MoveCtx): Promise<Measured> {
  return withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page, session) => {
    const opacityAt = async (sec: number) => {
      await seek(page, sec);
      return page.evaluate(() => Number(getComputedStyle(document.getElementById('piece') as HTMLElement).opacity));
    };
    const before = await opacityAt(AT - 0.1);
    const gone = await opacityAt(OUT + 0.5);
    const after = await opacityAt(1.3);
    const texts = await page.evaluate(() => {
      const piece = document.getElementById('piece') as HTMLElement;
      const rect = piece.getBoundingClientRect();
      return {
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        texts: [...piece.querySelectorAll<HTMLElement>('[data-mf-static]')].map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent ?? '', color: getComputedStyle(el).color, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
        }),
      };
    });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-mf-static]')) el.style.visibility = 'hidden';
    });
    const png = Buffer.from(await screenshot(page)).toString('base64');
    const contrasts: Measured['contrasts'] = [];
    for (const entry of texts.texts) {
      const pixels = await page.evaluate(
        async (src: string, region: { x: number; y: number; width: number; height: number }) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const c = canvas.getContext('2d') as CanvasRenderingContext2D;
          c.drawImage(image, 0, 0);
          const data = c.getImageData(Math.floor(region.x), Math.floor(region.y), Math.max(1, Math.ceil(region.width)), Math.max(1, Math.ceil(region.height))).data;
          const out: number[] = [];
          for (let i = 0; i < data.length; i += 4) out.push(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
          return out;
        },
        `data:image/png;base64,${png}`,
        entry.box,
      );
      const [r, g, b] = (entry.color.match(/\d+/g) ?? []).map(Number);
      const ink = relativeLuminance(r ?? 0, g ?? 0, b ?? 0);
      const lums = pixels.map((v) => relativeLuminance((v >> 16) & 255, (v >> 8) & 255, v & 255)).sort((x, y) => x - y);
      const at = (q: number) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))] ?? 0;
      contrasts.push({ text: entry.text, contrast: Math.min(contrastRatio(ink, at(0.05)), contrastRatio(ink, at(0.95))) });
    }
    expect(session.errors).toEqual([]);
    return { box: texts.box, opacity: { before, after, gone }, contrasts };
  });
}

describe('surfaces stories', () => {
  for (const surface of SURFACE_IDS) {
    it(`${surface}: 3 aspects x 3 brands build, lint clean, inside the frame-safe box, readable, on time`, async () => {
      for (const aspect of ASPECTS) {
        for (const brand of BRANDS) {
          const { ctx, dir } = build(surface, aspect, brand);
          const label = `${surface} ${aspect} ${brand}`;
          expect(lint(dir, { profile: 'broll' }).errors, label).toEqual([]);
          const m = await measure(dir, ctx);
          const frame = ctx.safe.frame;
          expect(m.box.x, label).toBeGreaterThanOrEqual(frame.x - 1);
          expect(m.box.y, label).toBeGreaterThanOrEqual(frame.y - 1);
          expect(m.box.x + m.box.width, label).toBeLessThanOrEqual(frame.x + frame.width + 1);
          expect(m.box.y + m.box.height, label).toBeLessThanOrEqual(frame.y + frame.height + 1);
          expect(m.opacity.before, `${label} before entrance`).toBeLessThan(0.05);
          expect(m.opacity.after, `${label} after entrance`).toBeGreaterThan(0.95);
          expect(m.opacity.gone, `${label} after exit`).toBeLessThan(0.05);
          for (const { text, contrast } of m.contrasts) expect(contrast, `${label} "${text}"`).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
        }
      }
    }, 900_000);
  }

  it('the frame audit finds no hard hit for any surface (16:9, Mossmallow)', async () => {
    for (const surface of SURFACE_IDS) {
      const { dir } = build(surface, '16:9', 'mossmallow');
      const result = await audit(dir, { profile: 'broll', engine, browserPath });
      expect(result.hard, `${surface}: ${JSON.stringify(result.hits)}`).toBe(0);
    }
  }, 900_000);

  it('builds twice to the same HTML', () => {
    for (const surface of SURFACE_IDS) {
      const a = build(surface, '1:1', 'tessarine');
      const b = build(surface, '1:1', 'tessarine');
      expect(sha(readFileSync(path.join(a.dir, 'index.html'))), surface).toBe(sha(readFileSync(path.join(b.dir, 'index.html'))));
    }
  });

  it('the button presses, the row ticks, the caret blinks and the progress bar fills, by transform and opacity', async () => {
    const probe = async (surface: SurfaceId, selector: string, times: number[]) => {
      const { ctx, dir } = build(surface, '16:9', 'quillfen');
      return withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
        const out: Array<{ transform: string; opacity: string }> = [];
        for (const time of times) {
          await seek(page, time);
          out.push(await page.evaluate((sel: string) => {
            const style = getComputedStyle(document.querySelector(sel) as HTMLElement);
            return { transform: style.transform, opacity: style.opacity };
          }, selector));
        }
        return out;
      });
    };
    const pressed = await probe('button', '.mf-s-press', [1.0, AT + 0.9 + 0.08, 1.6]);
    const plain = (transform: string | undefined) => (transform === 'matrix(1, 0, 0, 1, 0, 0)' ? 'none' : transform);
    expect(plain(pressed[1]?.transform)).not.toBe('none');
    expect(plain(pressed[0]?.transform)).toBe('none');
    expect(plain(pressed[2]?.transform)).toBe('none');
    const ticked = await probe('row', '.mf-s-mark', [0.9, 1.6]);
    expect(Number(ticked[0]?.opacity)).toBeLessThan(0.05);
    expect(Number(ticked[1]?.opacity)).toBeGreaterThan(0.95);
    const caret = await probe('input', '.mf-s-caret', [0.6, 0.9, 1.4]);
    expect(caret.map((entry) => entry.opacity)).toEqual(['1', '0', '1']);
    const bar = await probe('progress', '.mf-s-fill', [0.4, 1.7]);
    expect(bar[0]?.transform).not.toBe(bar[1]?.transform);
  }, 600_000);

  it('piece CSS holds no literal hex, rgb( or pixel size other than 0 px and 1 px', () => {
    const ctx = moveCtx({ aspect: '16:9', mode: 'full', layer: 'broll', brand: brandDoc('mossmallow'), seed: 1, durationSec: DURATION, width: 960 });
    for (const surface of SURFACE_IDS) {
      const { css } = SURFACES[surface](ctx);
      expect(css, surface).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, surface).not.toMatch(/\brgba?\(/);
      for (const match of css.matchAll(/(\d*\.?\d+)px/g)) expect(['0', '1'], `${surface}: ${match[0]}`).toContain(match[1]);
    }
  });
});

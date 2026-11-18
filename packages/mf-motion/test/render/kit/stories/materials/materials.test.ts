// Materials and grounds (MFM-025): every piece builds and renders in 16:9, 9:16
// and 1:1 for the three demo brands with zero lint errors; a title set over it
// stays inside the frame-safe box (frame audit) and keeps contrast.textMin
// against the material; builds are byte-stable; paper and grain draw the same
// frame for the same seed; riso steps at 12 fps; the ribbon field follows its
// intensity; piece CSS holds no literal colours or pixel sizes.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../../../../src/engine/index';
import { html } from '../../../../../src/kit/build/html';
import { MATERIAL_IDS, MATERIALS, type MaterialId, type Piece, flat, ribbons, stack } from '../../../../../src/kit/build/materials';
import { type Composition, type MoveCtx, moveCtx, writeMoveBuild } from '../../../../../src/kit/build/move';
import { line } from '../../../../../src/kit/build/type';
import { NUMBERS } from '../../../../../src/kit/numbers';
import type { AspectKey } from '../../../../../src/kit/numbers';
import { lint } from '../../../../../src/lint/index';
import { screenshot, seek, withPage } from '../../../../../src/media/chrome';
import { contrastRatio, relativeLuminance } from '../../../../../src/media/pixels';
import { audit } from '../../../../../src/quality/audit';
import { testBrowser } from '../../../../helpers/engine';
import { buildRuntime, packageRoot } from '../../type/page';

const BRANDS = ['tessarine', 'mossmallow', 'quillfen'] as const;
const ASPECTS: AspectKey[] = ['16:9', '9:16', '1:1'];
const WIDTH: Record<AspectKey, number> = { '16:9': 960, '9:16': 540, '1:1': 720 } as Record<AspectKey, number>;
const DURATION = 2;
const brandDoc = (id: string) => JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', id, 'brand.json'), 'utf8'));
/** Pieces that cover the frame with their own ground; the others sit on a flat ground. */
const OPAQUE = new Set<MaterialId>(['flat', 'radial', 'dots', 'lines', 'paper']);

let engine: Engine;
let browserPath = '';

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

function storyComposition(ctx: MoveCtx, piece: Piece, id: string): Composition {
  const title = line({ text: 'Traces for every run', role: 'title', in: 'rise@0.2', out: 'end', className: 'story-title', id: 'title' });
  return {
    id,
    html: html`${piece.html}${title}`,
    css: `${piece.css}
.story-title { position: absolute; left: var(--mf-safe-l); top: var(--mf-safe-t); max-width: calc(100% - var(--mf-safe-l) - var(--mf-safe-r)); font-family: var(--mf-font-display); font-weight: 700; font-size: calc(var(--mf-u) * 64); line-height: 1.1; color: var(--mf-ink); }`,
    script: piece.script,
    assets: [],
    needsThree: false,
    holds: [],
  };
}

function build(material: MaterialId, aspect: AspectKey, brand: string, seed = 7) {
  const ctx = moveCtx({ aspect, mode: 'full', layer: 'broll', brand: brandDoc(brand), seed, durationSec: DURATION, width: WIDTH[aspect] });
  const piece = OPAQUE.has(material) ? MATERIALS[material](ctx) : stack([flat(ctx), MATERIALS[material](ctx)]);
  const dir = mkdtempSync(path.join(tmpdir(), `mfm-mat-${material}-`));
  writeMoveBuild(dir, ctx, storyComposition(ctx, piece, `mat-${material}`), {}, { engineDir: engine.dir });
  return { ctx, dir, piece };
}

const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** Luminance of every pixel of a PNG region, via the page itself (no decoder needed). */
async function titleContrast(dir: string, ctx: MoveCtx): Promise<{ contrast: number; box: { x: number; y: number; width: number; height: number } }> {
  return withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page, session) => {
    await seek(page, 1.2);
    const box = await page.evaluate(() => {
      const rect = (document.getElementById('title') as HTMLElement).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.evaluate(() => {
      (document.getElementById('title') as HTMLElement).style.visibility = 'hidden';
    });
    const png = await screenshot(page);
    const lum = await page.evaluate(
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
        const values: number[] = [];
        for (let i = 0; i < data.length; i += 4) values.push(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
        return values;
      },
      `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      box,
    );
    expect(session.errors).toEqual([]);
    const ink = ctx.brand.colors.ink.replace('#', '');
    const inkLum = relativeLuminance(Number.parseInt(ink.slice(0, 2), 16), Number.parseInt(ink.slice(2, 4), 16), Number.parseInt(ink.slice(4, 6), 16));
    const lums = lum.map((v) => relativeLuminance((v >> 16) & 255, (v >> 8) & 255, v & 255)).sort((a, b) => a - b);
    // The background pixels closest to the ink colour decide (5th / 95th percentile, not single specks).
    const at = (q: number) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))] ?? 0;
    const contrast = Math.min(contrastRatio(inkLum, at(0.05)), contrastRatio(inkLum, at(0.95)));
    return { contrast, box };
  });
}

async function frameHash(dir: string, ctx: MoveCtx, sec: number): Promise<string> {
  return withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
    await seek(page, sec);
    return sha(await screenshot(page));
  });
}

describe('materials stories', () => {
  for (const material of MATERIAL_IDS) {
    it(`${material}: 3 aspects x 3 brands build, lint clean, title inside the frame-safe box with contrast`, async () => {
      for (const aspect of ASPECTS) {
        for (const brand of BRANDS) {
          const { ctx, dir } = build(material, aspect, brand);
          const label = `${material} ${aspect} ${brand}`;
          expect(lint(dir, { profile: 'broll' }).errors, label).toEqual([]);
          const { contrast, box } = await titleContrast(dir, ctx);
          expect(contrast, `${label} contrast`).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
          const frame = ctx.safe.frame;
          expect(box.x, label).toBeGreaterThanOrEqual(frame.x - 1);
          expect(box.y, label).toBeGreaterThanOrEqual(frame.y - 1);
          expect(box.x + box.width, label).toBeLessThanOrEqual(frame.x + frame.width + 1);
          expect(box.y + box.height, label).toBeLessThanOrEqual(frame.y + frame.height + 1);
        }
      }
    }, 900_000);
  }

  it('the frame audit finds no hard hit and times the title entrance (16:9, Tessarine, every piece)', async () => {
    for (const material of MATERIAL_IDS) {
      const { ctx, dir } = build(material, '16:9', 'tessarine');
      const result = await audit(dir, { profile: 'broll', engine, browserPath });
      expect(result.hard, `${material}: ${JSON.stringify(result.hits)}`).toBe(0);
      const title = result.lines.find((entry) => JSON.stringify(entry).includes('title'));
      expect(title, material).toBeDefined();
      expect(ctx.durationSec).toBe(DURATION);
    }
  }, 900_000);

  it('builds twice to the same HTML', () => {
    for (const material of MATERIAL_IDS) {
      const a = build(material, '9:16', 'quillfen');
      const b = build(material, '9:16', 'quillfen');
      expect(sha(readFileSync(path.join(a.dir, 'index.html'))), material).toBe(sha(readFileSync(path.join(b.dir, 'index.html'))));
    }
  });

  it('paper and grain draw the same frame twice for the same seed, another frame for another seed', async () => {
    for (const material of ['paper', 'grain'] as const) {
      const a = build(material, '1:1', 'mossmallow', 11);
      const b = build(material, '1:1', 'mossmallow', 11);
      const c = build(material, '1:1', 'mossmallow', 12);
      const first = await frameHash(a.dir, a.ctx, 1);
      expect(await frameHash(b.dir, b.ctx, 1), material).toBe(first);
      expect(await frameHash(c.dir, c.ctx, 1), material).not.toBe(first);
    }
  }, 600_000);

  it('riso steps at 12 fps: frames inside one step match, the next step differs', async () => {
    const { ctx, dir } = build('riso', '16:9', 'tessarine');
    // The riso canvas alone (the title is still entering): 0.50 s and 0.53 s are both step 6; 0.60 s is step 7.
    const canvasAt = (secs: number[]) =>
      withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
        const out: string[] = [];
        for (const sec of secs) {
          await seek(page, sec);
          out.push(await page.evaluate(() => (document.getElementById('mat-riso') as HTMLCanvasElement).toDataURL()));
        }
        return out.map((url) => sha(url));
      });
    const [a, b, c, again] = await canvasAt([0.5, 0.5 + 1 / 30, 0.6, 0.5]);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(again).toBe(a);
  }, 600_000);

  it('the ribbon field follows its intensity key', async () => {
    const ctx = moveCtx({ aspect: '16:9', mode: 'full', layer: 'broll', brand: brandDoc('tessarine'), seed: 3, durationSec: DURATION, width: 960 });
    const keyed = ribbons(ctx, { intensity: 0, keys: [{ at: 0.5, intensity: 1, duration: 0.5 }] });
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-mat-ribbons-key-'));
    writeMoveBuild(dir, ctx, storyComposition(ctx, stack([flat(ctx), keyed]), 'mat-ribbons-key'), {}, { engineDir: engine.dir });
    expect(keyed.script).toContain('intensity: 1');
    const amplitude = async (sec: number) =>
      withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
        await seek(page, sec);
        return page.evaluate(() => {
          const canvas = document.getElementById('mat-ribbons') as HTMLCanvasElement;
          const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0;
          for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) painted += 1;
          return painted / (canvas.width * canvas.height);
        });
      });
    const calm = await amplitude(0.2);
    const full = await amplitude(1.5);
    expect(full).toBeGreaterThan(calm * 1.3);
  }, 600_000);

  it('piece CSS holds no literal hex, rgb( or pixel size other than 0 px and 1 px', () => {
    const ctx = moveCtx({ aspect: '16:9', mode: 'full', layer: 'broll', brand: brandDoc('tessarine'), seed: 1, durationSec: DURATION, width: 960 });
    for (const material of MATERIAL_IDS) {
      const { css } = MATERIALS[material](ctx);
      expect(css, material).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, material).not.toMatch(/\brgba?\(/);
      for (const match of css.matchAll(/(\d*\.?\d+)px/g)) expect(['0', '1'], `${material}: ${match[0]}`).toContain(match[1]);
    }
  });
});

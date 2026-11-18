// Device frames (MFM-028): every device builds and renders in 16:9, 9:16 and
// 1:1 for the three demo brands with zero lint errors, stays inside the
// frame-safe box and enters and leaves on time; screens show an image, a
// 12 fps image stack or a kit sub-tree with readable text; the three.js
// devices draw on WebGL (swiftshader) from their CanvasTexture screen; builds
// are byte-stable; piece CSS holds no literal colours or pixel sizes.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Engine, render } from '../../../../../src/engine/index';
import { inkBox } from '../../../../../src/kit/centre';
import { parseHex } from '../../../../../src/kit/oklch';
import { frameAt } from '../../../../../src/media/pixels';
import { DEVICE_IDS, DEVICES, type DeviceId, type Screen, needsThree } from '../../../../../src/kit/build/devices';
import { html } from '../../../../../src/kit/build/html';
import { flat } from '../../../../../src/kit/build/materials';
import { type Composition, moveCtx, writeMoveBuild } from '../../../../../src/kit/build/move';
import { type AspectKey, NUMBERS } from '../../../../../src/kit/numbers';
import { lint } from '../../../../../src/lint/index';
import { screenshot, seek, withPage } from '../../../../../src/media/chrome';
import { contrastRatio, relativeLuminance } from '../../../../../src/media/pixels';
import { testBrowser } from '../../../../helpers/engine';
import { buildRuntime, packageRoot } from '../../type/page';

const BRANDS = ['tessarine', 'mossmallow', 'quillfen'] as const;
const ASPECTS: AspectKey[] = ['16:9', '9:16', '1:1'];
const WIDTH = { '16:9': 960, '9:16': 540, '1:1': 720 } as Record<AspectKey, number>;
const DURATION = 2.4;
const AT = 0.3;
const OUT = 1.8;
const brandDir = (id: string) => path.join(packageRoot, 'assets', 'demo-brands', id);
const brandDoc = (id: string) => JSON.parse(readFileSync(path.join(brandDir(id), 'brand.json'), 'utf8'));
const shots = (id: string) => [1, 2, 3, 4].map((n) => path.join(brandDir(id), 'shots', `shot-${n}.png`));
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
/** Device widths that fit each aspect's copy box. */
const WIDTH_U: Record<DeviceId, Partial<Record<AspectKey, number>>> = {
  phone: {}, tablet: { '9:16': 420 }, laptop: { '9:16': 560, '1:1': 640 }, browser: { '9:16': 560, '1:1': 640 }, laptop3d: { '9:16': 560, '1:1': 640 }, phone3d: { '9:16': 420 },
};

let engine: Engine;
let browserPath = '';

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

function screenFor(device: DeviceId, brand: string, variant: number): Screen {
  if (needsThree(device)) return variant % 2 === 0 ? { kind: 'image', file: shots(brand)[0] as string } : { kind: 'stack', files: shots(brand) };
  if (variant === 0) return { kind: 'image', file: shots(brand)[0] as string };
  if (variant === 1) return { kind: 'stack', files: shots(brand) };
  return {
    kind: 'tree',
    html: html`<div class="tree"><span class="tree-title" data-mf-static>Run #4821</span><span class="tree-body" data-mf-static>3.2 s</span></div>`,
    css: '.tree { position: absolute; inset: 0; padding: calc(var(--mf-u) * 28); background: var(--mf-surface); display: flex; flex-direction: column; gap: calc(var(--mf-u) * 8); } .tree-title { font-family: var(--mf-font-heading); font-weight: 700; font-size: calc(var(--mf-u) * 34); color: var(--mf-ink); } .tree-body { font-size: calc(var(--mf-u) * 26); color: var(--mf-muted); }',
  };
}

function build(device: DeviceId, aspect: AspectKey, brand: string, variant = 0) {
  const ctx = moveCtx({ aspect, mode: 'full', layer: 'broll', brand: brandDoc(brand), seed: 2, durationSec: DURATION, width: WIDTH[aspect] });
  const ground = flat(ctx);
  const piece = DEVICES[device](ctx, { id: 'piece', xU: 20, yU: 20, at: AT, out: OUT, screen: screenFor(device, brand, variant), ...(WIDTH_U[device][aspect] ? { widthU: WIDTH_U[device][aspect] } : {}) });
  const composition: Composition = { id: `device-${device}`, html: html`${ground.html}${piece.html}`, css: `${ground.css}\n${piece.css}`, script: piece.script, assets: [], needsThree: needsThree(device), holds: [] };
  const dir = mkdtempSync(path.join(tmpdir(), `mfm-device-${device}-`));
  writeMoveBuild(dir, ctx, composition, {}, { engineDir: engine.dir });
  return { ctx, dir };
}

/**
 * three.js devices render through the engine, which serves the build over
 * HTTP; a file:// page (withPage) cannot load the three module. Frames are
 * measured: nothing before the entrance, the device inside the frame-safe box
 * after it, nothing after the exit, and a painted screen.
 */
async function renderedDevice(dir: string, ctx: { width: number; height: number; brand: { colors: { ground: string } }; safe: { frame: { x: number; y: number; width: number; height: number } } }) {
  const out = path.join(dir, 'frames');
  await render(engine, dir, { format: 'png-sequence', fps: '30', output: out });
  const files = readdirSync(out).filter((name) => name.endsWith('.png')).sort();
  const ground = parseHex(ctx.brand.colors.ground);
  const boxAt = async (sec: number) => inkBox(await frameAt(path.join(out, files[Math.round(sec * 30)] as string), 0, { format: 'rgba' }), ground);
  return { frames: files.length, before: await boxAt(AT - 0.1), during: await boxAt(1.2), after: await boxAt(OUT + 0.5) };
}

describe('device stories', () => {
  for (const device of DEVICE_IDS.filter((id) => needsThree(id))) {
    it(`${device}: 3 aspects x 3 brands build, lint clean, render through the engine inside the frame-safe box, on time`, async () => {
      let variant = 0;
      for (const aspect of ASPECTS) {
        for (const brand of BRANDS) {
          const { ctx, dir } = build(device, aspect, brand, variant % 2);
          const label = `${device} ${aspect} ${brand}`;
          variant += 1;
          expect(lint(dir, { profile: 'broll' }).errors, label).toEqual([]);
          const m = await renderedDevice(dir, ctx);
          expect(m.frames, label).toBe(Math.round(DURATION * 30));
          expect(m.before, `${label} before entrance`).toBeNull();
          expect(m.after, `${label} after exit`).toBeNull();
          expect(m.during, `${label} drawn`).not.toBeNull();
          const box = m.during as { x: number; y: number; width: number; height: number };
          const frame = ctx.safe.frame;
          expect(box.width * box.height, `${label} device area`).toBeGreaterThan(ctx.width * ctx.height * 0.03);
          expect(box.x, label).toBeGreaterThanOrEqual(frame.x - 1);
          expect(box.y, label).toBeGreaterThanOrEqual(frame.y - 1);
          expect(box.x + box.width, label).toBeLessThanOrEqual(frame.x + frame.width + 1);
          expect(box.y + box.height, label).toBeLessThanOrEqual(frame.y + frame.height + 1);
        }
      }
    }, 1_800_000);
  }

  for (const device of DEVICE_IDS.filter((id) => !needsThree(id))) {
    it(`${device}: 3 aspects x 3 brands build, lint clean, inside the frame-safe box, on time, screen drawn`, async () => {
      let variant = 0;
      for (const aspect of ASPECTS) {
        for (const brand of BRANDS) {
          const { ctx, dir } = build(device, aspect, brand, variant % 3);
          const label = `${device} ${aspect} ${brand} screen ${variant % 3}`;
          variant += 1;
          expect(lint(dir, { profile: 'broll' }).errors, label).toEqual([]);
          const m = await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath, webgl: needsThree(device) }, async (page, session) => {
            const opacityAt = async (sec: number) => {
              await seek(page, sec);
              return page.evaluate(() => Number(getComputedStyle(document.getElementById('piece') as HTMLElement).opacity));
            };
            const before = await opacityAt(AT - 0.1);
            const gone = await opacityAt(OUT + 0.5);
            const after = await opacityAt(1.2);
            const info = await page.evaluate(() => {
              const piece = document.getElementById('piece') as HTMLElement;
              const r = piece.getBoundingClientRect();
              const gl = piece.querySelector('canvas.mf-d-gl') as HTMLCanvasElement | null;
              let painted = -1;
              if (gl) {
                const probe = document.createElement('canvas');
                probe.width = gl.width;
                probe.height = gl.height;
                const c = probe.getContext('2d') as CanvasRenderingContext2D;
                c.drawImage(gl, 0, 0);
                const data = c.getImageData(0, 0, gl.width, gl.height).data;
                painted = 0;
                for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) painted += 1;
                painted /= gl.width * gl.height;
              }
              const shots = [...piece.querySelectorAll<HTMLImageElement>('img.mf-d-shot')].map((img) => img.complete && img.naturalWidth > 0);
              return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, painted, shots, three: Boolean((window as unknown as { mfThree?: unknown }).mfThree) };
            });
            expect(session.errors, label).toEqual([]);
            return { before, after, gone, ...info };
          });
          const frame = ctx.safe.frame;
          expect(m.box.x, label).toBeGreaterThanOrEqual(frame.x - 1);
          expect(m.box.y, label).toBeGreaterThanOrEqual(frame.y - 1);
          expect(m.box.x + m.box.width, label).toBeLessThanOrEqual(frame.x + frame.width + 1);
          expect(m.box.y + m.box.height, label).toBeLessThanOrEqual(frame.y + frame.height + 1);
          expect(m.before, label).toBeLessThan(0.05);
          expect(m.after, label).toBeGreaterThan(0.95);
          expect(m.gone, label).toBeLessThan(0.05);
          expect(m.shots.every(Boolean), `${label} images loaded`).toBe(true);
        }
      }
    }, 900_000);
  }

  it('a kit sub-tree screen keeps contrast.textMin for its text', async () => {
    for (const brand of BRANDS) {
      const { ctx, dir } = build('tablet', '16:9', brand, 2);
      const contrasts = await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
        await seek(page, 1.2);
        return page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('#piece [data-mf-static]')].map((el) => {
            const bg = getComputedStyle(el.parentElement as HTMLElement).backgroundColor;
            return { color: getComputedStyle(el).color, bg };
          }),
        );
      });
      for (const { color, bg } of contrasts) {
        const lum = (css: string) => {
          const [r, g, b] = (css.match(/\d+(\.\d+)?/g) ?? []).map(Number);
          return relativeLuminance(r ?? 0, g ?? 0, b ?? 0);
        };
        expect(contrastRatio(lum(color), lum(bg)), `${brand} ${color} on ${bg}`).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
      }
    }
  }, 600_000);

  it('an image stack steps at 12 fps on a CSS screen', async () => {
    const { ctx, dir } = build('phone', '16:9', 'mossmallow', 1);
    const visible = await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
      const at = async (sec: number) => {
        await seek(page, sec);
        return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#piece .mf-d-shot')].findIndex((img) => getComputedStyle(img).visibility === 'visible'));
      };
      // Seeks land on 30 fps frames; steps fall every 1/12 s from 0.3 s.
      return [await at(9 / 30), await at(12 / 30), await at(15 / 30), await at(30 / 30)];
    });
    expect(visible).toEqual([0, 1, 2, 0]);
  }, 600_000);

  it('builds twice to the same HTML', () => {
    for (const device of DEVICE_IDS) {
      const a = build(device, '1:1', 'quillfen');
      const b = build(device, '1:1', 'quillfen');
      expect(sha(readFileSync(path.join(a.dir, 'index.html'))), device).toBe(sha(readFileSync(path.join(b.dir, 'index.html'))));
    }
  });

  it('piece CSS holds no literal hex, rgb( or pixel size other than 0 px and 1 px, and no brand-shaped details', () => {
    const ctx = moveCtx({ aspect: '16:9', mode: 'full', layer: 'broll', brand: brandDoc('tessarine'), seed: 1, durationSec: DURATION, width: 960 });
    for (const device of DEVICE_IDS) {
      const { css, html: markup } = DEVICES[device](ctx, { screen: { kind: 'image', file: shots('tessarine')[0] as string } });
      expect(css, device).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, device).not.toMatch(/\brgba?\(/);
      for (const match of css.matchAll(/(\d*\.?\d+)px/g)) expect(['0', '1'], `${device}: ${match[0]}`).toContain(match[1]);
      expect(`${css} ${markup.value}`, device).not.toMatch(/notch|dynamic.island|apple|iphone|macbook|ipad|galaxy|pixel\b/i);
    }
  });
});

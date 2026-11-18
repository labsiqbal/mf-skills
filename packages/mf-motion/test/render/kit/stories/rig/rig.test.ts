// Cursor and camera (MFM-029): the cursor follows its path, squashes to 0.86
// for 80 ms on a click, lifts what it hovers and draws its selection box; the
// camera pushes, orbits, whips with directional blur, racks focus, dives and
// drifts by seed; every story builds and renders in 16:9, 9:16 and 1:1 for the
// three demo brands with zero lint errors, inside the frame-safe box, with
// readable text; builds are byte-stable; piece CSS holds no literal colours or
// pixel sizes.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../../../../src/engine/index';
import { html } from '../../../../../src/kit/build/html';
import { flat } from '../../../../../src/kit/build/materials';
import { type Composition, type MoveCtx, moveCtx, writeMoveBuild } from '../../../../../src/kit/build/move';
import { CAMERA, CURSOR, type CameraSpec, camera, cursor } from '../../../../../src/kit/build/rig';
import { button, card } from '../../../../../src/kit/build/surfaces';
import { type AspectKey, NUMBERS } from '../../../../../src/kit/numbers';
import { lint } from '../../../../../src/lint/index';
import { seek, withPage } from '../../../../../src/media/chrome';
import { contrastRatio, relativeLuminance } from '../../../../../src/media/pixels';
import { testBrowser } from '../../../../helpers/engine';
import { buildRuntime, packageRoot } from '../../type/page';

const BRANDS = ['tessarine', 'mossmallow', 'quillfen'] as const;
const ASPECTS: AspectKey[] = ['16:9', '9:16', '1:1'];
const WIDTH = { '16:9': 960, '9:16': 540, '1:1': 720 } as Record<AspectKey, number>;
const DURATION = 3.6;
const brandDoc = (id: string) => JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', id, 'brand.json'), 'utf8'));
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

let engine: Engine;
let browserPath = '';

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

const ctxFor = (aspect: AspectKey, brand: string, seed = 5) => moveCtx({ aspect, mode: 'full', layer: 'broll', brand: brandDoc(brand), seed, durationSec: DURATION, width: WIDTH[aspect] });

function write(ctx: MoveCtx, id: string, body: ReturnType<typeof html>, css: string, script: string): string {
  const ground = flat(ctx);
  const composition: Composition = { id, html: html`${ground.html}${body}`, css: `${ground.css}\n${css}`, script, assets: [], needsThree: false, holds: [] };
  const dir = mkdtempSync(path.join(tmpdir(), `mfm-rig-${id}-`));
  writeMoveBuild(dir, ctx, composition, {}, { engineDir: engine.dir });
  return dir;
}

function cursorStory(ctx: MoveCtx): string {
  const target = button(ctx, { id: 'btn', xU: 40, yU: 260, at: 0.1 });
  const panel = card(ctx, { id: 'panel', xU: 40, yU: 20, at: 0.1, widthU: 420 });
  const pointer = cursor(ctx, {
    path: [{ at: 0, xU: 380, yU: 520 }, { at: 1.0, xU: 120, yU: 300 }, { at: 1.8, xU: 70, yU: 50 }, { at: 2.6, xU: 420, yU: 170 }],
    clicks: [1.1],
    hovers: [{ selector: '#btn', from: 1.0, to: 1.5 }],
    select: { from: 1.9, to: 2.6, xU: 60, yU: 40, widthU: 360, heightU: 130 },
  });
  return write(ctx, 'rig-cursor-story', html`${panel.html}${target.html}${pointer.html}`, `${panel.css}\n${target.css}\n${pointer.css}`, [panel.script, target.script, pointer.script].join('\n'));
}

function cameraStory(ctx: MoveCtx, moves: CameraSpec[], rack = false): string {
  const subject = html`<div class="subject" id="subject"><span class="subject-title" data-mf-static>Run #4821</span><span class="subject-body" data-mf-static>14 spans, 3.2 s</span></div>`;
  const css = `.subject { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: calc(var(--mf-u) * 24) calc(var(--mf-u) * 30); background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); display: flex; flex-direction: column; gap: calc(var(--mf-u) * 6); }
.subject-title { font-family: var(--mf-font-heading); font-weight: 700; font-size: calc(var(--mf-u) * 34); color: var(--mf-ink); white-space: nowrap; }
.subject-body { font-size: calc(var(--mf-u) * 24); color: var(--mf-muted); white-space: nowrap; }
.layer-near, .layer-far { position: absolute; top: 40%; font-family: var(--mf-font-heading); font-weight: 700; font-size: calc(var(--mf-u) * 40); color: var(--mf-ink); }
.layer-near { left: 12%; } .layer-far { right: 12%; }`;
  const rig = camera(ctx, rack ? html`` : subject, {
    moves,
    ...(rack ? { near: html`<span class="layer-near" data-mf-static>Near</span>`, far: html`<span class="layer-far" data-mf-static>Far</span>` } : {}),
  });
  return write(ctx, 'rig-camera-story', rig.html, `${rig.css}\n${css}`, rig.script);
}

const STORY_MOVES: CameraSpec[] = [{ kind: 'drift', from: 0, to: 'end' }, { kind: 'push', at: 0.4, scale: 1.4 }, { kind: 'orbit', at: 1.2 }, { kind: 'whip', at: 2.8 }];

/** Text boxes inside a selector and the contrast of each against its parent's background. */
async function texts(page: Parameters<Parameters<typeof withPage>[1]>[0], selector: string) {
  return page.evaluate((sel: string) => {
    const parse = (css: string) => (css.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    return [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      let bgEl: HTMLElement | null = el;
      let bg = 'rgba(0, 0, 0, 0)';
      while (bgEl) {
        bg = getComputedStyle(bgEl).backgroundColor;
        if (!/rgba\(.*, 0\)$/.test(bg)) break;
        bgEl = bgEl.parentElement;
      }
      if (!bgEl) bg = getComputedStyle(document.querySelector('.mf-mat-flat') as HTMLElement).backgroundColor;
      return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, color: parse(getComputedStyle(el).color), bg: parse(bg) };
    });
  }, selector);
}

const lum = (rgb: number[]) => relativeLuminance(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
const inside = (box: { x: number; y: number; width: number; height: number }, frame: { x: number; y: number; width: number; height: number }) =>
  box.x >= frame.x - 1 && box.y >= frame.y - 1 && box.x + box.width <= frame.x + frame.width + 1 && box.y + box.height <= frame.y + frame.height + 1;

describe('rig stories', () => {
  it('cursor: 3 aspects x 3 brands, lint clean, inside the frame-safe box, squash 0.86 for 80 ms, hover, selection box', async () => {
    for (const aspect of ASPECTS) {
      for (const brand of BRANDS) {
        const ctx = ctxFor(aspect, brand);
        const dir = cursorStory(ctx);
        const label = `cursor ${aspect} ${brand}`;
        expect(lint(dir, { profile: 'broll' }).errors, label).toEqual([]);
        await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page, session) => {
          const state = async (sec: number) => {
            await seek(page, sec);
            return page.evaluate(() => {
              const c = document.querySelector('#rig-cursor .mf-r-cursor') as HTMLElement;
              const r = c.getBoundingClientRect();
              const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
              const sel = document.querySelector('#rig-cursor .mf-r-select') as HTMLElement;
              const btn = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('btn') as HTMLElement).transform);
              return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, scale: Math.hypot(m.a, m.b), sel: { w: sel.getBoundingClientRect().width, h: sel.getBoundingClientRect().height, visible: getComputedStyle(sel).visibility }, btnY: btn.f };
            });
          };
          for (const sec of [0.2, 1.0, 1.6, 2.4, 3.2]) expect(inside((await state(sec)).box, ctx.safe.frame), `${label} at ${sec}`).toBe(true);
          expect((await state(1.1 + CURSOR.squashMs / 2000)).scale, `${label} squash`).toBeCloseTo(CURSOR.squash, 2);
          expect((await state(1.1 + CURSOR.squashMs / 1000 + 0.02)).scale, `${label} back`).toBeCloseTo(1, 2);
          expect((await state(1.3)).btnY, `${label} hover lift`).toBeLessThan(0);
          const selected = await state(3.0);
          expect(selected.sel.visible, label).toBe('visible');
          expect(selected.sel.w, label).toBeCloseTo(360 * ctx.u, 0);
          expect(selected.sel.h, label).toBeCloseTo(130 * ctx.u, 0);
          await seek(page, 1.6);
          for (const text of await texts(page, '#btn [data-mf-static], #panel [data-mf-static]')) {
            expect(contrastRatio(lum(text.color), lum(text.bg)), label).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
            expect(inside(text.box, ctx.safe.frame), label).toBe(true);
          }
          expect(session.errors, label).toEqual([]);
        });
      }
    }
  }, 900_000);

  it('camera: 3 aspects x 3 brands, lint clean; push, orbit and whip land; text readable and inside the box at rest', async () => {
    for (const aspect of ASPECTS) {
      for (const brand of BRANDS) {
        const ctx = ctxFor(aspect, brand);
        const dir = cameraStory(ctx, STORY_MOVES);
        const label = `camera ${aspect} ${brand}`;
        expect(lint(dir, { profile: 'broll' }).errors, label).toEqual([]);
        await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page, session) => {
          const stage = async (sec: number) => {
            await seek(page, sec);
            return page.evaluate(() => {
              const s = document.querySelector('#rig-camera .mf-r-stage') as HTMLElement;
              const style = getComputedStyle(s);
              const m = new DOMMatrix(style.transform);
              return { m: [m.m11, m.m13, m.m41], filter: style.filter };
            });
          };
          const pushed = await stage(1.15);
          expect(pushed.m[0], `${label} push`).toBeCloseTo(1.4, 2);
          await seek(page, 1.15);
          for (const text of await texts(page, '#subject [data-mf-static]')) {
            expect(inside(text.box, ctx.safe.frame), `${label} after push`).toBe(true);
            expect(contrastRatio(lum(text.color), lum(text.bg)), label).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
          }
          const orbited = await stage(2.6);
          expect(Math.abs(orbited.m[1] ?? 0), `${label} orbit turns on y`).toBeGreaterThan(0.05);
          const whipping = await stage(2.8 + CAMERA.whipSec / 2);
          expect(whipping.filter, `${label} whip blur`).toMatch(/url\(.*mf-cam-whip/);
          const whipped = await stage(3.5);
          expect(whipped.m[2], `${label} whip travel`).toBeCloseTo(-CAMERA.whipTravelPx * ctx.u, 0);
          expect(session.errors, label).toEqual([]);
        });
      }
    }
  }, 900_000);

  it('rack focus swaps blur and opacity between near and far; dive scales up and fades', async () => {
    const ctx = ctxFor('16:9', 'quillfen');
    const dir = cameraStory(ctx, [{ kind: 'rack', at: 0.5 }, { kind: 'dive', at: 2.5 }], true);
    expect(lint(dir, { profile: 'broll' }).errors).toEqual([]);
    await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
      const read = async (sec: number) => {
        await seek(page, sec);
        return page.evaluate(() => {
          const near = getComputedStyle(document.querySelector('.mf-r-near') as HTMLElement);
          const far = getComputedStyle(document.querySelector('.mf-r-far') as HTMLElement);
          const stage = getComputedStyle(document.querySelector('.mf-r-stage') as HTMLElement);
          return { near: [near.filter, Number(near.opacity)], far: [far.filter, Number(far.opacity)], scale: new DOMMatrix(stage.transform).m11, opacity: Number(stage.opacity) };
        });
      };
      const before = await read(0.2);
      expect(before.far[0]).toMatch(/blur/);
      expect(Number(before.far[1])).toBeCloseTo(NUMBERS['motion.dofBlurPx'].opacity.min / 2 + NUMBERS['motion.dofBlurPx'].opacity.max / 2, 2);
      const after = await read(1.5);
      expect(after.near[0]).toMatch(/blur\([1-9]/);
      expect(after.far[1]).toBe(1);
      const dived = await read(3.4);
      expect(dived.scale).toBeGreaterThan(NUMBERS['motion.diveScale'].min);
      expect(dived.opacity).toBeLessThan(0.05);
    });
  }, 600_000);

  it('drift is seeded: the same seed gives the same wander, another seed another', async () => {
    const at = async (seed: number) => {
      const ctx = ctxFor('1:1', 'mossmallow', seed);
      const dir = cameraStory(ctx, [{ kind: 'drift', from: 0, to: 'end' }]);
      return withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page) => {
        await seek(page, 2);
        return page.evaluate(() => getComputedStyle(document.querySelector('.mf-r-drift') as HTMLElement).transform);
      });
    };
    const a = await at(7);
    expect(await at(7)).toBe(a);
    expect(await at(8)).not.toBe(a);
    expect(a).not.toBe('none');
  }, 600_000);

  it('builds twice to the same HTML and piece CSS holds no literal hex, rgb( or pixel size beyond 0 and 1 px', () => {
    const ctx = ctxFor('9:16', 'tessarine');
    expect(sha(readFileSync(path.join(cursorStory(ctx), 'index.html')))).toBe(sha(readFileSync(path.join(cursorStory(ctx), 'index.html'))));
    expect(sha(readFileSync(path.join(cameraStory(ctx, STORY_MOVES), 'index.html')))).toBe(sha(readFileSync(path.join(cameraStory(ctx, STORY_MOVES), 'index.html'))));
    const pieces = [cursor(ctx, { path: [{ at: 0, xU: 0, yU: 0 }], select: { from: 0, to: 1, xU: 0, yU: 0, widthU: 10, heightU: 10 } }).css, camera(ctx, html``, { moves: STORY_MOVES }).css];
    for (const css of pieces) {
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\brgba?\(/);
      for (const match of css.matchAll(/(\d*\.?\d+)px/g)) expect(['0', '1']).toContain(match[1]);
    }
    expect(() => cursor(ctx, { path: [{ at: 'bar1+', xU: 0, yU: 0 }] })).toThrow();
  });
});

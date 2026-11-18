// Moves built from kit pieces in every mode: an alpha render starts
// transparent, key mode keeps the content clear of the key colour with hard
// edges, a top-heavy 9:16 move is re-centred, and mf.done refuses a
// registration id that is not the composition id.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Engine, render } from '../../../../src/engine/index';
import { html } from '../../../../src/kit/build/html';
import { type Composition, type MoveCtx, type MoveMode, moveCtx, writeMoveBuild } from '../../../../src/kit/build/move';
import { line } from '../../../../src/kit/build/type';
import { CENTRE, centreMove, inkBox, unionBox } from '../../../../src/kit/centre';
import { NUMBERS } from '../../../../src/kit/numbers';
import { parseHex } from '../../../../src/kit/oklch';
import { screenshot, seek, withPage } from '../../../../src/media/chrome';
import { frameAt } from '../../../../src/media/pixels';
import { testBrowser } from '../../../helpers/engine';
import { buildRuntime, packageRoot } from '../type/page';

const mossmallow = JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', 'mossmallow', 'brand.json'), 'utf8'));
const DURATION = 3;

let engine: Engine;
let browserPath = '';

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

/** A card with a title line: enters at 0.3 s, leaves before the end; soft shadow and a blurred glass strip. */
function cardMove(ctx: MoveCtx, id = 'demo-card'): Composition {
  return {
    id,
    html: html`<div class="card" id="card"><div class="glass"></div>${line({ text: 'Plants watered', role: 'title', in: 'rise@0.4', out: 'end', className: 'card-title' })}</div>`,
    css: `
.card { position: absolute; left: 0; top: 0; width: calc(var(--mf-u) * 640); height: calc(var(--mf-u) * 300); background: var(--mf-surface); border-radius: calc(var(--mf-u) * 24); box-shadow: var(--mf-shadow-box); }
.glass { position: absolute; left: calc(var(--mf-u) * 40); right: calc(var(--mf-u) * 40); bottom: calc(var(--mf-u) * 40); height: calc(var(--mf-u) * 60); border-radius: calc(var(--mf-u) * 12); background: var(--mf-accent-soft); backdrop-filter: blur(calc(var(--mf-u) * 22)); filter: blur(calc(var(--mf-u) * 2)); }
.card-title { position: absolute; left: calc(var(--mf-u) * 40); top: calc(var(--mf-u) * 60); font-family: var(--mf-font-display); font-size: calc(var(--mf-u) * 64); font-weight: 700; color: var(--mf-ink); }
`,
    script: `tl.from('#card', { opacity: 0, y: 40 * ctx.u, duration: 0.5 }, 0.3);\n  tl.to('#card', { opacity: 0, duration: 0.4 }, ctx.durationSec - 0.6);`,
    assets: [],
    needsThree: false,
    holds: [],
  };
}

function build(aspect: '16:9' | '9:16', mode: MoveMode, layer: 'overlay' | 'broll' = 'overlay') {
  const ctx = moveCtx({ aspect, mode, layer, brand: mossmallow, seed: 5, durationSec: DURATION, width: aspect === '9:16' ? 540 : 960 });
  const dir = mkdtempSync(path.join(tmpdir(), `mfm-move-${mode}-`));
  writeMoveBuild(dir, ctx, cardMove(ctx), { title: 'Plants watered' }, { engineDir: engine.dir });
  return { ctx, dir };
}

const pixel = (frame: { data: Uint8Array; width: number }, x: number, y: number) => Array.from(frame.data.subarray((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));

describe('move runtime', () => {
  it('alpha mode renders a transparent first frame', async () => {
    const { ctx, dir } = build('16:9', 'alpha');
    const frames = path.join(dir, 'master');
    await render(engine, dir, { format: 'png-sequence', fps: ctx.fps, output: frames });
    const files = readdirSync(frames).filter((name) => name.endsWith('.png')).sort();
    expect(files.length).toBe(DURATION * 30);
    const first = await frameAt(path.join(frames, files[0] as string), 0, { format: 'rgba' });
    let opaque = 0;
    for (let i = 3; i < first.data.length; i += 4) if ((first.data[i] ?? 0) > 0) opaque += 1;
    expect(opaque).toBe(0);
    // The card is on screen mid-move.
    const middle = await frameAt(path.join(frames, files[45] as string), 0, { format: 'rgba' });
    expect(inkBox(middle, null)).not.toBeNull();
  }, 600_000);

  it('key mode leaves no pixel within 2 levels of the key colour inside the content box', async () => {
    const { ctx, dir } = build('16:9', 'key');
    const key = parseHex(ctx.keyColor as string);
    await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page, session) => {
      await seek(page, 1.5);
      const box = await page.evaluate(() => {
        const card = document.getElementById('card') as HTMLElement;
        const rect = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        const glass = getComputedStyle(card.querySelector('.glass') as HTMLElement);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: parseFloat(style.borderTopLeftRadius), shadow: style.boxShadow, glassFilter: glass.filter, glassBackdrop: glass.backdropFilter, background: getComputedStyle(document.getElementById('mf-root') as HTMLElement).backgroundColor };
      });
      const file = path.join(dir, 'key.png');
      writeFileSync(file, await screenshot(page));
      const frame = await frameAt(file, 0, { format: 'rgba' });
      // The ground is the key colour; the content box is the card (inside its rounded corners).
      expect(pixel(frame, 2, 2).slice(0, 3)).toEqual(key);
      const levels = NUMBERS['key.purityLevels'];
      const inset = Math.ceil(box.radius * (1 - Math.SQRT1_2)) + 1;
      let near = 0;
      let checked = 0;
      for (let y = Math.ceil(box.y) + inset; y < Math.floor(box.y + box.height) - inset; y += 1) {
        for (let x = Math.ceil(box.x) + inset; x < Math.floor(box.x + box.width) - inset; x += 1) {
          const [r = 0, g = 0, b = 0] = pixel(frame, x, y);
          checked += 1;
          if (Math.abs(r - (key[0] ?? 0)) <= levels && Math.abs(g - (key[1] ?? 0)) <= levels && Math.abs(b - (key[2] ?? 0)) <= levels) near += 1;
        }
      }
      expect(checked).toBeGreaterThan(10_000);
      expect(near).toBe(0);
      // Hard edges: the shadow is solid (no blur radius) and blur filters are off.
      // A solid shadow: opaque colour, zero blur and spread ("rgb(r, g, b) 0px <y>px 0px 0px").
      expect(box.shadow).toMatch(/^rgb\(\d+, \d+, \d+\) 0px [\d.]+px 0px 0px$/);
      expect(box.glassFilter).toBe('none');
      expect(box.glassBackdrop).toBe('none');
      expect(session.errors).toEqual([]);
    });
  }, 300_000);

  it('a 9:16 composition with content biased to the top is re-centred', async () => {
    const { ctx, dir } = build('9:16', 'full', 'broll');
    const result = await centreMove(dir, { engine, browserPath });
    expect(result.boxes).toHaveLength(CENTRE.samples);
    expect(result.offsetPx).toBeGreaterThan(0);
    const vars = JSON.parse(readFileSync(path.join(dir, 'assets', 'vars.json'), 'utf8'));
    expect(vars.ctx.centreOffsetPx).toBe(result.offsetPx);
    expect(readFileSync(path.join(dir, 'index.html'), 'utf8')).toContain(`"centreOffsetPx": ${result.offsetPx}`);
    // Rendered again with the offset, the ink is centred within 2% of the height.
    const ground = parseHex(mossmallow.colors.ground);
    const boxes = await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (page, session) => {
      const found = [];
      for (const [i, time] of result.times.entries()) {
        await seek(page, time);
        const file = path.join(dir, `centred-${i}.png`);
        writeFileSync(file, await screenshot(page));
        found.push(inkBox(await frameAt(file, 0, { format: 'rgba' }), ground));
      }
      expect(session.errors).toEqual([]);
      return found;
    });
    const union = unionBox(boxes);
    expect(union).not.toBeNull();
    const centre = (union?.y ?? 0) + (union?.height ?? 0) / 2;
    expect(Math.abs(centre - ctx.height / 2)).toBeLessThan(CENTRE.minOffsetFraction * ctx.height);
  }, 300_000);

  it('mf.done fails a composition whose registration id differs from its composition id', async () => {
    const { ctx, dir } = build('16:9', 'full', 'broll');
    const page = path.join(dir, 'index.html');
    writeFileSync(page, readFileSync(page, 'utf8').replace('window.__timelines["demo-card"] = tl;', 'window.__timelines["other-card"] = tl;'));
    const errors = await withPage({ dir, entry: 'index.html', width: ctx.width, height: ctx.height, engine, browserPath }, async (_page, session) => session.errors);
    expect(errors.join('\n')).toMatch(/mf\.done: the page registers window\.__timelines\["other-card"\] but its composition id is "demo-card"/);
    // The unchanged build publishes MF_REPORT with its line, the copy box and the duration.
    const good = build('16:9', 'full', 'broll');
    const report = await withPage({ dir: good.dir, entry: 'index.html', width: good.ctx.width, height: good.ctx.height, engine, browserPath }, async (driver, session) => {
      expect(session.errors).toEqual([]);
      return driver.evaluate(() => (window as unknown as { MF_REPORT: unknown }).MF_REPORT);
    });
    expect(report).toMatchObject({ duration: DURATION, lines: [{ entrance: 'rise', inSec: 0.4 }], safe: { copy: good.ctx.safe.copy } });
  }, 300_000);
});

// Move build context, composition document, key colour, centring maths and the
// runtime's seeded randomness.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { html } from '../../../../src/kit/build/html';
import { type Composition, brandPalette, moveCtx, moveDocument, moveProfile, replaceInlineVars } from '../../../../src/kit/build/move';
import { CENTRE, centreTimes, centringOffset, unionBox } from '../../../../src/kit/centre';
import { hsv, hueDistance, keyColor } from '../../../../src/kit/keyColor';
import { NUMBERS } from '../../../../src/kit/numbers';
import { parseHex } from '../../../../src/kit/oklch';
import { noise2, rand } from '../../../../src/kit/runtime/move';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../../../..');
const mossmallow = JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', 'mossmallow', 'brand.json'), 'utf8'));

const composition = (id = 'demo-card', script = ''): Composition => ({ id, html: html`<div class="card">${'<b>not markup</b>'}</div>`, css: '.card { color: var(--mf-ink); }', script, assets: [], needsThree: false, holds: [] });

describe('keyColor', () => {
  it("Mossmallow's palette (green accent) yields a magenta key at least 60 degrees from every palette hue", () => {
    const key = keyColor(brandPalette(mossmallow));
    const { hue, saturation, value } = hsv(parseHex(key.hex));
    // Magenta side of the wheel: between blue (240) and red (360), opposite the green accent.
    expect(hue).toBeGreaterThan(255);
    expect(hue).toBeLessThan(330);
    expect(hueDistance(hue, hsv(parseHex(mossmallow.colors.accent)).hue)).toBeGreaterThanOrEqual(100);
    for (const paletteHue of key.paletteHues) expect(hueDistance(key.hueDeg, paletteHue)).toBeGreaterThanOrEqual(NUMBERS['key.minHueDistanceDeg'].deg);
    expect(saturation).toBeCloseTo(1, 2);
    expect(value).toBeCloseTo(0.85, 2);
    expect(key).toMatchObject({ hueDeg: 270, hex: '#6C00D9' });
  });

  it('ignores hueless colours and fails MODE_UNSUPPORTED when every hue is taken', () => {
    expect(keyColor(['#FFFFFF', '#000000', '#808080']).distanceDeg).toBe(180);
    const rainbow = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF'];
    expect(() => keyColor(rainbow)).toThrowError(expect.objectContaining({ code: 'MODE_UNSUPPORTED' }));
  });
});

describe('moveCtx', () => {
  it('builds the context of the contract, with the key colour only in key mode', () => {
    const ctx = moveCtx({ aspect: '16:9', mode: 'key', layer: 'overlay', brand: mossmallow, seed: 7, durationSec: 4 });
    expect(Object.keys(ctx).sort()).toEqual(['aspect', 'assets', 'brand', 'brandMark', 'brandName', 'durationSec', 'fps', 'height', 'keyColor', 'mode', 'safe', 'seed', 'u', 'width'].sort());
    expect(ctx).toMatchObject({ width: 1920, height: 1080, u: 1, keyColor: '#6C00D9', fps: '30' });
    expect(ctx.safe.profile).toBe('overlay-key');
    // Overlays end their copy box above the caption band and avoid the face band.
    expect(ctx.safe.copy.y + ctx.safe.copy.height).toBe(NUMBERS['safe.captionBand']['16:9'].y0);
    expect(ctx.safe.avoid).toHaveLength(1);
    expect(moveCtx({ aspect: '9:16', mode: 'full', layer: 'broll', brand: mossmallow, seed: 1, durationSec: 4 }).keyColor).toBeNull();
    expect(moveProfile('overlay', 'alpha')).toBe('overlay-alpha');
    expect(() => moveCtx({ aspect: '1:1', mode: 'alpha', layer: 'broll', brand: mossmallow, seed: 1, durationSec: 4 })).toThrowError(expect.objectContaining({ code: 'MODE_UNSUPPORTED' }));
    expect(ctx.assets.add('/tmp/x/logo.svg')).toBe('assets/logo.svg');
    expect(() => ctx.assets.add('/tmp/x/a.png', '../a.png')).toThrowError(expect.objectContaining({ code: 'PATH_ESCAPES_ROOT' }));
  });
});

describe('moveDocument', () => {
  const ctx = moveCtx({ aspect: '9:16', mode: 'alpha', layer: 'overlay', brand: mossmallow, seed: 7, durationSec: 4 });

  it('wraps the composition with classes, inline vars and the literal registration', () => {
    const { html: page, vars } = moveDocument(ctx, composition(), { title: 'Hi </script><script>alert(1)</script>' });
    expect(page).toContain('class="mf-move is-alpha is-portrait"');
    expect(page).toContain('data-composition-id="demo-card"');
    expect(page).toContain('window.__timelines["demo-card"] = tl;');
    expect(page).toContain('&lt;b&gt;not markup&lt;/b&gt;');
    // The inline vars cannot close their script tag.
    const inline = page.slice(page.indexOf('id="mf-vars">') + 'id="mf-vars">'.length, page.indexOf('</script>', page.indexOf('id="mf-vars">')));
    expect(JSON.parse(inline)).toEqual(vars);
    expect(vars.vars.title).toBe('Hi </script><script>alert(1)</script>');
    expect(vars.ctx).toMatchObject({ aspect: '9:16', mode: 'alpha', centreOffsetPx: 0, keyColor: null });
  });

  it('is pure: same ctx and vars give the same page', () => {
    const a = moveDocument(ctx, composition(), { n: 1 }).html;
    const b = moveDocument(moveCtx({ aspect: '9:16', mode: 'alpha', layer: 'overlay', brand: mossmallow, seed: 7, durationSec: 4 }), composition(), { n: 1 }).html;
    expect(a).toBe(b);
  });

  it('replaces the inline vars for a new centring offset', () => {
    const { html: page, vars } = moveDocument(ctx, composition(), {});
    const next = replaceInlineVars(page, { ...vars, ctx: { ...vars.ctx, centreOffsetPx: 42 } });
    expect(next).toContain('"centreOffsetPx": 42');
    expect(next.replace('"centreOffsetPx": 42', '"centreOffsetPx": 0')).toBe(page);
  });

  it('refuses a composition id that is not a slug', () => {
    expect(() => moveDocument(ctx, composition('Bad Id"'), {})).toThrowError(expect.objectContaining({ code: 'VARS_INVALID' }));
  });
});

describe('centring', () => {
  const frame = { width: 1080, height: 1920 };
  it('samples 8 times and centres content biased to the top', () => {
    expect(centreTimes(4)).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]);
    const top = unionBox([{ x: 100, y: 300, width: 800, height: 400 }, null, { x: 200, y: 500, width: 600, height: 400 }]);
    expect(top).toEqual({ x: 100, y: 300, width: 800, height: 600 });
    expect(centringOffset(top, frame)).toBe(360);
  });

  it('leaves content within 2% of the height alone and keeps the edge margin', () => {
    const near = { x: 0, y: 960 - 300 + 30, width: 1080, height: 600 };
    expect(Math.abs(960 - (near.y + near.height / 2))).toBeLessThan(CENTRE.minOffsetFraction * 1920);
    expect(centringOffset(near, frame)).toBe(0);
    // Tall content near the top (60 px off centre) can only move down until its bottom is 120 px from the edge.
    expect(centringOffset({ x: 0, y: 50, width: 1080, height: 1700 }, frame)).toBe(1920 - 120 - 1750);
    expect(centringOffset(null, frame)).toBe(0);
  });
});

describe('runtime randomness', () => {
  it('rand and noise2 are seeded, deterministic and in [0, 1)', () => {
    const a = rand(42);
    const b = rand(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(rand(43)()).not.toBe(first[0]);
    const n = noise2(9);
    const values = Array.from({ length: 50 }, (_, i) => n(i * 0.37, i * 0.11));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(n(1.5, 2.5)).toBe(noise2(9)(1.5, 2.5));
    // Continuous: close points give close values.
    expect(Math.abs(n(3.2, 4.1) - n(3.2001, 4.1))).toBeLessThan(0.01);
  });

  it('the move runtime uses no unseeded randomness or clock', () => {
    const source = readFileSync(path.join(packageRoot, 'src', 'kit', 'runtime', 'move.ts'), 'utf8');
    expect(source).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date/);
  });
});

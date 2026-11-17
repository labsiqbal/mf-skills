// The numbers module against the numbers table (snapshot tables.json, and the
// live doc when MFM_SPEC_DOCS is set), plus safe boxes and brand tokens.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASPECT_KEYS, NUMBERS, type NumberKey, numberKeys } from '../../../../src/kit/numbers';
import { contrastRatio, mixOklab, oklchToRgb, parseHex, rgbToOklch, rotateHue, toHex } from '../../../../src/kit/oklch';
import { safeBoxes } from '../../../../src/kit/safe';
import { brandTokens, tokensCss } from '../../../../src/kit/tokens';
import { ROLE_NUMBERS } from '../../../../src/brand/colors';
import { LINT_NUMBERS } from '../../../../src/lint/numbers';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../../../..');
interface TableSnapshot {
  doc: string;
  section: string;
  mode: 'table';
  data: Array<Record<string, string>>;
}
const tables = JSON.parse(readFileSync(path.join(here, 'tables.json'), 'utf8')) as TableSnapshot[];
const specKeys = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'spec', 'numbers.json'), 'utf8')).data as string[];

/** "safe.captionBand (y range ...)" -> "safe.captionBand". */
const keyOf = (cell: string) => cell.split(' (')[0] ?? cell;
const keyedRows = tables.flatMap((table) => table.data.filter((row) => row.Key).map((row) => ({ key: keyOf(row.Key ?? ''), row })));

/** Numbers a doc cell states: digits (thousands commas, +-), percentages also as fractions, and a few number words. */
function docNumbers(text: string): number[] {
  const out: number[] = [];
  const percent = text.includes('%');
  for (const match of text.matchAll(/(\+-)?(?<![0-9.])-?\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/^\+-/, '').replace(/,/g, ''));
    out.push(value);
    if (match[1]) out.push(-value);
    if (percent) out.push(value / 100);
  }
  const words: Array<[RegExp, number]> = [[/\bone third\b/, 1 / 3], [/\bone\b/, 1], [/\btwo\b/, 2], [/\balways\b/, 0]];
  for (const [pattern, value] of words) if (pattern.test(text)) out.push(value);
  return out;
}

function numericLeaves(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numericLeaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numericLeaves);
  return [];
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

const ASPECT_COLUMNS = { '16:9': '16:9 (1920x1080)', '9:16': '9:16 (1080x1920)', '1:1': '1:1 (1080x1080)' } as const;

describe('NUMBERS', () => {
  it('is keyed exactly by the doc keys, in doc order, and matches the spec snapshot', () => {
    expect(numberKeys()).toEqual(keyedRows.map((entry) => entry.key));
    expect(numberKeys()).toEqual(specKeys);
    expect(keyedRows).toHaveLength(137);
  });

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(NUMBERS)).toBe(true);
    expect(Object.isFrozen(NUMBERS['safe.faceBand']['9:16'])).toBe(true);
    expect(Object.isFrozen(NUMBERS['rubric.axes'])).toBe(true);
    expect(() => {
      (NUMBERS as unknown as Record<string, unknown>)['fps.film'] = 60;
    }).toThrow();
  });

  it('states only numbers its doc row states', () => {
    for (const { key, row } of keyedRows) {
      const value = NUMBERS[key as NumberKey];
      const cells: Array<[unknown, string]> = row.Value !== undefined
        ? [[value, row.Value]]
        : ASPECT_KEYS.map((aspect) => [(value as Record<string, unknown>)[aspect], row[ASPECT_COLUMNS[aspect]] ?? '']);
      for (const [part, text] of cells) {
        const allowed = docNumbers(text);
        for (const leaf of numericLeaves(part)) {
          expect(allowed.some((n) => Math.abs(n - leaf) < 1e-9), `${key}: ${leaf} not in "${text}"`).toBe(true);
        }
        for (const leaf of stringLeaves(part).filter((s) => /\d/.test(s))) {
          expect(text.toLowerCase(), `${key}: "${leaf}"`).toContain(leaf.toLowerCase());
        }
      }
    }
  });

  it('feeds the lint and colour-role thresholds with unchanged values', () => {
    expect(LINT_NUMBERS).toEqual({ trackingFloorEm: -0.025, minReadableShare: 0.026, filmMinRealPieces: 3, backdropMaxFrameShare: 0.5, sceneToleranceFrames: 1 });
    expect(ROLE_NUMBERS).toMatchObject({
      inkContrastMin: 4.5,
      accentSaturationMin: 0.35,
      accentLuminance: [0.04, 0.85],
      surfaceDeltaLuminance: [0.005, 0.12],
      mutedSaturationMax: 0.2,
      mutedContrast: [2.2, 6.0],
      paletteMax: 12,
    });
  });

  const docs = process.env.MFM_SPEC_DOCS;
  it.runIf(docs)('tables.json equals the live doc tables', async () => {
    const { snapshot } = (await import(pathToFileURL(path.join(packageRoot, 'scripts', 'doc-table.mjs')).href)) as {
      snapshot: (options: { doc: string; section: string }) => TableSnapshot;
    };
    for (const table of tables) {
      expect(snapshot({ doc: path.join(docs ?? '', table.doc), section: table.section }), table.section).toEqual(table);
    }
  });
});

describe('safeBoxes', () => {
  it('9:16 copy-safe is 70/190/210/600 px at 1080x1920', () => {
    const boxes = safeBoxes('9:16', 'broll');
    expect([boxes.width, boxes.height]).toEqual([1080, 1920]);
    expect(boxes.copy).toEqual({ x: 70, y: 210, width: 1080 - 70 - 190, height: 1920 - 210 - 600 });
    expect(boxes.css).toEqual({ '--mf-safe-l': '70px', '--mf-safe-r': '190px', '--mf-safe-t': '210px', '--mf-safe-b': '600px' });
    expect(boxes.frame).toEqual({ x: 40, y: 40, width: 1000, height: 1840 });
    expect([boxes.captionBand, boxes.faceBand, boxes.avoid]).toEqual([null, null, []]);
  });

  it('the 1:1 caption band is y 830-990', () => {
    const boxes = safeBoxes('1:1', 'overlay-alpha');
    expect(boxes.captionBand).toEqual({ x: 0, y: 830, width: 1080, height: 160 });
    // Overlay copy ends where the caption band begins.
    expect(boxes.copy.y + boxes.copy.height).toBe(830);
    expect(boxes.faceBand).toEqual({ x: 270, y: 130, width: 540, height: 680 });
    expect(boxes.avoid).toEqual([boxes.faceBand]);
  });

  it('chooses bands by profile and options, and scales with the frame width', () => {
    expect(safeBoxes('16:9', 'film').captionBand).toBeNull();
    expect(safeBoxes('16:9', 'film', { captions: true }).captionBand).toEqual({ x: 0, y: 864, width: 1920, height: 136 });
    expect(safeBoxes('16:9', 'film', { captions: true }).copy.y + safeBoxes('16:9', 'film', { captions: true }).copy.height).toBe(864);
    expect(safeBoxes('16:9', 'overlay-key', { avoidFace: false }).faceBand).toBeNull();
    expect(safeBoxes('9:16', 'overlay-key').css['--mf-safe-b']).toBe(`${1920 - 1150}px`);
    const half = safeBoxes('16:9', 'broll', { width: 960 });
    expect([half.width, half.height, half.scale]).toEqual([960, 540, 0.5]);
    expect(half.copy).toEqual({ x: 57.5, y: 43, width: 845, height: 443 });
  });
});

describe('oklch', () => {
  it('round-trips sRGB and mixes in OKLab', () => {
    for (const hex of ['#8B6DFF', '#0B0F17', '#E8EEF7', '#238653', '#F2A65A']) expect(toHex(oklchToRgb(rgbToOklch(parseHex(hex))))).toBe(hex);
    expect(toHex(mixOklab(parseHex('#000000'), parseHex('#FFFFFF'), 0))).toBe('#000000');
    expect(toHex(mixOklab(parseHex('#000000'), parseHex('#FFFFFF'), 1))).toBe('#FFFFFF');
    const turned = rgbToOklch(rotateHue(parseHex('#8B6DFF'), 35));
    const hueGap = (turned.h - rgbToOklch(parseHex('#8B6DFF')).h + 360) % 360;
    expect(hueGap).toBeGreaterThan(30);
    expect(hueGap).toBeLessThan(40);
  });
});

describe('brandTokens', () => {
  const tessarine = {
    colors: { ground: '#0B0F17', surface: '#141B26', ink: '#E8EEF7', muted: '#8A97AB', accent: '#8B6DFF', accent2: '#2DD4BF' },
    type: {
      display: { family: 'Inter', weight: 700, fallback: 'inter' },
      body: { family: 'Inter', weight: 400, fallback: 'inter' },
      mono: { family: 'Noto Sans Mono', weight: 500, fallback: 'noto-sans-mono' },
    },
    radiusPx: null,
  };

  it('Tessarine tokens give --mf-accent #8B6DFF and every token the kit names', () => {
    const tokens = brandTokens(tessarine);
    expect(tokens.vars['--mf-accent']).toBe('#8B6DFF');
    expect(Object.keys(tokens.vars).sort()).toEqual(
      [
        '--mf-ground', '--mf-surface', '--mf-ink', '--mf-muted', '--mf-accent', '--mf-accent2', '--mf-radius', '--mf-font-display',
        '--mf-font-heading', '--mf-font-body', '--mf-font-mono', '--mf-u', '--mf-accent-soft', '--mf-ink-2', '--mf-line', '--mf-shadow',
      ].sort(),
    );
    expect(tokens.vars['--mf-accent2']).toBe('#2DD4BF');
    expect(tokens.vars['--mf-font-display']).toBe('"Inter", sans-serif');
    expect(tokens.vars['--mf-font-heading']).toBe('"Inter", sans-serif');
    expect(tokens.vars['--mf-font-mono']).toBe('"Noto Sans Mono", monospace');
    expect(tokens.vars['--mf-radius']).toBe('calc(12 * var(--mf-u))');
    expect(tokens.vars['--mf-u']).toBe('1px');
    expect(tokens.vars['--mf-shadow']).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);
    expect(tokens.swapped).toEqual([]);
    for (const pair of tokens.pairs) expect(pair.contrast).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
    expect(tokensCss(tokens.vars)).toContain('  --mf-accent: #8B6DFF;\n');
  });

  it('derives soft accent, ink-2 and line between ground and their colour', () => {
    const { colors } = brandTokens(tessarine);
    const ground = parseHex(colors.ground);
    const between = (derived: string, toward: string) =>
      contrastRatio(parseHex(derived), ground) > 1 && contrastRatio(parseHex(derived), ground) < contrastRatio(parseHex(toward), ground);
    expect(between(colors.accentSoft, colors.accent)).toBe(true);
    expect(between(colors.ink2, colors.ink)).toBe(true);
    expect(between(colors.line, colors.ink)).toBe(true);
    expect(contrastRatio(parseHex(colors.line), ground)).toBeLessThan(contrastRatio(parseHex(colors.ink2), ground));
  });

  it('falls back to a 35 degree hue turn for accent2 and to bundled fonts for missing roles', () => {
    const tokens = brandTokens({ colors: { ...tessarine.colors, accent2: null } });
    expect(tokens.colors.accent2).toBe(toHex(rotateHue(parseHex('#8B6DFF'), 35)));
    expect(tokens.vars['--mf-font-body']).toBe('"Inter", sans-serif');
    expect(tokens.vars['--mf-font-mono']).toBe('"Noto Sans Mono", monospace');
    expect(tokens.fonts.display.weight).toBe(700);
  });

  it('swaps a derived text colour under 4.5:1 to ink', () => {
    // Ink at about 5:1 on ground: ink-2 (ink at 72% over ground) falls under 4.5:1.
    const tokens = brandTokens({ colors: { ground: '#FFFFFF', surface: '#F4F4F4', ink: '#6B6B6B', muted: '#8A8A8A', accent: '#2255DD', accent2: null } });
    expect(contrastRatio(parseHex('#6B6B6B'), parseHex('#FFFFFF'))).toBeGreaterThan(4.5);
    expect(tokens.pairs.some((pair) => pair.contrast < 4.5)).toBe(true);
    expect(tokens.swapped).toEqual(['ink-2']);
    expect(tokens.vars['--mf-ink-2']).toBe('#6B6B6B');
  });

  it('sizes --mf-u by the short side of the frame', () => {
    expect(brandTokens(tessarine, { aspect: '9:16' }).vars['--mf-u']).toBe('1px');
    expect(brandTokens(tessarine, { width: 1280, height: 720 }).vars['--mf-u']).toBe('0.6667px');
    expect(brandTokens({ ...tessarine, radiusPx: 20 }).vars['--mf-radius']).toBe('calc(20 * var(--mf-u))');
  });
});

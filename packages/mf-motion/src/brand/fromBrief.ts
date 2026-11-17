// brand from-brief: a generated brand from mood words. The mood recipes give
// ground, ink and accent in OKLCH plus bundled fonts; contrast is enforced
// after generation; the logo is a wordmark set in the display family.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { FAMILY_SPECS } from '../fonts/index';
import { type BrandColors, type Evidence, ROLE_NUMBERS, contrast, hsl, shiftLuminance, toHex } from './colors';
import type { FontRoles } from './fonts';
import { type Asset, bundledRole, checkBrandId, displayName, parseHexList, towardContrast, writeLibraryBrand } from './manual';
import { MOODS, MOOD_NAMES, type MoodRecipe, type Oklch, oklchToRgb, rgbToOklch } from './moods';

type Rgb = [number, number, number];

/** 1-3 mood words. */
export const BRIEF_MOODS = { min: 1, max: 3 } as const;
/** Muted text aims a little above the floor so rounding never drops it below. */
const MUTED_TARGET = ROLE_NUMBERS.inkContrastMin + 0.1;

export function parseMoods(words: string[]): string[] {
  const moods = words.map((word) => word.trim().toLowerCase()).filter(Boolean);
  const unknown = moods.filter((word) => !MOOD_NAMES.includes(word));
  if (moods.length < BRIEF_MOODS.min || moods.length > BRIEF_MOODS.max || unknown.length > 0) {
    throw new MfmError('USAGE', { flag: '--mood', value: words.join(','), unknown, moods: MOOD_NAMES }, {
      message: unknown.length > 0 ? `Unknown mood ${unknown.join(', ')}.` : `Pass ${BRIEF_MOODS.min} to ${BRIEF_MOODS.max} mood words; got ${moods.length}.`,
      hint: `Choose up to three of: ${MOOD_NAMES.join(', ')}.`,
    });
  }
  return [...new Set(moods)];
}

/** Mean of OKLCH colours; hue is averaged on the circle, weighted by chroma. */
function meanOklch(colors: Oklch[]): Oklch {
  const l = colors.reduce((sum, color) => sum + color.l, 0) / colors.length;
  const c = colors.reduce((sum, color) => sum + color.c, 0) / colors.length;
  const x = colors.reduce((sum, color) => sum + color.c * Math.cos((color.h * Math.PI) / 180), 0);
  const y = colors.reduce((sum, color) => sum + color.c * Math.sin((color.h * Math.PI) / 180), 0);
  const h = x === 0 && y === 0 ? 0 : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

/** Move `color` toward black or white (in OKLCH) until it reaches `ratio` against every colour in `against`. */
function pushToContrast(color: Oklch, against: Rgb[], ratio: number): Rgb {
  const worst = (rgb: Rgb) => Math.min(...against.map((other) => contrast(rgb, other)));
  const start = oklchToRgb(color);
  if (worst(start) >= ratio) return start;
  const lightAgainst = against.every((rgb) => rgbToOklch(rgb).l >= 0.5);
  const end: Oklch = { l: lightAgainst ? 0 : 1, c: 0, h: color.h };
  const mix = (t: number) => oklchToRgb({ l: color.l + (end.l - color.l) * t, c: color.c * (1 - t), h: color.h });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (worst(mix(mid)) >= ratio) hi = mid;
    else lo = mid;
  }
  return mix(hi);
}

export interface BriefPalette {
  colors: BrandColors;
  /** Text pairs and their contrast; each meets role.ink.contrastMin. */
  pairs: Array<{ text: 'ink' | 'muted'; on: 'ground' | 'surface'; contrast: number }>;
  recipe: { display: string; body: string; mono: string | null };
}

/** The palette for mood words; `seed` picks among the accent variants, `accent` overrides the accent. */
export function briefPalette(moods: string[], options: { seed?: number; accent?: string } = {}): BriefPalette {
  const recipes = moods.map((mood) => MOODS[mood]).filter((recipe): recipe is MoodRecipe => recipe !== undefined);
  const primary = recipes[0];
  if (!primary) throw new MfmError('USAGE', { flag: '--mood' }, { message: 'Pass at least one mood word.' });
  const n = ROLE_NUMBERS;
  // Ground and ink: the primary mood's polarity, averaged over the moods that share it.
  const light = primary.ground.l >= 0.5;
  const same = recipes.filter((recipe) => recipe.ground.l >= 0.5 === light);
  const ground = oklchToRgb(meanOklch(same.map((recipe) => recipe.ground)));
  const inkTarget = meanOklch(same.map((recipe) => recipe.ink));

  // Accent: the variants interleaved across moods; the seed picks one.
  const pool: Oklch[] = [];
  for (let i = 0; i < Math.max(...recipes.map((recipe) => recipe.accents.length)); i += 1) {
    for (const recipe of recipes) {
      const variant = recipe.accents[i];
      if (variant) pool.push(variant);
    }
  }
  const seed = options.seed ?? 0;
  const index = ((seed % pool.length) + pool.length) % pool.length;
  const userAccent = options.accent ? parseHexList([options.accent], '--accent')[0] : undefined;
  const accent = userAccent ?? oklchToRgb(pool[index] as Oklch);
  const accent2 =
    [...pool.slice(index + 1), ...pool.slice(0, index)]
      .map(oklchToRgb)
      .find((rgb) => {
        const hueGap = Math.abs(hsl(rgb).h - hsl(accent).h) % 360;
        return hsl(rgb).s >= n.accentSaturationMin && Math.min(hueGap, 360 - hueGap) >= n.accent2HueMinDeg;
      }) ?? null;

  // Contrast is enforced after generation: ink against ground and surface, then muted against both.
  let ink = pushToContrast(inkTarget, [ground], n.inkContrastMin);
  let surface = shiftLuminance(ground, ink, n.surfaceFallbackShift);
  ink = pushToContrast(rgbToOklch(ink), [ground, surface], n.inkContrastMin);
  surface = shiftLuminance(ground, ink, n.surfaceFallbackShift);
  ink = pushToContrast(rgbToOklch(ink), [ground, surface], n.inkContrastMin);
  const against = contrast(ink, surface) < contrast(ink, ground) ? surface : ground;
  const muted = towardContrast(ink, ground, against, MUTED_TARGET);

  const pairs: BriefPalette['pairs'] = [
    { text: 'ink', on: 'ground', contrast: contrast(ink, ground) },
    { text: 'ink', on: 'surface', contrast: contrast(ink, surface) },
    { text: 'muted', on: 'ground', contrast: contrast(muted, ground) },
    { text: 'muted', on: 'surface', contrast: contrast(muted, surface) },
  ].map((pair) => ({ ...pair, contrast: Math.round(pair.contrast * 1000) / 1000 })) as BriefPalette['pairs'];
  const failing = pairs.filter((pair) => pair.contrast < n.inkContrastMin);
  if (failing.length > 0) {
    throw new MfmError('INTERNAL', { moods, seed, failing }, { message: `The generated palette misses ${n.inkContrastMin}:1 for ${failing.map((pair) => `${pair.text} on ${pair.on}`).join(', ')}.` });
  }
  const evidence = (rgb: Rgb, other: Rgb, method: Evidence['method'] = 'generated'): Evidence => ({ method, share: null, contrast: Math.round(contrast(rgb, other) * 1000) / 1000 });
  const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const palette: Rgb[] = [];
  for (const rgb of [ground, ink, accent, ...(accent2 ? [accent2] : []), surface, muted]) {
    if (!palette.some((existing) => distance(existing, rgb) < n.mergeDistance)) palette.push(rgb);
  }
  return {
    colors: {
      ground: toHex(ground),
      ink: toHex(ink),
      accent: toHex(accent),
      accent2: accent2 ? toHex(accent2) : null,
      surface: toHex(surface),
      muted: toHex(muted),
      palette: palette.slice(0, n.paletteMax).map(toHex),
      evidence: {
        ground: evidence(ground, ink),
        ink: evidence(ink, ground),
        accent: evidence(accent, ground, userAccent ? 'manual' : 'generated'),
        surface: evidence(surface, ground),
        muted: evidence(muted, ground),
      },
    },
    pairs,
    recipe: { display: primary.display, body: primary.body, mono: recipes.find((recipe) => recipe.mono)?.mono ?? null },
  };
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Characters a brand name can hold (it comes from a slug), in ADVANCES order. */
const ADVANCE_CHARS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/**
 * Bold (700) advance widths in 1/1000 em of the bundled families the moods use
 * for display, measured from the bundled files with the pinned Chrome.
 */
const ADVANCES: Record<string, number[]> = {
  inter: [
    214, 650, 390, 599, 620, 657, 600, 617, 550, 614, 617, 713, 645, 726, 701, 608, 582, 736, 718, 259, 562, 686, 557, 894, 725, 748, 631, 748, 650, 652, 635,
    704, 706, 997, 697, 690, 634, 553, 598, 555, 598, 562, 371, 598, 585, 246, 246, 550, 246, 884, 585, 581, 598, 598, 373, 520, 369, 585, 554, 818, 537, 554,
    523,
  ],
  'noto-serif': [
    260, 565, 565, 565, 565, 565, 565, 565, 565, 565, 565, 753, 672, 669, 767, 653, 621, 770, 819, 401, 396, 734, 654, 952, 788, 787, 638, 787, 712, 579, 653,
    747, 698, 1067, 733, 693, 667, 600, 649, 527, 649, 572, 407, 560, 667, 352, 345, 637, 352, 986, 667, 614, 645, 648, 523, 481, 405, 667, 606, 856, 646, 579,
    529,
  ],
  'noto-sans': [
    260, 572, 572, 572, 572, 572, 572, 572, 572, 572, 572, 692, 665, 642, 732, 560, 549, 724, 765, 389, 331, 664, 559, 943, 813, 791, 621, 791, 656, 551, 577,
    756, 650, 967, 670, 626, 579, 599, 632, 516, 632, 597, 387, 632, 650, 299, 298, 620, 298, 975, 650, 625, 632, 632, 447, 502, 434, 650, 571, 856, 578, 571,
    493,
  ],
};

/** Text width in em at weight 700; characters outside the table count as a wide lowercase letter. */
export function textEm(text: string, familyId: string): number {
  const table = ADVANCES[familyId];
  let em = 0;
  for (const char of text) {
    const index = ADVANCE_CHARS.indexOf(char);
    em += (table && index >= 0 ? (table[index] ?? 650) : 650) / 1000;
  }
  return em;
}

/** The wordmark: the brand name in the display family, ink on a transparent ground; textLength holds it to the measured width. */
export function wordmarkSvg(name: string, familyId: string, ink: string): { svg: string; w: number; h: number } {
  const spec = FAMILY_SPECS.find((family) => family.id === familyId);
  if (!spec) throw new MfmError('INTERNAL', { family: familyId }, { message: `Mood font ${familyId} is not a known family.` });
  const size = 96;
  const pad = Math.round(size * 0.25);
  const textWidth = Math.round(textEm(name, familyId) * size);
  const w = textWidth + pad * 2;
  const h = Math.round(size * 1.4);
  const file = spec.files.find((entry) => !/italic/i.test(entry)) ?? spec.files[0] ?? '';
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${xml(name)}">`,
    `  <style>@font-face { font-family: "mf-wordmark"; src: url("${encodeURI(`fonts/${file}`)}") format("truetype"); font-weight: 100 900; }</style>`,
    `  <text x="${pad}" y="${Math.round(size * 1.02)}" font-family="mf-wordmark, '${xml(spec.name)}', ${spec.classification === 'serif' ? 'serif' : 'sans-serif'}" font-size="${size}" font-weight="700" fill="${ink}" textLength="${textWidth}" lengthAdjust="spacing">${xml(name)}</text>`,
    '</svg>',
    '',
  ].join('\n');
  return { svg, w, h };
}

export interface BriefRequest {
  home: string;
  id: string;
  moods: string[];
  accent?: string;
  seed?: number;
  project?: string | null;
  onWarn?: (message: string) => void;
}

/** brand from-brief: a draft brand from mood words, the same files for the same inputs. */
export async function briefBrand(request: BriefRequest) {
  checkBrandId(request.id);
  const moods = parseMoods(request.moods);
  const generated = briefPalette(moods, { ...(request.seed !== undefined ? { seed: request.seed } : {}), ...(request.accent ? { accent: request.accent } : {}) });
  const name = displayName(request.id);
  const result = await writeLibraryBrand({
    home: request.home,
    id: request.id,
    project: request.project ?? null,
    command: 'brand from-brief',
    ...(request.onWarn ? { onWarn: request.onWarn } : {}),
    fill: async (dir) => {
      const { display, body, mono } = generated.recipe;
      const type: FontRoles = {
        display: bundledRole(dir, display, 'display'),
        heading: bundledRole(dir, display, 'heading'),
        body: bundledRole(dir, body, 'body'),
        mono: mono ? bundledRole(dir, mono, 'mono') : null,
      };
      const mark = wordmarkSvg(name, display, generated.colors.ink);
      writeFileSync(path.join(dir, 'logo.svg'), mark.svg);
      const logo: Asset = { path: 'logo.svg', kind: 'svg', w: mark.w, h: mark.h };
      return {
        name,
        tagline: null,
        status: 'draft' as const,
        source: { mode: 'from-brief' as const, url: null, capturedAt: null, engine: null },
        colors: generated.colors,
        type,
        logo,
        shots: [],
      };
    },
  });
  return { brand: { ...result.doc, dir: result.dir }, moods, pairs: generated.pairs, notice: result.notice };
}

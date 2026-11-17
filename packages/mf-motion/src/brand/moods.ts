// Twelve mood recipes for `brand from-brief`: ground, ink and accent options
// in OKLCH, plus bundled fonts. Colours are converted to sRGB hex and then
// checked for contrast by the caller.

export interface Oklch {
  /** Perceptual lightness 0-1. */
  l: number;
  /** Chroma, 0 to about 0.37. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

export interface MoodRecipe {
  ground: Oklch;
  ink: Oklch;
  /** Accent variants; `--seed` picks one. */
  accents: Oklch[];
  /** Bundled family ids. */
  display: string;
  body: string;
  mono?: string;
}

export const MOODS: Record<string, MoodRecipe> = {
  calm: {
    ground: { l: 0.97, c: 0.01, h: 200 },
    ink: { l: 0.28, c: 0.03, h: 230 },
    accents: [{ l: 0.62, c: 0.09, h: 195 }, { l: 0.6, c: 0.08, h: 160 }, { l: 0.58, c: 0.07, h: 250 }],
    display: 'inter',
    body: 'inter',
  },
  bold: {
    ground: { l: 0.16, c: 0.02, h: 270 },
    ink: { l: 0.98, c: 0.0, h: 0 },
    accents: [{ l: 0.66, c: 0.25, h: 25 }, { l: 0.72, c: 0.2, h: 60 }, { l: 0.62, c: 0.24, h: 300 }],
    display: 'inter',
    body: 'inter',
  },
  warm: {
    ground: { l: 0.95, c: 0.025, h: 75 },
    ink: { l: 0.27, c: 0.03, h: 45 },
    accents: [{ l: 0.62, c: 0.16, h: 45 }, { l: 0.58, c: 0.14, h: 25 }, { l: 0.66, c: 0.13, h: 85 }],
    display: 'noto-serif',
    body: 'inter',
  },
  technical: {
    ground: { l: 0.18, c: 0.02, h: 250 },
    ink: { l: 0.95, c: 0.01, h: 250 },
    accents: [{ l: 0.72, c: 0.14, h: 190 }, { l: 0.74, c: 0.17, h: 145 }, { l: 0.68, c: 0.15, h: 265 }],
    display: 'inter',
    body: 'inter',
    mono: 'noto-sans-mono',
  },
  playful: {
    ground: { l: 0.96, c: 0.03, h: 95 },
    ink: { l: 0.25, c: 0.05, h: 300 },
    accents: [{ l: 0.65, c: 0.22, h: 350 }, { l: 0.7, c: 0.18, h: 150 }, { l: 0.62, c: 0.2, h: 285 }],
    display: 'inter',
    body: 'inter',
  },
  editorial: {
    ground: { l: 0.96, c: 0.015, h: 85 },
    ink: { l: 0.22, c: 0.01, h: 60 },
    accents: [{ l: 0.5, c: 0.17, h: 28 }, { l: 0.45, c: 0.12, h: 255 }, { l: 0.52, c: 0.1, h: 150 }],
    display: 'noto-serif',
    body: 'noto-serif',
  },
  luxury: {
    ground: { l: 0.17, c: 0.01, h: 60 },
    ink: { l: 0.93, c: 0.02, h: 85 },
    accents: [{ l: 0.76, c: 0.11, h: 85 }, { l: 0.7, c: 0.08, h: 60 }, { l: 0.65, c: 0.06, h: 20 }],
    display: 'noto-serif',
    body: 'inter',
  },
  natural: {
    ground: { l: 0.95, c: 0.03, h: 120 },
    ink: { l: 0.28, c: 0.04, h: 140 },
    accents: [{ l: 0.56, c: 0.12, h: 145 }, { l: 0.6, c: 0.1, h: 95 }, { l: 0.55, c: 0.11, h: 60 }],
    display: 'noto-serif',
    body: 'noto-sans',
  },
  dark: {
    ground: { l: 0.14, c: 0.01, h: 260 },
    ink: { l: 0.94, c: 0.01, h: 260 },
    accents: [{ l: 0.68, c: 0.17, h: 290 }, { l: 0.7, c: 0.15, h: 230 }, { l: 0.72, c: 0.16, h: 160 }],
    display: 'inter',
    body: 'inter',
  },
  bright: {
    ground: { l: 0.99, c: 0.0, h: 0 },
    ink: { l: 0.2, c: 0.02, h: 260 },
    accents: [{ l: 0.62, c: 0.22, h: 260 }, { l: 0.66, c: 0.22, h: 20 }, { l: 0.72, c: 0.18, h: 150 }],
    display: 'inter',
    body: 'inter',
  },
  retro: {
    ground: { l: 0.93, c: 0.04, h: 85 },
    ink: { l: 0.3, c: 0.05, h: 40 },
    accents: [{ l: 0.6, c: 0.16, h: 35 }, { l: 0.58, c: 0.11, h: 200 }, { l: 0.7, c: 0.14, h: 90 }],
    display: 'noto-serif',
    body: 'noto-sans',
  },
  minimal: {
    ground: { l: 0.985, c: 0.0, h: 0 },
    ink: { l: 0.18, c: 0.0, h: 0 },
    accents: [{ l: 0.45, c: 0.0, h: 0 }, { l: 0.55, c: 0.12, h: 255 }, { l: 0.6, c: 0.14, h: 30 }],
    display: 'inter',
    body: 'inter',
  },
};

export const MOOD_NAMES = Object.keys(MOODS);

const toLinear = (rgb: number[]) => rgb.map((v) => (v <= 0.04045 * 255 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
const fromLinear = (v: number) => {
  const clamped = Math.min(1, Math.max(0, v));
  return Math.round(255 * (clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055));
};

/** OKLCH to sRGB (0-255), clamped to the gamut. */
export function oklchToRgb(color: Oklch): [number, number, number] {
  const a = color.c * Math.cos((color.h * Math.PI) / 180);
  const b = color.c * Math.sin((color.h * Math.PI) / 180);
  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** sRGB (0-255) to OKLCH. */
export function rgbToOklch(rgb: readonly number[]): Oklch {
  const [r = 0, g = 0, bl = 0] = toLinear([...rgb]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}


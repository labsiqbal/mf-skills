// sRGB, OKLab and OKLCH: the colour space brand tokens are derived in, plus
// the WCAG contrast ratio the derived pairs are checked with.

export type Rgb = [number, number, number];

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

export interface Oklch {
  /** Lightness 0-1. */
  l: number;
  /** Chroma, 0 to about 0.37. */
  c: number;
  /** Hue in degrees, 0-360. */
  h: number;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp255 = (v: number) => Math.round(Math.min(255, Math.max(0, v)));

export function parseHex(hex: string): Rgb {
  const match = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match?.[1]) throw new Error(`${hex} is not a hex colour`);
  const full = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

export function toHex(rgb: readonly number[]): string {
  return `#${rgb.slice(0, 3).map((v) => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function rgbToOklab(rgb: readonly number[]): Oklab {
  const [r, g, b] = [toLinear(rgb[0] ?? 0), toLinear(rgb[1] ?? 0), toLinear(rgb[2] ?? 0)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab to sRGB, unclamped (channels may fall outside 0-255). */
function oklabToRgbRaw(lab: Oklab): Rgb {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function oklabToRgb(lab: Oklab): Rgb {
  return oklabToRgbRaw(lab).map(clamp255) as Rgb;
}

export function rgbToOklch(rgb: readonly number[]): Oklch {
  const { l, a, b } = rgbToOklab(rgb);
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -0.5 && v <= 255.5);

/** OKLCH to sRGB; out-of-gamut colours keep lightness and hue and lose chroma until they fit. */
export function oklchToRgb(color: Oklch): Rgb {
  const at = (c: number) => oklabToRgbRaw({ l: color.l, a: c * Math.cos((color.h * Math.PI) / 180), b: c * Math.sin((color.h * Math.PI) / 180) });
  const full = at(color.c);
  if (inGamut(full)) return full.map(clamp255) as Rgb;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo).map(clamp255) as Rgb;
}

/** `amount` of `to` over `from`, mixed in OKLab (0 = from, 1 = to). */
export function mixOklab(from: readonly number[], to: readonly number[], amount: number): Rgb {
  const a = rgbToOklab(from);
  const b = rgbToOklab(to);
  return oklabToRgb({ l: a.l + (b.l - a.l) * amount, a: a.a + (b.a - a.a) * amount, b: a.b + (b.b - a.b) * amount });
}

/** Rotate the hue by `degrees`, keeping lightness and chroma (chroma shrinks to stay in gamut). */
export function rotateHue(rgb: readonly number[], degrees: number): Rgb {
  const lch = rgbToOklch(rgb);
  return oklchToRgb({ ...lch, h: (lch.h + degrees + 360) % 360 });
}

/** Scale OKLCH lightness by `factor` (0.4 darkens by 60%). */
export function scaleLightness(rgb: readonly number[], factor: number): Rgb {
  const lch = rgbToOklch(rgb);
  return oklchToRgb({ ...lch, l: lch.l * factor });
}

export function relativeLuminance(rgb: readonly number[]): number {
  return 0.2126 * toLinear(rgb[0] ?? 0) + 0.7152 * toLinear(rgb[1] ?? 0) + 0.0722 * toLinear(rgb[2] ?? 0);
}

/** WCAG contrast ratio of two opaque colours. */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

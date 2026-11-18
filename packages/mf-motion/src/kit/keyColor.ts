// The chroma-key colour of a brand: the HSV hue farthest (circularly) from
// every hue in the palette, at key.minHueDistanceDeg or more, drawn at the
// key's saturation and value. Near-grey colours have no meaningful hue and do
// not count.
import { MfmError } from '../cli/errors';
import { NUMBERS } from './numbers';
import { parseHex, toHex } from './oklch';

/** Colours under this HSV saturation are treated as hueless (whites, greys, near-black inks). */
export const HUELESS_SATURATION = 0.15;

export interface KeyColor {
  hex: string;
  /** HSV hue in degrees. */
  hueDeg: number;
  /** Distance to the nearest palette hue in degrees (180 when the palette has no hue). */
  distanceDeg: number;
  /** Hues of the palette colours that counted. */
  paletteHues: number[];
}

/** HSV hue (degrees) and saturation of an sRGB colour (0-255 channels). */
export function hsv(rgb: readonly number[]): { hue: number; saturation: number; value: number } {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation: max === 0 ? 0 : delta / max, value: max };
}

/** sRGB hex of an HSV colour. */
export function hsvToHex(hueDeg: number, saturation: number, value: number): string {
  const h = (((hueDeg % 360) + 360) % 360) / 60;
  const c = value * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = value - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** Circular distance between two hues in degrees. */
export const hueDistance = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

/**
 * The key colour for a palette: of the whole-degree hues, the one whose nearest
 * palette hue is farthest away (the lowest such hue on a tie), at the key's
 * saturation and value. Fails MODE_UNSUPPORTED when no hue is far enough.
 */
export function keyColor(palette: readonly string[]): KeyColor {
  const spec = NUMBERS['key.minHueDistanceDeg'];
  const paletteHues = palette
    .map((hex) => hsv(parseHex(hex)))
    .filter((color) => color.saturation >= HUELESS_SATURATION)
    .map((color) => Math.round(color.hue * 10) / 10);
  let best = 0;
  let bestDistance = -1;
  for (let hue = 0; hue < 360; hue += 1) {
    const distance = paletteHues.length === 0 ? 180 : Math.min(...paletteHues.map((paletteHue) => hueDistance(hue, paletteHue)));
    if (distance > bestDistance) {
      best = hue;
      bestDistance = distance;
    }
  }
  if (bestDistance < spec.deg) {
    throw new MfmError('MODE_UNSUPPORTED', { mode: 'key', paletteHues, bestHue: best, distanceDeg: bestDistance, minDistanceDeg: spec.deg }, {
      message: `Key mode needs a hue at least ${spec.deg} degrees from every brand colour; the palette leaves at most ${Math.round(bestDistance)} degrees.`,
      hint: 'Use alpha mode for this brand, or a brand with fewer hues.',
    });
  }
  return { hex: hsvToHex(best, spec.saturation, spec.value), hueDeg: best, distanceDeg: Math.round(bestDistance * 10) / 10, paletteHues };
}

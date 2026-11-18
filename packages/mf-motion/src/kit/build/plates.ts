// The fixed plates overlays are measured over (check-profiles.md, Fixed plates
// (overlay-alpha)): plate-grey, plate-light, and plate-photo, a seeded
// procedural picture (blurred value noise in warm mid tones with a face-like
// light ellipse in the face band). Built in memory at the overlay's size; never
// a real photo, never a file from outside the kit.
import type { Frame } from '../../media/pixels';
import { noise2 } from '../runtime/move';
import type { Rect } from '../safe';

export const PLATES = ['plate-grey', 'plate-light', 'plate-photo'] as const;
export type PlateId = (typeof PLATES)[number];

/** Plate levels: grey #808080 and light #F2F2F2 as 8-bit values. */
export const PLATE_LEVEL = { 'plate-grey': 0x80, 'plate-light': 0xf2 } as const;

/** Warm mid tones of the photo plate: dark and light ends of the noise ramp (8-bit RGB). */
const WARM = { dark: [92, 74, 60], light: [176, 150, 124] } as const;
const FACE_LIFT = 70;

export interface PlateOptions {
  width: number;
  height: number;
  seed: number;
  /** Where the face-like ellipse sits; default the upper middle third. */
  faceBand?: Rect | null;
}

const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** One plate as an opaque RGBA frame. */
export function plate(id: PlateId, options: PlateOptions): Frame {
  const { width, height } = options;
  const data = new Uint8Array(width * height * 4);
  if (id !== 'plate-photo') {
    const level = PLATE_LEVEL[id];
    for (let i = 0; i < data.length; i += 4) {
      data[i] = level;
      data[i + 1] = level;
      data[i + 2] = level;
      data[i + 3] = 255;
    }
    return { data, width, height, format: 'rgba' };
  }
  // Blurred value noise: two octaves at a scale relative to the frame, so every size looks alike.
  const noise = noise2(options.seed);
  const cell = Math.max(width, height) / 6;
  const band = options.faceBand ?? { x: width / 3, y: height * 0.12, width: width / 3, height: height * 0.42 };
  const cx = band.x + band.width / 2;
  const cy = band.y + band.height / 2;
  const rx = Math.max(1, band.width * 0.32);
  const ry = Math.max(1, band.height * 0.42);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const n = 0.65 * noise(x / cell, y / cell) + 0.35 * noise(100 + (x * 2.3) / cell, 100 + (y * 2.3) / cell);
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const face = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const lift = FACE_LIFT * face * face * (3 - 2 * face);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) data[i + c] = clamp8((WARM.dark[c] ?? 0) + ((WARM.light[c] ?? 0) - (WARM.dark[c] ?? 0)) * n + lift);
      data[i + 3] = 255;
    }
  }
  return { data, width, height, format: 'rgba' };
}

/** All three plates at one size. */
export function plates(options: PlateOptions): Record<PlateId, Frame> {
  return { 'plate-grey': plate('plate-grey', options), 'plate-light': plate('plate-light', options), 'plate-photo': plate('plate-photo', options) };
}

/** Composite an RGBA overlay frame over a plate (straight alpha), as the viewer sees it. */
export function overPlate(overlay: Frame, base: Frame): Frame {
  if (overlay.width !== base.width || overlay.height !== base.height) throw new Error('overlay and plate sizes differ');
  const data = new Uint8Array(base.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = (overlay.data[i + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c += 1) data[i + c] = clamp8((overlay.data[i + c] ?? 0) * a + (base.data[i + c] ?? 0) * (1 - a));
    data[i + 3] = 255;
  }
  return { data, width: base.width, height: base.height, format: 'rgba' };
}

// The fixed plates overlays are measured over: grey and light are flat, the
// photo plate is a seeded warm picture with a light ellipse in the face band,
// built in memory (never a file), and the same seed gives the same plate.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATES, overPlate, plate, plates } from '../../../../src/kit/build/plates';
import { safeBoxes } from '../../../../src/kit/safe';
import { packageRoot } from '../type/page';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const mean = (data: Uint8Array, channel: number, x0: number, y0: number, w: number, h: number, width: number) => {
  let sum = 0;
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) sum += data[(y * width + x) * 4 + channel] ?? 0;
  return sum / (w * h);
};

describe('plates', () => {
  it('grey is #808080 and light is #F2F2F2 everywhere, opaque', () => {
    const grey = plate('plate-grey', { width: 64, height: 36, seed: 1 });
    const light = plate('plate-light', { width: 64, height: 36, seed: 1 });
    for (let i = 0; i < grey.data.length; i += 4) {
      expect([grey.data[i], grey.data[i + 1], grey.data[i + 2], grey.data[i + 3]]).toEqual([0x80, 0x80, 0x80, 255]);
      expect([light.data[i], light.data[i + 1], light.data[i + 2], light.data[i + 3]]).toEqual([0xf2, 0xf2, 0xf2, 255]);
    }
  });

  it('the photo plate is seeded, warm, mid-toned and lighter in the face band', () => {
    const safe = safeBoxes('16:9', 'overlay-alpha', { width: 480 });
    const options = { width: safe.width, height: safe.height, seed: 9, faceBand: safe.faceBand };
    const a = plate('plate-photo', options);
    expect(sha(plate('plate-photo', options).data)).toBe(sha(a.data));
    expect(sha(plate('plate-photo', { ...options, seed: 10 }).data)).not.toBe(sha(a.data));
    const all = (c: number) => mean(a.data, c, 0, 0, a.width, a.height, a.width);
    expect(all(0)).toBeGreaterThan(all(2));
    expect(all(1)).toBeGreaterThan(70);
    expect(all(1)).toBeLessThan(190);
    const band = safe.faceBand ?? { x: a.width / 3, y: a.height * 0.12, width: a.width / 3, height: a.height * 0.42 };
    const centre = mean(a.data, 1, Math.round(band.x + band.width / 2 - 4), Math.round(band.y + band.height / 2 - 4), 8, 8, a.width);
    const corner = mean(a.data, 1, 0, 0, 16, 16, a.width);
    expect(centre).toBeGreaterThan(corner + 20);
    expect(Object.keys(plates(options))).toEqual([...PLATES]);
  });

  it('is built in memory from kit code only: no file reads, URLs or images', () => {
    const source = readFileSync(path.join(packageRoot, 'src', 'kit', 'build', 'plates.ts'), 'utf8');
    expect(source).not.toMatch(/readFile|url\(|https?:|\.(png|jpe?g|webp)\b|fetch\(/);
  });

  it('composites an overlay over a plate with straight alpha', () => {
    const base = plate('plate-grey', { width: 2, height: 1, seed: 1 });
    const overlay = { data: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 0]), width: 2, height: 1, format: 'rgba' as const };
    expect(Array.from(overPlate(overlay, base).data)).toEqual([255, 255, 255, 255, 0x80, 0x80, 0x80, 255]);
  });
});

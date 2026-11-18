// npm run gen:land-mask
//
// Writes assets/kit/land-110m.bin, the equirectangular land mask the map-dots
// chart samples: 360 x 180 cells of 1 degree (column 0 = 180 W, row 0 = 90 N),
// one bit per cell (1 = land at the cell centre), rows of 45 bytes, most
// significant bit first. Source: Natural Earth 110m land (public domain),
// natural-earth-vector v5.1.2, fetched into the git-ignored .cache/ and
// checked against its sha256. Run once; the output is committed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = {
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson',
  sha256: '9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9',
};
export const COLS = 360;
export const ROWS = 180;
const cacheFile = path.resolve(root, '..', '..', '.cache', 'natural-earth', 'ne_110m_land.geojson');
const out = path.join(root, 'assets', 'kit', 'land-110m.bin');

async function source() {
  if (!existsSync(cacheFile)) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    const response = await fetch(SOURCE.url);
    if (!response.ok) throw new Error(`${SOURCE.url}: HTTP ${response.status}`);
    writeFileSync(cacheFile, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = readFileSync(cacheFile);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== SOURCE.sha256) throw new Error(`${cacheFile}: sha256 ${sha}, expected ${SOURCE.sha256}`);
  return JSON.parse(bytes.toString('utf8'));
}

/** Even-odd point in polygon over all rings (outer rings and holes alike). */
function inside(rings, x, y) {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

export function rasterise(geojson) {
  const polygons = geojson.features.flatMap((feature) => (feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates));
  const bits = new Uint8Array((COLS * ROWS) / 8);
  for (let row = 0; row < ROWS; row += 1) {
    const lat = 90 - (row + 0.5);
    for (let col = 0; col < COLS; col += 1) {
      const lon = -180 + (col + 0.5);
      if (polygons.some((rings) => inside(rings, lon, lat))) {
        const index = row * COLS + col;
        bits[index >> 3] |= 0x80 >> (index & 7);
      }
    }
  }
  return bits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bits = rasterise(await source());
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bits);
  let land = 0;
  for (const byte of bits) for (let b = 0; b < 8; b += 1) land += (byte >> b) & 1;
  console.log(`${path.relative(process.cwd(), out)}: ${bits.length} bytes, ${land} land cells of ${COLS * ROWS}`);
}

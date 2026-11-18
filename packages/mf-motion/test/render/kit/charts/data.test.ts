// Chart data helpers: value formatting, the race ranking and the land mask.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatValue, land, raceRanking } from '../../../../src/kit/build/charts';
import { packageRoot } from '../type/page';

describe('chart data', () => {
  it('formats prefix, grouped thousands, decimals and suffix', () => {
    expect(formatValue(12480)).toBe('12,480');
    expect(formatValue(1234567.891, { prefix: '$', decimals: 2 })).toBe('$1,234,567.89');
    expect(formatValue(94.2, { suffix: '%', decimals: 1 })).toBe('94.2%');
    expect(formatValue(-2.6, { decimals: 1 })).toBe('-2.6');
  });

  it('ranks a race by value, ties by input order', () => {
    expect(raceRanking([70, 61, 88, 52])).toEqual([2, 0, 1, 3]);
    expect(raceRanking([5, 5, 9])).toEqual([2, 0, 1]);
  });

  it('reads the committed Natural Earth land mask: oceans are water, continents land', () => {
    const isLand = land();
    expect(readFileSync(path.join(packageRoot, 'assets', 'kit', 'land-110m.bin')).length).toBe(8100);
    expect(readFileSync(path.join(packageRoot, 'assets', 'kit', 'NATURAL-EARTH-NOTICE.txt'), 'utf8')).toMatch(/public domain/);
    for (const [lat, lon] of [[48.8, 2.3], [-15, -50], [40, -100], [30, 80], [-25, 135], [0, 20]] as const) expect(isLand(lat, lon), `${lat},${lon}`).toBe(true);
    for (const [lat, lon] of [[0, -30], [-30, -120], [20, 65], [-40, 80], [35, -40]] as const) expect(isLand(lat, lon), `${lat},${lon}`).toBe(false);
  });
});

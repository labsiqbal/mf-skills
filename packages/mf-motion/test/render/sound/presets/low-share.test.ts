// Every genre preset keeps its bed's low end within bed.lowShareMax on the
// MFM-067 fixture grid, measured with the MFM-071 metric (the music after the
// mixer's own processing), and keeps at least 0.25 so the low end stays (MFM-097).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUMBERS } from '../../../../src/kit/numbers';
import { arrange, renderArrangement } from '../../../../src/sound/arrange';
import { mix } from '../../../../src/sound/mix';
import { GENRE_IDS, GENRE_PRESETS } from '../../../../src/sound/presets/index';
import { SAMPLE_RATE, type ScoreGrid } from '../../../../src/sound/synth/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const grid = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'unit', 'sound', 'presets', 'grid-20s.json'), 'utf8')) as ScoreGrid & { seed: number };
const MIN_SHARE = 0.25;

/** The bed's low-end share for one preset on the fixture grid. */
export function presetLowShare(id: string): number {
  const preset = GENRE_PRESETS[id];
  if (!preset) throw new Error(`no preset ${id}`);
  const bed = renderArrangement(arrange(grid, preset, grid.seed), preset, grid.seed).channels;
  return mix({ bed, sfx: [], voice: null, seed: grid.seed, fps: 30, sampleRate: SAMPLE_RATE }).lowShare;
}

describe('preset low end', () => {
  const shares = new Map<string, number>();
  for (const id of GENRE_IDS) {
    it(`${id}: low-end share between ${MIN_SHARE} and bed.lowShareMax`, () => {
      const share = presetLowShare(id);
      shares.set(id, share);
      console.log(`low-share ${id} ${share}`);
      expect(share).toBeLessThanOrEqual(NUMBERS['bed.lowShareMax'].share);
      expect(share).toBeGreaterThanOrEqual(MIN_SHARE);
    }, 300_000);
  }
});

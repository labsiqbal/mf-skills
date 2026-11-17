// score: render sound/score-raw.wav for a project from its resolved beat grid,
// seed and genre preset (the user-track and voice paths arrive in later tickets).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { readDoc } from '../schemas/index';
import { arrange, renderArrangement } from './arrange';
import { GENRE_PRESETS } from './presets/index';
import { PRESETS, type Preset, SAMPLE_RATE, TEST_PRESET, encodeWav24, renderScore } from './synth/index';

export interface ScoreResult {
  raw: string;
  seconds: number;
  sampleRate: number;
  channels: 2;
  bitDepth: 24;
  bpm: number;
  seed: number;
  preset: string;
  sha256: string;
  warnings: string[];
}

/** Render the raw score of a project; the preset falls back to the built-in test preset until MFM-067. */
export function scoreProject(project: string): ScoreResult {
  const file = path.join(project, 'plan', 'beatgrid.resolved.json');
  if (!existsSync(file)) {
    throw new MfmError('GRID_REQUIRED', { file }, { message: 'This project has no resolved beat grid yet.', next: ['mf-motion beatgrid check --json'] });
  }
  const { doc: grid } = readDoc('beatgrid-resolved', file);
  const warnings: string[] = [];
  const genre = GENRE_PRESETS[grid.genre];
  let preset: Preset | undefined = PRESETS[grid.genre];
  let channels: [Float32Array, Float32Array];
  let presetId: string;
  if (genre) {
    // Genre presets (MFM-067): arranged from the grid's sections.
    channels = renderArrangement(arrange(grid, genre, grid.seed, { key: grid.key }), genre, grid.seed).channels;
    presetId = genre.id;
  } else {
    if (!preset) {
      preset = TEST_PRESET;
      warnings.push(`Preset "${grid.genre}" does not exist; the score uses the built-in ${TEST_PRESET.id} preset.`);
    }
    channels = renderScore(grid, { seed: grid.seed, preset });
    presetId = preset.id;
  }
  const bytes = encodeWav24(channels, SAMPLE_RATE);
  const out = path.join(project, 'sound', 'score-raw.wav');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  return {
    raw: out,
    seconds: Math.round((channels[0].length / SAMPLE_RATE) * 1000) / 1000,
    sampleRate: SAMPLE_RATE,
    channels: 2,
    bitDepth: 24,
    bpm: grid.bpm,
    seed: grid.seed,
    preset: presetId,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    warnings,
  };
}

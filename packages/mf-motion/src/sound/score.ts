// score: render sound/score-raw.wav for a project from its resolved beat grid,
// seed and preset (the user-track and voice paths arrive in later tickets).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { readDoc } from '../schemas/index';
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
  let preset: Preset | undefined = PRESETS[grid.genre];
  if (!preset) {
    preset = TEST_PRESET;
    warnings.push(`Preset "${grid.genre}" is not available yet; the score uses the built-in ${TEST_PRESET.id} preset.`);
  }
  const channels = renderScore(grid, { seed: grid.seed, preset });
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
    preset: preset.id,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    warnings,
  };
}

// A user's track: a synth fixture with a known tempo (120 BPM) and a drop at a
// known bar (bar 9, 16.0 s) is analysed through the engine and through the
// forced fallback; the analysis validates; the fitted grid's @drop resolves to
// the drop bar; score --track fits plan/beatgrid.json.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import type { Engine } from '../../../../src/engine/index';
import { readDoc } from '../../../../src/schemas/index';
import { arrange, renderArrangement } from '../../../../src/sound/arrange';
import { GENRE_PRESETS } from '../../../../src/sound/presets/index';
import { SAMPLE_RATE, encodeWav24 } from '../../../../src/sound/synth/index';
import { type TrackAnalysisDoc, analyseTrack, fitGrid } from '../../../../src/sound/track';
import { resolveSpec } from '../../../../src/time/index';
import { testCacheRoot, testEngine } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BPM = 120;
const BAR = (60 / BPM) * 4;
const DROP_SEC = 8 * BAR; // bar 9
const TRACK_SEC = 16 * BAR + 1;
let engine: Engine;
let track = '';

beforeAll(async () => {
  engine = await testEngine();
  // Verse at 0.6, a pad-only break, then the drop at bar 9 with an impact and the full kit.
  const r = (sec: number) => ({ sec, frame: Math.round(sec * 30) });
  const grid = {
    bpm: BPM,
    beatsPerBar: 4,
    bars: 16,
    tailSec: 1,
    sections: [
      { name: 'verse', from: r(0), to: r(5 * BAR), energy: 0.6, riser: false, drop: false },
      { name: 'break', from: r(5 * BAR), to: r(8 * BAR), energy: 0.25, riser: false, drop: false },
      { name: 'drop', from: r(8 * BAR), to: r(16 * BAR), energy: 0.95, riser: false, drop: true },
    ],
  };
  const preset = GENRE_PRESETS['driving-electronic'];
  if (!preset) throw new Error('preset');
  track = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-track-')), 'fixture-track.wav');
  writeFileSync(track, encodeWav24(renderArrangement(arrange(grid, preset, 4), preset, 4).channels, SAMPLE_RATE));
}, 900_000);

function checkAnalysis(analysis: TrackAnalysisDoc) {
  expect(Math.abs(analysis.bpm - BPM)).toBeLessThanOrEqual(0.5);
  expect(analysis.drop).not.toBeNull();
  expect(Math.abs((analysis.drop?.atSec ?? 0) - DROP_SEC)).toBeLessThanOrEqual(60 / BPM);
  expect(analysis.meter).toBe(4);
  const fit = fitGrid(analysis, TRACK_SEC, 20);
  expect(fit.cues.drop).toMatch(/^bar\d+$/);
  // @drop on the fitted grid lands on the drop bar of the film (which starts at offsetSec in the track).
  const grid = { fps: '30', bpm: fit.bpm, beatsPerBar: fit.beatsPerBar, bars: fit.bars, tailSec: 0, cues: fit.cues };
  const dropInFilm = resolveSpec('@drop', grid).sec;
  expect(Math.abs(fit.offsetSec + dropInFilm - DROP_SEC)).toBeLessThanOrEqual(60 / BPM);
  expect(Math.abs((dropInFilm / BAR) % 1)).toBeLessThan(1e-6);
  return fit;
}

describe('analyseTrack', () => {
  it('through the engine: tempo within 0.5 BPM, drop within 1 beat, a valid track-analysis.json', async () => {
    const analysis = await analyseTrack(track, { engine, relPath: 'sound/track.wav' });
    expect(analysis.provider).toBe('hyperframes-local');
    checkAnalysis(analysis);
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-ta-')), 'track-analysis.json');
    writeFileSync(file, JSON.stringify(analysis));
    expect(readDoc('track-analysis', file).doc.drop?.confidence).toBeGreaterThan(0);
    console.log(`engine: bpm ${analysis.bpm}, drop ${JSON.stringify(analysis.drop)}, downbeats ${analysis.downbeats.slice(0, 3).join(',')}`);
  }, 300_000);

  it('through the forced fallback: the same tempo and drop', async () => {
    const analysis = await analyseTrack(track, { engine, forceFallback: true, relPath: 'sound/track.wav' });
    expect(analysis.provider).toBe('fallback');
    checkAnalysis(analysis);
    expect(analysis.sections.length).toBeGreaterThanOrEqual(2);
    console.log(`fallback: bpm ${analysis.bpm}, drop ${JSON.stringify(analysis.drop)}, downbeats ${analysis.downbeats.slice(0, 3).join(',')}`);
  }, 300_000);

  // The fallback's meyda features must not move when the meyda pin changes
  // (MFM-096). The snapshot was recorded on Linux; FFmpeg's decode differs in
  // the last bits elsewhere, where the tolerance checks above still apply.
  it.skipIf(process.platform !== 'linux')('through the forced fallback: BPM, beats, downbeats, drop and sections equal the recorded snapshot', async () => {
    const analysis = await analyseTrack(track, { engine, forceFallback: true, relPath: 'sound/track.wav' });
    const result = { bpm: analysis.bpm, meter: analysis.meter, beats: analysis.beats, downbeats: analysis.downbeats, drop: analysis.drop, sections: analysis.sections };
    const snapshot = path.join(packageRoot, 'test', 'render', 'sound', 'track', 'fallback-analysis.json');
    if (process.env.MFM_TRACK_SNAPSHOT === 'write') writeFileSync(snapshot, `${JSON.stringify(result, null, 2)}\n`);
    expect(result).toEqual(JSON.parse(readFileSync(snapshot, 'utf8')));
  }, 300_000);
});

describe('score --track', () => {
  it('copies the track, writes track-analysis.json and fits plan/beatgrid.json', async () => {
    const project = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-track-project-')), 'film');
    cpSync(path.join(packageRoot, 'test', 'fixtures', 'projects', 'film'), project, { recursive: true });
    const grid = {
      schemaVersion: 1, kind: 'beatgrid', bpm: 118, beatsPerBar: 4, bars: 10, tailSec: 0.8, requestedSec: 20, seed: 1, genre: 'driving-electronic', key: null, track: null,
      cues: { logo: 'bar9' }, sections: [{ name: 'all', from: 0, to: 'end', energy: 0.6, riser: false, drop: false }], shots: [], sfx: [],
    };
    writeFileSync(path.join(project, 'plan', 'beatgrid.json'), JSON.stringify(grid, null, 2));
    const result = await runIn(['score', '--track', track, '--project', project, '--json'], COMMANDS, { MF_MOTION_CACHE: testCacheRoot() });
    expect(result.code, result.stdout).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data).toMatchObject({ track: path.join(project, 'sound', 'track.wav'), provider: 'hyperframes-local', bpm: 120, gridUpdated: true });
    expect(readDoc('track-analysis', path.join(project, 'sound', 'track-analysis.json')).doc.file).toBe('sound/track.wav');
    const { doc } = readDoc('beatgrid', path.join(project, 'plan', 'beatgrid.json'));
    expect(doc).toMatchObject({ bpm: 120, beatsPerBar: 4, bars: 10, track: { path: 'sound/track.wav', analysis: 'sound/track-analysis.json' }, cues: { logo: 'bar9', drop: expect.stringMatching(/^bar\d+$/) } });
    expect(readFileSync(track)).toEqual(readFileSync(path.join(project, 'sound', 'track.wav')));
  }, 300_000);
});

// Mix and loudness: synth and track scores land at -14 +-1 LUFS and at most
// -1 dBTP; the bed sits at 15% through the 0.3 s before the hit; music ducks
// 8 dB under a voice; sound.json validates.
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { NUMBERS } from '../../../../src/kit/numbers';
import { readDoc } from '../../../../src/schemas/index';
import { arrange, renderArrangement } from '../../../../src/sound/arrange';
import { type Stereo, decodeStereo, mix } from '../../../../src/sound/mix';
import { normaliseTo } from '../../../../src/sound/loudness';
import { GENRE_PRESETS } from '../../../../src/sound/presets/index';
import { SAMPLE_RATE, encodeWav24, mulberry32, sin, TWO_PI } from '../../../../src/sound/synth/index';
import { loudness } from '../../../../src/sound/track';
import { testCacheRoot, testEngine } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const sfxGrid = path.join(packageRoot, 'test', 'unit', 'sound', 'sfx', 'grid-sfx.json');
const sr = SAMPLE_RATE;
const temp = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));

function project(): string {
  const dir = path.join(temp('mfm-mix-project-'), 'film');
  cpSync(path.join(packageRoot, 'test', 'fixtures', 'projects', 'film'), dir, { recursive: true });
  return dir;
}

/** A speech-like voice: band-passed noise in syllables, 2-6 s and 9-13 s, silent elsewhere. */
function voiceFixture(seconds: number): Stereo {
  const length = Math.round(seconds * sr);
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  const random = mulberry32(99);
  for (let n = 0; n < length; n += 1) {
    const t = n / sr;
    const speaking = (t >= 2 && t < 6) || (t >= 9 && t < 13);
    if (!speaking) continue;
    const syllable = 0.55 + 0.45 * sin(TWO_PI * 4 * t);
    const v = (sin(TWO_PI * 180 * t) * 0.5 + sin(TWO_PI * 720 * t) * 0.25 + (random() * 2 - 1) * 0.15) * syllable * 0.3;
    out[0][n] = v;
    out[1][n] = v;
  }
  return out;
}

const level = (audio: Float32Array, from: number, to: number) => {
  let sum = 0;
  const a = Math.round(from * sr);
  const b = Math.round(to * sr);
  for (let n = a; n < b; n += 1) sum += (audio[n] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, b - a));
};

beforeAll(async () => {
  await testEngine();
}, 900_000);

describe('score, synth mode', () => {
  it('writes sound/score.wav at -14 +-1 LUFS and at most -1 dBTP, and a valid sound.json', async () => {
    const dir = project();
    cpSync(sfxGrid, path.join(dir, 'plan', 'beatgrid.resolved.json'));
    const result = await runIn(['score', '--project', dir, '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data).toMatchObject({ mode: 'synth', sound: path.join(dir, 'sound', 'score.wav'), preset: 'driving-electronic' });
    const measured = await loudness(path.join(dir, 'sound', 'score.wav'));
    expect(Math.abs(measured.lufs - NUMBERS['audio.lufsTarget'])).toBeLessThanOrEqual(NUMBERS['audio.lufsTolerance']);
    expect(measured.truePeak).toBeLessThanOrEqual(NUMBERS['audio.truePeakMax']);
    const { doc } = readDoc('sound', path.join(dir, 'sound', 'sound.json'));
    expect(doc).toMatchObject({ mode: 'synth', file: 'sound/score.wav', raw: 'sound/score-raw.wav', bpm: 120, seed: 11, voice: null });
    expect(doc.sfx).toHaveLength(8);
    expect(existsSync(path.join(dir, 'sound', 'score-raw.wav'))).toBe(true);
    console.log(`synth: ${measured.lufs} LUFS, ${measured.truePeak} dBTP, lowShare ${doc.lowShare}`);
  }, 300_000);
});

describe('score, track mode', () => {
  it('trims and normalises the user track to -14 +-1 LUFS and at most -1 dBTP', async () => {
    const dir = project();
    const preset = GENRE_PRESETS['driving-electronic'];
    if (!preset) throw new Error('preset');
    const bar = 2;
    const r = (sec: number) => ({ sec, frame: Math.round(sec * 30) });
    const sections = [
      { name: 'verse', from: r(0), to: r(5 * bar), energy: 0.6, riser: false, drop: false },
      { name: 'break', from: r(5 * bar), to: r(8 * bar), energy: 0.25, riser: false, drop: false },
      { name: 'drop', from: r(8 * bar), to: r(16 * bar), energy: 0.95, riser: false, drop: true },
    ];
    const track = path.join(temp('mfm-mix-track-'), 'my-song.wav');
    writeFileSync(track, encodeWav24(renderArrangement(arrange({ bpm: 120, beatsPerBar: 4, bars: 16, tailSec: 1, sections }, preset, 4), preset, 4).channels, sr));
    const grid = JSON.parse(readFileSync(sfxGrid, 'utf8'));
    grid.genre = 'driving-electronic';
    grid.track = { path: 'sound/track.wav', analysis: 'sound/track-analysis.json', offsetSec: 0 };
    writeFileSync(path.join(dir, 'plan', 'beatgrid.resolved.json'), JSON.stringify(grid));
    const result = await runIn(['score', '--track', track, '--project', dir, '--json'], COMMANDS, { MF_MOTION_CACHE: testCacheRoot() });
    expect(result.code, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({ mode: 'track', sound: path.join(dir, 'sound', 'score.wav'), bpm: 120 });
    const measured = await loudness(path.join(dir, 'sound', 'score.wav'));
    expect(Math.abs(measured.lufs - NUMBERS['audio.lufsTarget'])).toBeLessThanOrEqual(NUMBERS['audio.lufsTolerance']);
    expect(measured.truePeak).toBeLessThanOrEqual(NUMBERS['audio.truePeakMax']);
    expect(readDoc('sound', path.join(dir, 'sound', 'sound.json')).doc).toMatchObject({ mode: 'track', raw: null, seconds: grid.lengthSec });
    // The track itself was copied unchanged.
    expect(readFileSync(path.join(dir, 'sound', 'track.wav'))).toEqual(readFileSync(track));
    console.log(`track: ${measured.lufs} LUFS, ${measured.truePeak} dBTP`);
  }, 300_000);
});

describe('mix', () => {
  const grid = JSON.parse(readFileSync(sfxGrid, 'utf8'));
  const preset = GENRE_PRESETS['driving-electronic'];
  if (!preset) throw new Error('preset');
  const bed = renderArrangement(arrange(grid, preset, grid.seed), preset, grid.seed).channels;

  it('holds the bed at most 15% of its pre-dip level through the 0.3 s before the hit', () => {
    const result = mix({ bed, sfx: grid.sfx, voice: null, seed: grid.seed, fps: 30, sampleRate: sr });
    const hit = result.cues.find((cue) => cue.role === 'hit');
    if (!hit) throw new Error('no hit');
    const before = level(bed[0], hit.peakAtSec - 0.3, hit.peakAtSec - 0.005);
    const dipped = level(result.music[0], hit.peakAtSec - 0.3, hit.peakAtSec - 0.005);
    expect(dipped).toBeLessThanOrEqual(before * NUMBERS['mix.preHitDip'].level + 1e-9);
    // The end fades to silence over mix.endFadeSec.
    expect(Math.abs(result.channels[0][result.channels[0].length - 1] ?? 1)).toBeLessThan(1e-6);
  });

  it('with a voice file the music sits 8 dB lower under speech', async () => {
    const dir = temp('mfm-voice-');
    const raw = path.join(dir, 'voice-raw.wav');
    writeFileSync(raw, encodeWav24(voiceFixture(bed[0].length / sr), sr));
    const normalised = path.join(dir, 'voice-16.wav');
    const voiceLevel = await normaliseTo(raw, normalised, -16);
    expect(Math.abs(voiceLevel.lufs - -16)).toBeLessThanOrEqual(1);
    const voice = await decodeStereo(normalised, sr);
    const result = mix({ bed, sfx: [], voice, seed: 1, fps: 30, sampleRate: sr });
    // Mid-phrase (attack settled) and well away from speech (release settled).
    const under = 20 * Math.log10(level(result.music[0], 3, 5.5) / level(bed[0], 3, 5.5));
    const clear = 20 * Math.log10(level(result.music[0], 7.5, 8.5) / level(bed[0], 7.5, 8.5));
    expect(under).toBeCloseTo(NUMBERS['mix.voiceDuckDb'], 0);
    expect(Math.abs(clear)).toBeLessThan(0.2);
    console.log(`voice: music ${under.toFixed(2)} dB under speech, ${clear.toFixed(2)} dB clear`);
  }, 120_000);

  it('score with sound/voice.wav records the voice in sound.json', async () => {
    const dir = project();
    cpSync(sfxGrid, path.join(dir, 'plan', 'beatgrid.resolved.json'));
    const voicePath = path.join(dir, 'sound', 'voice.wav');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(voicePath), { recursive: true });
    writeFileSync(voicePath, encodeWav24(voiceFixture(20.8), sr));
    const result = await runIn(['score', '--project', dir, '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    expect(readDoc('sound', path.join(dir, 'sound', 'sound.json')).doc.voice).toBe('sound/voice.wav');
  }, 300_000);
});

describe('loudness limiting', () => {
  it('limits peaks before the linear pass without delaying them', async () => {
    // A quiet steady tone with one loud 2 ms burst at 1.0 s: the gain to -14 LUFS forces the limiter.
    const seconds = 3;
    const signal: Stereo = [new Float32Array(seconds * sr), new Float32Array(seconds * sr)];
    const burst = Math.round(1.0 * sr);
    for (let n = 0; n < signal[0].length; n += 1) {
      let v = 0.02 * sin((TWO_PI * 440 * n) / sr);
      if (n >= burst && n < burst + Math.round(0.002 * sr)) v += 0.9 * sin((TWO_PI * 3000 * (n - burst)) / sr);
      signal[0][n] = v;
      signal[1][n] = v;
    }
    const work = mkdtempSync(path.join(tmpdir(), 'mfm-limit-test-'));
    const input = path.join(work, 'in.wav');
    writeFileSync(input, encodeWav24(signal, sr));
    const output = path.join(work, 'out.wav');
    const measured = await normaliseTo(input, output, NUMBERS['audio.lufsTarget']);
    expect(measured.truePeak).toBeLessThanOrEqual(NUMBERS['audio.truePeakMax']);
    const [left] = await decodeStereo(output, sr);
    expect(left.length).toBe(signal[0].length);
    // The lag where the output best matches the input around the burst: none, to within 0.25 ms.
    const from = burst - Math.round(0.02 * sr);
    const to = burst + Math.round(0.02 * sr);
    let bestLag = 0;
    let best = Number.NEGATIVE_INFINITY;
    for (let lag = -Math.round(0.01 * sr); lag <= Math.round(0.01 * sr); lag += 1) {
      let sum = 0;
      for (let n = from; n < to; n += 1) sum += (signal[0][n] ?? 0) * (left[n + lag] ?? 0);
      if (sum > best) {
        best = sum;
        bestLag = lag;
      }
    }
    expect(Math.abs(bestLag) / sr).toBeLessThanOrEqual(0.00025);
  }, 120_000);
});

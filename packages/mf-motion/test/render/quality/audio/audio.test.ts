// Audio metrics on seeded-defect films: too quiet, too hot, a late SFX, a flat
// SFX, a bass-heavy bed, and a clean film with no audio cap.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NUMBERS } from '../../../../src/kit/numbers';
import { measure } from '../../../../src/quality/metrics';
import { loudnorm } from '../../../../src/sound/loudness';
import { type Stereo, encodeWavFloat } from '../../../../src/sound/mix';
import { type SfxCueInput, measureRise, mixSfx } from '../../../../src/sound/sfx';
import { Svf } from '../../../../src/sound/synth/dsp';
import { whiteNoise } from '../../../../src/sound/synth/voices';
import { loudness } from '../../../../src/sound/track';

const sr = NUMBERS['audio.sampleRate'];
const SECONDS = 6;
const FPS = 30;
let dir = '';
const files: Record<string, { video: string; sound: string }> = {};

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

/** A bed: high-passed noise with a soft chord, plus an optional 60 Hz hum share. */
function bed(lowGain = 0): Stereo {
  const length = SECONDS * sr;
  const noise = whiteNoise(7);
  const high = new Svf(sr, 300, 0.707);
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  for (let n = 0; n < length; n += 1) {
    const t = n / sr;
    const v = high.process(noise(), 'high') * 0.08 + 0.05 * Math.sin(2 * Math.PI * 440 * t) + 0.04 * Math.sin(2 * Math.PI * 660 * t) + lowGain * Math.sin(2 * Math.PI * 60 * t);
    out[0][n] = v;
    out[1][n] = v;
  }
  return out;
}

// A pop and a whoosh: their peaks stay under the loudness pre-limiter on this steady
// bed (a click, type or hit there is limited and measures a weak rise).
const SEED = 3;
const cues: SfxCueInput[] = [
  { role: 'pop', at: { sec: 1.5 }, event: 'badge' },
  { role: 'whoosh', at: { sec: 3.5 }, event: 'swap' },
];

async function film(name: string, audio: Stereo, soundCues: Array<{ role: string; event: string; atSec: number; peakAtSec: number; gainDb: number }>, finalGainDb = 0) {
  const raw = path.join(dir, `${name}-mix.wav`);
  writeFileSync(raw, await encodeWavFloat(audio, sr));
  const normalised = path.join(dir, `${name}-norm.wav`);
  await loudnorm(raw, normalised);
  let audioFile = normalised;
  if (finalGainDb !== 0) {
    audioFile = path.join(dir, `${name}-gain.wav`);
    ffmpeg(['-i', normalised, '-af', `volume=${finalGainDb}dB`, '-c:a', 'pcm_f32le', audioFile]);
  }
  const video = path.join(dir, `${name}.mov`);
  ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=${FPS}:duration=${SECONDS}`, '-i', audioFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s24le', '-shortest', video]);
  const sound = path.join(dir, `${name}-sound.json`);
  writeFileSync(sound, JSON.stringify({ seed: SEED, sfx: soundCues }));
  files[name] = { video, sound };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfm-audio-metrics-'));
  const clean = mixSfx(bed(), cues, { seed: SEED, fps: FPS, sampleRate: sr });
  const soundCues = clean.cues.map(({ role, event, atSec, peakAtSec, gainDb }) => ({ role, event, atSec, peakAtSec, gainDb }));
  await film('clean', clean.channels, soundCues);
  await film('quiet', clean.channels, soundCues, -4);
  // The clean mix sits near -1.3 dBTP after normalisation; +1 dB lands near -0.3 dBTP.
  const cleanLevel = await loudness(path.join(dir, 'clean-norm.wav'));
  await film('hot', clean.channels, soundCues, -0.3 - cleanLevel.truePeak);
  // The SFX placed 3 frames late; sound.json keeps the planned times.
  const late = mixSfx(bed(), cues.map((cue) => ({ ...cue, at: { sec: cue.at.sec + 3 / FPS } })), { seed: SEED, fps: FPS, sampleRate: sr });
  await film('late', late.channels, soundCues);
  // The whoosh about 1 dB over the bed: the SFX-only signal scaled down.
  const flat: Stereo = [Float32Array.from(clean.bed[0]), Float32Array.from(clean.bed[1])];
  let scale = 1;
  const whoosh = clean.cues[1];
  if (!whoosh) throw new Error('whoosh');
  for (let i = 0; i < 40; i += 1) {
    for (let c = 0; c < 2; c += 1) for (let n = 0; n < flat[c]!.length; n += 1) flat[c]![n] = clean.bed[c]![n]! + (clean.channels[c]![n]! - clean.bed[c]![n]!) * scale;
    const rise = measureRise(flat, whoosh.baselineSec, whoosh.peakAtSec, sr);
    if (rise <= 1.2) break;
    scale *= 0.85;
  }
  await film('flat', flat, soundCues);
  // A bed with about 70% of its energy under 150 Hz.
  const bassy = mixSfx(bed(0.17), cues, { seed: SEED, fps: FPS, sampleRate: sr });
  await film('bassy', bassy.channels, bassy.cues.map(({ role, event, atSec, peakAtSec, gainDb }) => ({ role, event, atSec, peakAtSec, gainDb })));
}, 600_000);

const run = (name: string) => measure(files[name]!.video, { profile: 'film', expectedSec: SECONDS, soundFile: files[name]!.sound });
const audioCaps = (metrics: Record<string, any>) => (metrics.caps as Array<{ axis: string; cap: number; because: string }>).filter((cap) => /Loudness|low-end|SFX/.test(cap.because));

describe('audio metrics', () => {
  it('a clean fixture film has no audio cap', async () => {
    const metrics = await run('clean');
    const audio = metrics.audio as { lufs: number; truePeak: number; lowShare: number; sfx: Array<{ peakOffsetMs: number; riseDb: number }> };
    expect(Math.abs(audio.lufs + 14)).toBeLessThanOrEqual(1);
    expect(audio.truePeak).toBeLessThanOrEqual(-1);
    expect(audio.lowShare).toBeLessThan(NUMBERS['bed.lowShareMax'].share);
    expect(audio.sfx).toHaveLength(2);
    for (const cue of audio.sfx) {
      expect(Math.abs(cue.peakOffsetMs - (NUMBERS['sfx.peakOffsetFrames'] * 1000) / FPS)).toBeLessThanOrEqual(1000 / FPS);
      expect(cue.riseDb).toBeGreaterThanOrEqual(NUMBERS['sfx.riseDb'].min);
    }
    expect(audioCaps(metrics)).toEqual([]);
    expect((metrics.hard as Array<{ check: string; pass: boolean }>).find((entry) => entry.check === 'true-peak')).toMatchObject({ pass: true });
    console.log(`clean: ${JSON.stringify(audio)}`);
  }, 120_000);

  it('a mix 4 LU too quiet caps finish at 7', async () => {
    expect(audioCaps(await run('quiet'))).toEqual([expect.objectContaining({ axis: 'finish', cap: 7 })]);
  }, 120_000);

  it('a true peak of -0.3 dBTP is a hard failure', async () => {
    const metrics = await run('hot');
    expect((metrics.audio as { truePeak: number }).truePeak).toBeGreaterThan(-1);
    expect((metrics.hard as Array<{ check: string; pass: boolean }>).find((entry) => entry.check === 'true-peak')).toMatchObject({ pass: false });
  }, 120_000);

  it('an SFX 3 frames late caps rhythm at 7', async () => {
    const caps = audioCaps(await run('late'));
    expect(caps).toEqual([expect.objectContaining({ axis: 'rhythm', cap: 7 })]);
  }, 120_000);

  it('an SFX 1 dB over the bed caps rhythm at 8', async () => {
    const caps = audioCaps(await run('flat'));
    expect(caps).toEqual([expect.objectContaining({ axis: 'rhythm', cap: 8 })]);
  }, 120_000);

  it('a bed with 70% energy under 150 Hz caps finish at 8', async () => {
    const metrics = await run('bassy');
    expect((metrics.audio as { lowShare: number }).lowShare).toBeGreaterThan(0.6);
    expect(audioCaps(metrics)).toEqual([expect.objectContaining({ axis: 'finish', cap: 8 })]);
  }, 120_000);

  it('move profiles never get audio metrics', async () => {
    const metrics = await measure(files.clean!.video, { profile: 'broll', expectedSec: SECONDS, soundFile: files.clean!.sound });
    expect(metrics.audio).toBeNull();
  }, 120_000);
});

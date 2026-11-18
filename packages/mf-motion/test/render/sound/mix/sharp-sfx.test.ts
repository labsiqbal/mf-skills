// MFM-095: sharp SFX keep their rise over a steady bed after two-pass loudness
// normalisation. The MFM-071 steady bed (6 s; 300 Hz high-passed white noise
// seed 7 at 0.08 plus 440 Hz at 0.05 and 660 Hz at 0.04) carries a click, a
// type, a tick and the hit; it is mixed and normalised with the production
// path and measured with the MFM-071 metric.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { NUMBERS } from '../../../../src/kit/numbers';
import { audioMetrics } from '../../../../src/quality/audioMetrics';
import { loudnorm } from '../../../../src/sound/loudness';
import { type Stereo, encodeWavFloat } from '../../../../src/sound/mix';
import { type SfxCueInput, mixSfx } from '../../../../src/sound/sfx';
import { Svf } from '../../../../src/sound/synth/dsp';
import { whiteNoise } from '../../../../src/sound/synth/voices';
import { testEngine } from '../../../helpers/engine';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixture = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'unit', 'sound', 'sfx', 'sharp-cues.json'), 'utf8')) as { seed: number; fps: number; cues: SfxCueInput[] };
const sr = NUMBERS['audio.sampleRate'];

function steadyBed(): Stereo {
  const length = 6 * sr;
  const noise = whiteNoise(7);
  const high = new Svf(sr, 300, 0.707);
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  for (let n = 0; n < length; n += 1) {
    const t = n / sr;
    const v = high.process(noise(), 'high') * 0.08 + 0.05 * Math.sin(2 * Math.PI * 440 * t) + 0.04 * Math.sin(2 * Math.PI * 660 * t);
    out[0][n] = v;
    out[1][n] = v;
  }
  return out;
}

/** Mix, normalise and measure once; returns the normalised file's bytes too. */
async function run() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-sharp-sfx-'));
  const mixed = mixSfx(steadyBed(), fixture.cues, { seed: fixture.seed, fps: fixture.fps, sampleRate: sr });
  const raw = path.join(dir, 'score-raw.wav');
  writeFileSync(raw, await encodeWavFloat(mixed.channels, sr));
  const score = path.join(dir, 'score.wav');
  const level = await loudnorm(raw, score);
  const sound = path.join(dir, 'sound.json');
  writeFileSync(sound, JSON.stringify({ seed: fixture.seed, sfx: mixed.cues.map(({ role, event, atSec, peakAtSec }) => ({ role, event, atSec, peakAtSec })) }));
  const metrics = await audioMetrics(score, { hasAudio: true, soundFile: sound, fps: fixture.fps });
  return { level, metrics, bytes: readFileSync(score), cues: mixed.cues };
}

let first: Awaited<ReturnType<typeof run>>;

beforeAll(async () => {
  await testEngine();
  first = await run();
}, 900_000);

describe('sharp SFX on a steady bed, normalised', () => {
  it('every cue rises within 1 dB of its sfx.riseDb target and none under the floor', () => {
    const rise = NUMBERS['sfx.riseDb'];
    expect(first.metrics?.sfx.map((cue) => cue.role)).toEqual(['click', 'type', 'tick', 'hit']);
    for (const cue of first.metrics?.sfx ?? []) {
      const target = cue.role === 'hit' ? rise.hit : rise.target;
      console.log(`${cue.role}: rise ${cue.riseDb} dB (target ${target}), peak offset ${cue.peakOffsetMs} ms`);
      expect(Math.abs(cue.riseDb - target), cue.role).toBeLessThanOrEqual(1);
      expect(cue.riseDb, cue.role).toBeGreaterThanOrEqual(rise.min);
    }
  });

  it('stays at -14 +-1 LUFS and at most -1 dBTP, with every peak within sfx.peakToleranceFrames', () => {
    console.log(`score: ${first.level.lufs} LUFS, ${first.level.truePeak} dBTP; gains ${first.cues.map((cue) => `${cue.role} ${cue.gainDb}`).join(', ')}`);
    expect(Math.abs(first.level.lufs - NUMBERS['audio.lufsTarget'])).toBeLessThanOrEqual(NUMBERS['audio.lufsTolerance']);
    expect(first.level.truePeak).toBeLessThanOrEqual(NUMBERS['audio.truePeakMax']);
    const frameMs = 1000 / fixture.fps;
    for (const cue of first.metrics?.sfx ?? []) {
      expect(Math.abs(cue.peakOffsetMs - NUMBERS['sfx.peakOffsetFrames'] * frameMs), cue.role).toBeLessThanOrEqual(NUMBERS['sfx.peakToleranceFrames'] * frameMs);
    }
  });

  it('two runs with the same seed write a byte-identical score.wav', async () => {
    const again = await run();
    expect(again.bytes.equals(first.bytes)).toBe(true);
  }, 600_000);
});

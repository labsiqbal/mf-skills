// Audio metrics of a delivered file: integrated loudness and true peak
// (FFmpeg ebur128), the low-end share (150 Hz split over 4096-sample FFT
// windows), and each SFX cue's measured peak offset and rise against the
// 300-4000 Hz band of the mix. Each cue's SFX is regenerated from the
// sound.json seed; its peak in the mix is where its band envelope matches the
// mix's best. The rise is read like the mixer sets it: 40 ms around the peak
// against the 300 ms of bed before the SFX starts, before the pre-hit dip for
// the hit.
import { existsSync, readFileSync } from 'node:fs';
import { NUMBERS } from '../kit/numbers';
import { decodeStereo } from '../sound/mix';
import { type SfxRole, bandRms, generateSfx, toDb } from '../sound/sfx';
import { Svf } from '../sound/synth/dsp';
import { voiceSeed } from '../sound/synth/math';
import { loudness } from '../sound/track';

export const FFT_SIZE = 4096;
/** Search window around an SFX's planned peak, in seconds. */
export const PEAK_SEARCH_SEC = 0.25;

export interface AudioMetrics {
  lufs: number;
  truePeak: number;
  lowShare: number;
  sfx: Array<{ role: string; event: string; atSec: number; peakOffsetMs: number; riseDb: number }>;
}

/** In-place radix-2 FFT of real input (re, im arrays of a power-of-two length). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const ti = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - tr;
        im[b] = (im[a] ?? 0) - ti;
        re[a] = (re[a] ?? 0) + tr;
        im[a] = (im[a] ?? 0) + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Share of spectral energy below `belowHz` over Hann-windowed 4096-sample frames (hop 4096). */
export function lowShareFft(mono: Float64Array, sampleRate: number, belowHz: number): number {
  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const cut = Math.floor((belowHz * FFT_SIZE) / sampleRate);
  let below = 0;
  let total = 0;
  for (let start = 0; start + FFT_SIZE <= mono.length; start += FFT_SIZE) {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i += 1) re[i] = (mono[start + i] ?? 0) * (window[i] ?? 0);
    fft(re, im);
    for (let k = 1; k < FFT_SIZE / 2; k += 1) {
      const power = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
      total += power;
      if (k <= cut) below += power;
    }
  }
  return total > 0 ? Math.round((below / total) * 1000) / 1000 : 0;
}

interface SoundCue {
  role: string;
  event: string;
  atSec: number;
  peakAtSec: number;
}

/** Audio metrics, or null when the file has no audio stream. */
export async function audioMetrics(file: string, options: { hasAudio: boolean; soundFile?: string | null; fps: number }): Promise<AudioMetrics | null> {
  if (!options.hasAudio) return null;
  const sr = NUMBERS['audio.sampleRate'];
  const level = await loudness(file);
  const [left, right] = await decodeStereo(file, sr);
  const mono = new Float64Array(left.length);
  for (let n = 0; n < mono.length; n += 1) mono[n] = ((left[n] ?? 0) + (right[n] ?? 0)) / 2;
  const lowShare = lowShareFft(mono, sr, NUMBERS['bed.lowShareMax'].belowHz);

  const sound: { seed?: number | null; sfx?: SoundCue[] } = options.soundFile && existsSync(options.soundFile) ? (JSON.parse(readFileSync(options.soundFile, 'utf8')) as { seed?: number | null; sfx?: SoundCue[] }) : {};
  const cues = sound.sfx ?? [];
  // The mixer's seed (a null seed mixes as 0), so each cue's SFX regenerates exactly.
  const seed = sound.seed ?? 0;
  const dip = NUMBERS['mix.preHitDip'].sec;
  const sfx = cues.map((cue, i) => {
    // The measured peak: where the SFX's band envelope best matches the mix's, near the planned peak.
    const generated = generateSfx(cue.role as SfxRole, sr, voiceSeed(seed, `sfx:${cue.role}:${cue.event}:${i}`));
    const planned = Math.round(cue.peakAtSec * sr);
    const peakAt = matchPeak(mono, generated.buffer, generated.peakOffset, planned, sr);
    // Rise: 40 ms around the peak against the 300 ms of bed before the SFX (before the dip for the hit).
    const own = Math.round(0.02 * sr);
    const start = peakAt - generated.peakOffset;
    const onset = cue.role === 'hit' ? Math.min(start, peakAt - Math.round(dip * sr) - Math.round(0.03 * sr)) : start;
    const riseDb = toDb(bandRms(mono, peakAt - own, peakAt + own, sr) / Math.max(1e-9, bandRms(mono, onset - Math.round(0.3 * sr), onset, sr)));
    return { role: cue.role, event: cue.event, atSec: cue.atSec, peakOffsetMs: Math.round((peakAt / sr - cue.atSec) * 1000 * 10) / 10, riseDb: Math.round(riseDb * 10) / 10 };
  });
  return { lufs: level.lufs, truePeak: level.truePeak, lowShare, sfx };
}

/** Envelope resolution for peak matching, in samples per block. */
const BLOCK = 24;

/** Mean bed-band power per BLOCK samples of `signal` from `from` (absolute index) for `blocks` blocks. */
function bandEnvelope(signal: ArrayLike<number>, from: number, blocks: number, sr: number): Float64Array {
  const band = NUMBERS['sfx.bedBandHz'];
  const high = new Svf(sr, band.min, 0.707);
  const low = new Svf(sr, band.max, 0.707);
  const warm = Math.round(0.05 * sr);
  const out = new Float64Array(blocks);
  for (let n = from - warm; n < from + blocks * BLOCK; n += 1) {
    const x = n >= 0 && n < signal.length ? (signal[n] ?? 0) : 0;
    const y = low.process(high.process(x, 'high'), 'low');
    if (n >= from) out[Math.floor((n - from) / BLOCK)] = (out[Math.floor((n - from) / BLOCK)] ?? 0) + (y * y) / BLOCK;
  }
  return out;
}

/**
 * The SFX peak in the mix: the lag within PEAK_SEARCH_SEC of the planned peak
 * where the generated SFX's band envelope correlates best (Pearson) with the
 * mix's band envelope, at BLOCK-sample resolution.
 */
function matchPeak(mono: Float64Array, sfx: Float64Array, peakOffset: number, planned: number, sr: number): number {
  const templateBlocks = Math.max(1, Math.ceil(sfx.length / BLOCK));
  const pad = Math.round(0.08 * sr);
  const padded = new Float64Array(pad + sfx.length);
  padded.set(sfx, pad);
  const template = bandEnvelope(padded, pad, templateBlocks, sr);
  const span = Math.ceil((PEAK_SEARCH_SEC * sr) / BLOCK);
  const firstStart = planned - peakOffset - span * BLOCK;
  const mix = bandEnvelope(mono, firstStart, 2 * span + templateBlocks, sr);
  let tMean = 0;
  for (const v of template) tMean += v / templateBlocks;
  let tVar = 0;
  for (const v of template) tVar += (v - tMean) ** 2;
  let bestLag = span;
  let best = -Infinity;
  for (let lag = 0; lag <= 2 * span; lag += 1) {
    let mMean = 0;
    for (let i = 0; i < templateBlocks; i += 1) mMean += (mix[lag + i] ?? 0) / templateBlocks;
    let cov = 0;
    let mVar = 0;
    for (let i = 0; i < templateBlocks; i += 1) {
      const m = (mix[lag + i] ?? 0) - mMean;
      cov += m * ((template[i] ?? 0) - tMean);
      mVar += m * m;
    }
    const score = cov / Math.sqrt(Math.max(1e-30, mVar * tVar));
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return firstStart + bestLag * BLOCK + peakOffset;
}

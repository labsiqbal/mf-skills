// SFX: synthesised one-shots for visible events. Each generator returns its
// buffer and peak offset; placement lands the peak at the picture time plus
// sfx.peakOffsetFrames; gain sits sfx.riseDb over the bed (300-4000 Hz, the
// 300 ms before the SFX starts), the bed yields around each SFX and dips
// before the one hit.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import type { ArrangedEvent } from './arrange';
import { Svf } from './synth/dsp';
import { LN2, TWO_PI, dbToGain, decayCoefficient, exp2, mulberry32, sin, voiceSeed } from './synth/math';
import { pinkNoise, renderBell, renderKick, renderRiser, whiteNoise } from './synth/voices';

export const SFX_ROLES = NUMBERS['sfx.roles'].roles;
export type SfxRole = (typeof SFX_ROLES)[number];

export interface SfxBuffer {
  buffer: Float64Array;
  /** Sample index of the peak (largest absolute value). */
  peakOffset: number;
}

/** log2 with + - * / only: exact power-of-two reduction, then 2 atanh((m-1)/(m+1)). */
export function log2(x: number): number {
  if (!(x > 0)) return Number.NEGATIVE_INFINITY;
  let m = x;
  let e = 0;
  while (m >= 2) {
    m /= 2;
    e += 1;
  }
  while (m < 1) {
    m *= 2;
    e -= 1;
  }
  const z = (m - 1) / (m + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let k = 1; k <= 41; k += 2) {
    sum += term / k;
    term *= z2;
  }
  return e + (2 * sum) / LN2;
}

/** 20 log10(x) */
export const toDb = (x: number) => log2(x) * 6.020599913279624;

function peakOf(buffer: Float64Array): number {
  let peak = 0;
  let at = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const v = Math.abs(buffer[i] ?? 0);
    if (v > peak) {
      peak = v;
      at = i;
    }
  }
  return at;
}

const make = (seconds: number, sr: number) => new Float64Array(Math.round(seconds * sr));

/** One generator per role (sfx.roles). */
export function generateSfx(role: SfxRole, sr: number, seed: number): SfxBuffer {
  let buffer: Float64Array;
  switch (role) {
    case 'click': {
      buffer = make(0.03, sr);
      const noise = whiteNoise(seed);
      const high = new Svf(sr, 3000, 0.7);
      const decay = decayCoefficient(0.006, sr);
      let level = 1;
      for (let n = 0; n < buffer.length; n += 1) {
        buffer[n] = (high.process(noise(), 'high') * 0.8 + sin((TWO_PI * 2000 * n) / sr) * 0.4) * level;
        level *= decay;
      }
      break;
    }
    case 'tick': {
      buffer = make(0.05, sr);
      const decay = decayCoefficient(0.02, sr);
      let level = 1;
      for (let n = 0; n < buffer.length; n += 1) {
        buffer[n] = sin((TWO_PI * 3200 * n) / sr) * level * (n < 24 ? n / 24 : 1);
        level *= decay;
      }
      break;
    }
    case 'type': {
      buffer = make(0.06, sr);
      const noise = whiteNoise(seed);
      const band = new Svf(sr, 2500, 1.3);
      const decay = decayCoefficient(0.018, sr);
      let level = 1;
      const second = Math.round(0.012 * sr);
      for (let n = 0; n < buffer.length; n += 1) {
        if (n === second) level = Math.max(level, 0.6);
        buffer[n] = band.process(noise(), 'band') * level * 3;
        level *= decay;
      }
      break;
    }
    case 'pop': {
      buffer = make(0.09, sr);
      const bend = decayCoefficient(0.03, sr);
      const decay = decayCoefficient(0.07, sr);
      let phase = 0;
      let pitch = 1;
      let level = 1;
      for (let n = 0; n < buffer.length; n += 1) {
        phase += (300 + 600 * pitch) / sr;
        pitch *= bend;
        buffer[n] = sin(TWO_PI * (phase - Math.floor(phase))) * level * (n < 48 ? n / 48 : 1);
        level *= decay;
      }
      break;
    }
    case 'whoosh': {
      buffer = make(0.55, sr);
      const noise = pinkNoise(seed);
      const band = new Svf(sr, 400, 1.1);
      for (let n = 0; n < buffer.length; n += 1) {
        const t = n / buffer.length;
        if (n % 64 === 0) band.set(400 * exp2(t * 3.5), 1.1);
        const swell = t < 0.7 ? t / 0.7 : (1 - t) / 0.3;
        buffer[n] = band.process(noise(), 'band') * swell * swell * 4;
      }
      break;
    }
    case 'hit': {
      buffer = make(1.2, sr);
      renderKick(buffer, 0, 1, seed, sr, 1.5);
      const noise = whiteNoise(voiceSeed(seed, 'crash'));
      const high = new Svf(sr, 4000, 0.7);
      const decay = decayCoefficient(0.9, sr);
      let level = 0.35;
      for (let n = 0; n < buffer.length; n += 1) {
        buffer[n] = (buffer[n] ?? 0) + high.process(noise(), 'high') * level;
        level *= decay;
      }
      renderBell(buffer, 0, 220, 1.1, 0.25, sr, 3.5, 2.8);
      break;
    }
    case 'shimmer': {
      buffer = make(1.5, sr);
      const random = mulberry32(seed);
      for (let i = 0; i < 4; i += 1) renderBell(buffer, Math.round(i * 0.04 * sr), 1760 * (1 + Math.floor(random() * 3) * 0.25), 1.3, 0.3, sr, 7, 1.2);
      break;
    }
    case 'riser': {
      buffer = make(2, sr);
      renderRiser(buffer, 0, 2, 1, seed, sr);
      break;
    }
  }
  return { buffer, peakOffset: peakOf(buffer) };
}

/** RMS of a mono signal in the bed band (sfx.bedBandHz) between two sample indices. */
export function bandRms(signal: ArrayLike<number>, from: number, to: number, sr: number): number {
  const band = NUMBERS['sfx.bedBandHz'];
  const high = new Svf(sr, band.min, 0.707);
  const low = new Svf(sr, band.max, 0.707);
  const start = Math.max(0, from - Math.round(0.05 * sr));
  let sum = 0;
  let count = 0;
  for (let n = start; n < Math.min(signal.length, to); n += 1) {
    const y = low.process(high.process(signal[n] ?? 0, 'high'), 'low');
    if (n >= from) {
      sum += y * y;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

export interface SfxCueInput {
  role: string;
  /** Picture time (frame-snapped). */
  at: { sec: number };
  event: string;
}

export interface PlacedCue {
  role: SfxRole;
  event: string;
  atSec: number;
  /** Where the SFX buffer starts. */
  startSec: number;
  peakAtSec: number;
  gainDb: number;
}

/** sfx.roles only, and at most one hit per film (sfx.roles hitMaxPerFilm). */
export function checkCues(cues: SfxCueInput[]): void {
  const unknown = cues.filter((cue) => !(SFX_ROLES as readonly string[]).includes(cue.role));
  if (unknown.length > 0) throw new MfmError('GRID_INVALID', { roles: unknown.map((cue) => cue.role) }, { message: `Unknown SFX role(s): ${unknown.map((cue) => cue.role).join(', ')}.` });
  const hits = cues.filter((cue) => cue.role === 'hit');
  if (hits.length > NUMBERS['sfx.roles'].hitMaxPerFilm) {
    throw new MfmError('GRID_INVALID', { rule: 'G006', hits: hits.map((cue) => cue.event) }, { message: `A film has at most one hit; this grid has ${hits.length} (${hits.map((cue) => cue.event).join(', ')}).` });
  }
}

/** Arranged bed events yield inside sfx.ownWindowMs of an SFX peak: hats and plucks skip, kicks halve. */
export function yieldEvents(events: ArrangedEvent[], peaksSec: number[]): ArrangedEvent[] {
  const window = NUMBERS['sfx.ownWindowMs'] / 1000;
  const near = (at: number) => peaksSec.some((peak) => Math.abs(at - peak) <= window);
  return events
    .filter((event) => !((event.role === 'hat' || event.role === 'open-hat' || event.role === 'pluck') && near(event.at)))
    .map((event) => (event.role === 'kick' && near(event.at) ? { ...event, gain: event.gain / 2 } : event));
}

export interface SfxMix {
  /** Bed plus SFX. */
  channels: [Float32Array, Float32Array];
  /** The bed after yields and the pre-hit dip, without SFX. */
  bed: [Float32Array, Float32Array];
  cues: PlacedCue[];
}

/**
 * Place the grid's SFX on a rendered bed. Pass `bedYielded: true` when the bed
 * was rendered from events already passed through yieldEvents; otherwise the
 * bed is ducked 3 dB inside sfx.ownWindowMs of each SFX peak.
 */
export function mixSfx(bed: [Float32Array, Float32Array], cues: SfxCueInput[], options: { seed: number; fps: number; sampleRate: number; bedYielded?: boolean }): SfxMix {
  checkCues(cues);
  const sr = options.sampleRate;
  const length = bed[0].length;
  const left = Float32Array.from(bed[0]);
  const right = Float32Array.from(bed[1]);
  const offsetSec = NUMBERS['sfx.peakOffsetFrames'] / options.fps;
  const placements = cues.map((cue, i) => {
    const generated = generateSfx(cue.role as SfxRole, sr, voiceSeed(options.seed, `sfx:${cue.role}:${cue.event}:${i}`));
    const peakAt = Math.round((cue.at.sec + offsetSec) * sr);
    return { cue, generated, peakAt, start: peakAt - generated.peakOffset };
  });

  // The bed dips to mix.preHitDip over the 0.3 s before the hit, and yields around each SFX.
  const dip = NUMBERS['mix.preHitDip'];
  const window = Math.round((NUMBERS['sfx.ownWindowMs'] / 1000) * sr);
  const ramp = Math.round(0.01 * sr);
  const gainAt = new Float64Array(length).fill(1);
  for (const placement of placements) {
    if (placement.cue.role === 'hit') {
      const span = Math.round(dip.sec * sr);
      for (let k = 0; k < span; k += 1) {
        const n = placement.peakAt - span + k;
        if (n >= 0 && n < length) gainAt[n] = Math.min(gainAt[n] ?? 1, 1 - (1 - dip.level) * (k / span));
      }
    }
    if (!options.bedYielded) {
      const duck = dbToGain(-3);
      for (let n = placement.peakAt - window - ramp; n <= placement.peakAt + window + ramp; n += 1) {
        if (n < 0 || n >= length) continue;
        const edge = Math.min(n - (placement.peakAt - window - ramp), placement.peakAt + window + ramp - n);
        const g = edge >= ramp ? duck : 1 - (1 - duck) * (edge / ramp);
        gainAt[n] = Math.min(gainAt[n] ?? 1, g);
      }
    }
  }
  for (let n = 0; n < length; n += 1) {
    const g = gainAt[n] ?? 1;
    left[n] = (left[n] ?? 0) * g;
    right[n] = (right[n] ?? 0) * g;
  }
  const bedOut: [Float32Array, Float32Array] = [Float32Array.from(left), Float32Array.from(right)];

  // Gain: the SFX around its peak sits sfx.riseDb over the bed band in the 300 ms before.
  const rise = NUMBERS['sfx.riseDb'];
  const mono = new Float64Array(length);
  for (let n = 0; n < length; n += 1) mono[n] = ((left[n] ?? 0) + (right[n] ?? 0)) / 2;
  const before = Math.round(0.3 * sr);
  const own = Math.round(0.02 * sr);
  const placed: PlacedCue[] = [];
  for (const placement of placements) {
    // The local bed: the 300 ms before the SFX starts (long SFX such as risers build before their peak).
    const onset = Math.max(0, placement.start);
    const bedLevel = Math.max(bandRms(mono, onset - before, onset, sr), dbToGain(-60));
    // Measure the SFX alone over the same 40 ms window the rise is read in, silence before its first sample.
    const pad = Math.round(0.08 * sr);
    const padded = new Float64Array(pad + placement.generated.buffer.length);
    padded.set(placement.generated.buffer, pad);
    const sfxLevel = Math.max(bandRms(padded, pad + placement.generated.peakOffset - own, pad + placement.generated.peakOffset + own, sr), 1e-9);
    const target = Math.min(rise.max, Math.max(rise.min, placement.cue.role === 'hit' ? rise.hit : rise.target));
    // The listener hears SFX plus the bed under it: aim the sum (as uncorrelated power) at the target.
    const bedOwn = bandRms(mono, placement.peakAt - own, placement.peakAt + own, sr);
    const want = bedLevel * dbToGain(target);
    const needed = Math.sqrt(Math.max(want * want - bedOwn * bedOwn, (want * want) / 4));
    const gain = needed / sfxLevel;
    const buffer = placement.generated.buffer;
    for (let i = 0; i < buffer.length; i += 1) {
      const n = placement.start + i;
      if (n < 0 || n >= length) continue;
      const v = (buffer[i] ?? 0) * gain;
      left[n] = (left[n] ?? 0) + v;
      right[n] = (right[n] ?? 0) + v;
    }
    placed.push({
      role: placement.cue.role as SfxRole,
      event: placement.cue.event,
      atSec: placement.cue.at.sec,
      startSec: Math.round((Math.max(0, placement.start) / sr) * 1e6) / 1e6,
      peakAtSec: Math.round((placement.peakAt / sr) * 1e6) / 1e6,
      gainDb: Math.round(toDb(gain) * 100) / 100,
    });
  }
  return { channels: [left, right], bed: bedOut, cues: placed };
}

/** Measured rise: bed-band RMS around the peak over the 300 ms before the SFX starts, in dB. */
export function measureRise(channels: [Float32Array, Float32Array], startSec: number, peakAtSec: number, sr: number): number {
  const mono = new Float64Array(channels[0].length);
  for (let n = 0; n < mono.length; n += 1) mono[n] = ((channels[0][n] ?? 0) + (channels[1][n] ?? 0)) / 2;
  const peak = Math.round(peakAtSec * sr);
  const own = Math.round(0.02 * sr);
  const onset = Math.round(startSec * sr);
  return toDb(bandRms(mono, peak - own, peak + own, sr) / bandRms(mono, onset - Math.round(0.3 * sr), onset, sr));
}

/** sound/sfx.json: every cue's role, event, time, peak time and gain. */
export function writeSfxJson(project: string, cues: PlacedCue[]): string {
  const file = path.join(project, 'sound', 'sfx.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, kind: 'sfx', cues }, null, 2)}\n`);
  return file;
}

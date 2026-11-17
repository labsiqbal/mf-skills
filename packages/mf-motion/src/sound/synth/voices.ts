// Voices, each rendered additively into a mono buffer at a sample offset:
// wavetable oscillator notes, Karplus-Strong pluck, 2-operator FM bell, white
// and pink noise, and sampler-free drums.
import { Svf } from './dsp';
import { TWO_PI, decayCoefficient, exp2, mulberry32, sin } from './math';
import { type Wave, readTable, sineTable4096, tableFor } from './tables';

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

function add(buffer: Float64Array, index: number, value: number): void {
  if (index >= 0 && index < buffer.length) buffer[index] = (buffer[index] ?? 0) + value;
}

/** Envelope value per sample for a note held `holdSamples` then released. */
function envelopeAt(n: number, hold: number, env: Adsr, sr: number, state: { level: number; decayC: number; releaseC: number }): number {
  const attack = Math.max(1, Math.round(env.attack * sr));
  if (n < attack && n < hold) state.level = n / attack;
  else if (n < hold) state.level = env.sustain + (state.level - env.sustain) * state.decayC;
  else state.level *= state.releaseC;
  return state.level;
}

export interface OscNote {
  wave: Wave;
  freq: number;
  start: number;
  holdSamples: number;
  gain: number;
  env: Adsr;
  /** Optional low-pass cutoff in Hz. */
  cutoff?: number;
  detuneCents?: number;
}

/** A band-limited wavetable note (two detuned oscillators when detuneCents is set). */
export function renderOsc(buffer: Float64Array, note: OscNote, sr: number): void {
  const table = tableFor(note.wave, note.freq, sr);
  const ratio = note.detuneCents ? exp2(note.detuneCents / 1200) : 1;
  const incA = note.freq / sr;
  const incB = (note.freq * ratio) / sr;
  const filter = note.cutoff ? new Svf(sr, note.cutoff, 0.8) : null;
  const state = { level: 0, decayC: decayCoefficient(note.env.decay, sr), releaseC: decayCoefficient(note.env.release, sr) };
  const total = note.holdSamples + Math.round(note.env.release * sr);
  let pa = 0;
  let pb = 0.25;
  for (let n = 0; n < total; n += 1) {
    let x = readTable(table, pa);
    if (note.detuneCents) x = (x + readTable(table, pb)) * 0.5;
    pa += incA;
    pb += incB;
    if (filter) x = filter.process(x, 'low');
    add(buffer, note.start + n, x * envelopeAt(n, note.holdSamples, note.env, sr, state) * note.gain);
  }
}

/** Karplus-Strong plucked string. */
export function renderPluck(buffer: Float64Array, start: number, freq: number, seconds: number, gain: number, seed: number, sr: number, brightness = 0.5): void {
  const length = Math.max(2, sr / freq);
  const size = Math.ceil(length) + 2;
  const line = new Float64Array(size);
  const random = mulberry32(seed);
  for (let i = 0; i < size; i += 1) line[i] = random() * 2 - 1;
  const decay = decayCoefficient(seconds, sr);
  const total = Math.round(seconds * sr);
  let write = 0;
  let prev = 0;
  let level = 1;
  for (let n = 0; n < total; n += 1) {
    const readPos = write - length;
    const r = readPos < 0 ? readPos + size : readPos;
    const i0 = Math.floor(r);
    const frac = r - i0;
    const a = line[i0 % size] ?? 0;
    const b = line[(i0 + 1) % size] ?? 0;
    const delayed = a + (b - a) * frac;
    // Averaging low-pass in the loop; brightness keeps more of the new sample.
    const y = (delayed * (0.5 + brightness * 0.5) + prev * (0.5 - brightness * 0.5)) * 0.996;
    prev = delayed;
    line[write] = y;
    write = (write + 1) % size;
    level *= decay;
    add(buffer, start + n, y * gain * (n < 32 ? n / 32 : 1) * (0.25 + 0.75 * level));
  }
}

/** 2-operator FM bell: carrier phase-modulated by a sine at `ratio`, index decaying. */
export function renderBell(buffer: Float64Array, start: number, freq: number, seconds: number, gain: number, sr: number, ratio = 3.5, index = 2.4): void {
  const sine = sineTable4096();
  const amp = decayCoefficient(seconds, sr);
  const indexDecay = decayCoefficient(seconds * 0.35, sr);
  const total = Math.round(seconds * sr);
  let pc = 0;
  let pm = 0;
  let level = 1;
  let depth = index;
  for (let n = 0; n < total; n += 1) {
    const mod = readTable(sine, pm);
    const x = readTable(sine, pc + (depth * mod) / TWO_PI);
    pc += freq / sr;
    pm += (freq * ratio) / sr;
    level *= amp;
    depth *= indexDecay;
    add(buffer, start + n, x * level * gain * (n < 48 ? n / 48 : 1));
  }
}

/** White noise in [-1, 1). */
export function whiteNoise(seed: number): () => number {
  const random = mulberry32(seed);
  return () => random() * 2 - 1;
}

/** Pink noise from white by a fixed three-pole filter. */
export function pinkNoise(seed: number): () => number {
  const white = whiteNoise(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  return () => {
    const w = white();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.2;
  };
}

/** Kick: a pitched sine sweep plus a short click. */
export function renderKick(buffer: Float64Array, start: number, gain: number, seed: number, sr: number, punch = 1): void {
  const total = Math.round(0.45 * sr);
  const amp = decayCoefficient(0.42, sr);
  const sweep = decayCoefficient(0.09, sr);
  const noise = whiteNoise(seed);
  const click = new Svf(sr, 3500, 0.7);
  let phase = 0;
  let bend = 1;
  let level = 1;
  for (let n = 0; n < total; n += 1) {
    const freq = 48 + 110 * punch * bend;
    phase += freq / sr;
    bend *= sweep;
    level *= amp;
    let x = sin(TWO_PI * (phase - Math.floor(phase))) * level;
    if (n < sr * 0.004) x += click.process(noise(), 'high') * 0.6 * (1 - n / (sr * 0.004));
    add(buffer, start + n, x * gain);
  }
}

/** Snare: a short tone plus band-passed noise. */
export function renderSnare(buffer: Float64Array, start: number, gain: number, seed: number, sr: number): void {
  const total = Math.round(0.25 * sr);
  const toneDecay = decayCoefficient(0.1, sr);
  const noiseDecay = decayCoefficient(0.18, sr);
  const noise = whiteNoise(seed);
  const band = new Svf(sr, 1900, 0.9);
  let phase = 0;
  let tone = 1;
  let body = 1;
  for (let n = 0; n < total; n += 1) {
    phase += 185 / sr;
    tone *= toneDecay;
    body *= noiseDecay;
    add(buffer, start + n, (sin(TWO_PI * (phase - Math.floor(phase))) * tone * 0.5 + band.process(noise(), 'band') * body * 1.4) * gain);
  }
}

/** Clap: three quick band-passed noise bursts and a short tail. */
export function renderClap(buffer: Float64Array, start: number, gain: number, seed: number, sr: number): void {
  const total = Math.round(0.3 * sr);
  const noise = whiteNoise(seed);
  const band = new Svf(sr, 1250, 1.2);
  const burst = decayCoefficient(0.012, sr);
  const tailDecay = decayCoefficient(0.16, sr);
  const offsets = [0, Math.round(0.011 * sr), Math.round(0.022 * sr)];
  let level = 0;
  let tail = 0;
  for (let n = 0; n < total; n += 1) {
    if (offsets.includes(n)) level = 1;
    if (n === (offsets[2] ?? 0)) tail = 0.7;
    level *= burst;
    tail *= tailDecay;
    add(buffer, start + n, band.process(noise(), 'band') * (level + tail) * gain * 1.6);
  }
}

/** Hat: high-passed noise with a metallic FM layer. */
export function renderHat(buffer: Float64Array, start: number, gain: number, seed: number, sr: number, open = false): void {
  const seconds = open ? 0.32 : 0.06;
  const total = Math.round(seconds * sr);
  const noise = whiteNoise(seed);
  const high = new Svf(sr, 7200, 0.7);
  const decay = decayCoefficient(seconds, sr);
  const sine = sineTable4096();
  let pc = 0;
  let pm = 0;
  let level = 1;
  for (let n = 0; n < total; n += 1) {
    const metal = readTable(sine, pc + (3 * readTable(sine, pm)) / TWO_PI);
    pc += 5917 / sr;
    pm += 8413 / sr;
    level *= decay;
    add(buffer, start + n, (high.process(noise(), 'high') * 0.8 + metal * 0.25) * level * gain);
  }
}

/** Riser: pink noise through a band-pass whose cutoff climbs over the span. */
export function renderRiser(buffer: Float64Array, start: number, seconds: number, gain: number, seed: number, sr: number): void {
  const total = Math.round(seconds * sr);
  const noise = pinkNoise(seed);
  const band = new Svf(sr, 300, 1.4);
  for (let n = 0; n < total; n += 1) {
    const t = n / total;
    if (n % 64 === 0) band.set(300 * exp2(t * 5), 1.4);
    add(buffer, start + n, band.process(noise(), 'band') * t * t * gain);
  }
}

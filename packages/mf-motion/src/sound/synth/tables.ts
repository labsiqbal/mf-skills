// 4096-sample wavetables: a sine from the polynomial, and saw, square and
// triangle built additively from it and band-limited per octave (one table per
// power-of-two harmonic count).
import { TWO_PI, sin } from './math';

export const TABLE_SIZE = 4096;
const MASK = TABLE_SIZE - 1;
export type Wave = 'sine' | 'saw' | 'square' | 'triangle';
/** Harmonic counts with their own table: 1, 2, 4, ... 1024. */
export const HARMONIC_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] as const;

let sineTable: Float64Array | null = null;
const cache = new Map<string, Float64Array>();

export function sineTable4096(): Float64Array {
  if (!sineTable) {
    sineTable = new Float64Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i += 1) sineTable[i] = sin((TWO_PI * i) / TABLE_SIZE);
  }
  return sineTable;
}

function build(wave: Exclude<Wave, 'sine'>, harmonics: number): Float64Array {
  const sine = sineTable4096();
  const table = new Float64Array(TABLE_SIZE);
  for (let k = 1; k <= harmonics; k += 1) {
    let amp = 0;
    if (wave === 'saw') amp = 1 / k;
    else if (k % 2 === 1) amp = wave === 'square' ? 1 / k : ((k - 1) / 2) % 2 === 0 ? 1 / (k * k) : -1 / (k * k);
    if (amp === 0) continue;
    for (let i = 0; i < TABLE_SIZE; i += 1) table[i] = (table[i] ?? 0) + amp * (sine[(k * i) & MASK] ?? 0);
  }
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i += 1) peak = Math.max(peak, Math.abs(table[i] ?? 0));
  if (peak > 0) for (let i = 0; i < TABLE_SIZE; i += 1) table[i] = (table[i] ?? 0) / peak;
  return table;
}

/** The table for a wave at a frequency: as many harmonics as fit under Nyquist. */
export function tableFor(wave: Wave, freq: number, sampleRate: number): Float64Array {
  if (wave === 'sine') return sineTable4096();
  const fit = Math.max(1, Math.floor(sampleRate / 2 / Math.max(1, freq)));
  let harmonics = 1;
  for (const step of HARMONIC_STEPS) if (step <= fit) harmonics = step;
  const key = `${wave}:${harmonics}`;
  let table = cache.get(key);
  if (!table) {
    table = build(wave, harmonics);
    cache.set(key, table);
  }
  return table;
}

/** Linear-interpolated read at a phase in cycles. */
export function readTable(table: Float64Array, phase: number): number {
  const position = (phase - Math.floor(phase)) * TABLE_SIZE;
  const i = Math.floor(position);
  const frac = position - i;
  const a = table[i & MASK] ?? 0;
  const b = table[(i + 1) & MASK] ?? 0;
  return a + (b - a) * frac;
}

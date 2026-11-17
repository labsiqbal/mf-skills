// Deterministic maths for the audio path: only + - * / and correctly rounded
// operations (Math.sqrt, floor, round, abs, min, max, imul), so every OS
// produces the same bits. No Math.sin/cos/exp/pow/log here or anywhere in
// src/sound (static test).

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const LN2 = 0.6931471805599453;
/** log2(1000): a -60 dB decay. */
export const LOG2_1000 = 9.965784284662087;
/** log2(10) / 20: decibels to a log2 gain. */
export const DB_TO_LOG2 = 0.16609640474436813;

/** Odd polynomial for sin on [-pi/2, pi/2] (coefficients 1/n! to degree 15; error under 1e-12). */
const S3 = -0.16666666666666666;
const S5 = 0.008333333333333333;
const S7 = -0.0001984126984126984;
const S9 = 2.7557319223985893e-6;
const S11 = -2.505210838544172e-8;
const S13 = 1.6059043836821613e-10;
const S15 = -7.647163731819816e-13;

export function sin(x: number): number {
  let r = x - Math.round(x / TWO_PI) * TWO_PI;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const s = r * r;
  return r * (1 + s * (S3 + s * (S5 + s * (S7 + s * (S9 + s * (S11 + s * (S13 + s * S15)))))));
}

export const cos = (x: number) => sin(x + HALF_PI);
export const tan = (x: number) => sin(x) / cos(x);

/** 2^x: integer part by exact doubling, fraction by a series of e^(f ln 2). */
export function exp2(x: number): number {
  const n = Math.floor(x);
  const y = (x - n) * LN2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 14; k += 1) {
    term = (term * y) / k;
    sum += term;
  }
  let scale = 1;
  if (n > 0) for (let i = 0; i < n; i += 1) scale *= 2;
  else for (let i = 0; i < -n; i += 1) scale /= 2;
  return sum * scale;
}

export const dbToGain = (db: number) => exp2(db * DB_TO_LOG2);
export const midiToHz = (note: number) => 440 * exp2((note - 69) / 12);

/** Per-sample multiplier that falls 60 dB over `seconds`. */
export function decayCoefficient(seconds: number, sampleRate: number): number {
  return seconds <= 0 ? 0 : exp2(-LOG2_1000 / (seconds * sampleRate));
}

/** mulberry32: a seeded generator returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable seed for a voice name under the score seed. */
export function voiceSeed(seed: number, name: string): number {
  let hash = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < name.length; i += 1) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  return hash >>> 0;
}

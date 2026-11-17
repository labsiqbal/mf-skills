// Processors: state-variable filter, one-pole smoothing, cubic soft clip,
// Freeverb-style reverb (8 combs, 4 allpasses, fixed tunings), stereo width
// and envelope-follower ducking.
import { PI, decayCoefficient, tan } from './math';

export type FilterMode = 'low' | 'band' | 'high';

/** Zero-delay state-variable filter (trapezoidal integration). */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  constructor(private readonly sampleRate: number, cutoff: number, q = 0.707) {
    this.set(cutoff, q);
  }
  set(cutoff: number, q = 0.707): void {
    const fc = Math.min(Math.max(cutoff, 10), this.sampleRate * 0.45);
    const g = tan((PI * fc) / this.sampleRate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  process(x: number, mode: FilterMode): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return mode === 'low' ? v2 : mode === 'band' ? v1 : x - this.k * v1 - v2;
  }
}

/** One-pole smoothing toward a target. */
export class OnePole {
  private y = 0;
  private readonly c: number;
  constructor(seconds: number, sampleRate: number) {
    this.c = decayCoefficient(seconds, sampleRate);
  }
  process(x: number): number {
    this.y = x + (this.y - x) * this.c;
    return this.y;
  }
}

/** Cubic soft clip: linear near zero, flat at +-1. */
export function softClip(x: number): number {
  const v = x > 1 ? 1 : x < -1 ? -1 : x;
  return 1.5 * v - 0.5 * v * v * v;
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

class Comb {
  private readonly buffer: Float64Array;
  private index = 0;
  private store = 0;
  constructor(size: number, private readonly feedback: number, private readonly damp: number) {
    this.buffer = new Float64Array(size);
  }
  process(x: number): number {
    const out = this.buffer[this.index] ?? 0;
    this.store = out * (1 - this.damp) + this.store * this.damp;
    this.buffer[this.index] = x + this.store * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return out;
  }
}

class Allpass {
  private readonly buffer: Float64Array;
  private index = 0;
  constructor(size: number) {
    this.buffer = new Float64Array(size);
  }
  process(x: number): number {
    const held = this.buffer[this.index] ?? 0;
    this.buffer[this.index] = x + held * 0.5;
    this.index = (this.index + 1) % this.buffer.length;
    return held - x;
  }
}

/** Freeverb-style stereo reverb with fixed tunings scaled to the sample rate. */
export class Reverb {
  private readonly left: { combs: Comb[]; allpasses: Allpass[] };
  private readonly right: { combs: Comb[]; allpasses: Allpass[] };
  constructor(sampleRate: number, room = 0.82, damp = 0.3) {
    const scale = sampleRate / 44100;
    const feedback = room * 0.28 + 0.7;
    const d = damp * 0.4;
    const side = (offset: number) => ({
      combs: COMBS.map((size) => new Comb(Math.round((size + offset) * scale), feedback, d)),
      allpasses: ALLPASSES.map((size) => new Allpass(Math.round((size + offset) * scale))),
    });
    this.left = side(0);
    this.right = side(SPREAD);
  }
  process(input: number): [number, number] {
    const x = input * 0.015;
    const run = (side: { combs: Comb[]; allpasses: Allpass[] }) => {
      let sum = 0;
      for (const comb of side.combs) sum += comb.process(x);
      for (const allpass of side.allpasses) sum = allpass.process(sum);
      return sum;
    };
    return [run(this.left), run(this.right)];
  }
}

/** Mid/side width: 0 mono, 1 unchanged, above 1 wider. */
export function widen(left: number, right: number, width: number): [number, number] {
  const mid = (left + right) * 0.5;
  const side = (left - right) * 0.5 * width;
  return [mid + side, mid - side];
}

/** Envelope follower driving a gain reduction of up to `depth` (ducking). */
export class Ducker {
  private env = 0;
  private readonly release: number;
  constructor(sampleRate: number, private readonly depth: number, releaseSec = 0.18, private readonly threshold = 0.5) {
    this.release = decayCoefficient(releaseSec, sampleRate);
  }
  gain(key: number): number {
    const level = Math.abs(key);
    this.env = level > this.env ? level : this.env * this.release;
    return 1 - this.depth * Math.min(1, this.env / this.threshold);
  }
}

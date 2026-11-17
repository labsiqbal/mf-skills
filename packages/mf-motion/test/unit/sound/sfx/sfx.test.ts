// SFX: peaks land within 1 frame of the picture time (measured on the rendered
// 24-bit WAV), rises sit inside sfx.riseDb with the hit above the others,
// one hit per film, the bed yields, and sfx.json records every cue.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUMBERS } from '../../../../src/kit/numbers';
import { arrange, renderArrangement } from '../../../../src/sound/arrange';
import { GENRE_PRESETS } from '../../../../src/sound/presets/index';
import { SFX_ROLES, type SfxCueInput, checkCues, generateSfx, log2, measureRise, mixSfx, writeSfxJson, yieldEvents } from '../../../../src/sound/sfx';
import { SAMPLE_RATE, type ScoreGrid, encodeWav24 } from '../../../../src/sound/synth/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const grid = JSON.parse(readFileSync(path.join(here, 'grid-sfx.json'), 'utf8')) as ScoreGrid & { seed: number; sfx: SfxCueInput[] };
const FPS = 30;
const sr = SAMPLE_RATE;

/** Decode 24-bit stereo PCM written by encodeWav24 back to floats. */
function decode(bytes: Uint8Array): [Float64Array, Float64Array] {
  const buffer = Buffer.from(bytes);
  const data = buffer.indexOf('data');
  const count = buffer.readUInt32LE(data + 4) / 6;
  const left = new Float64Array(count);
  const right = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    left[i] = buffer.readIntLE(data + 8 + i * 6, 3) / 8388607;
    right[i] = buffer.readIntLE(data + 8 + i * 6 + 3, 3) / 8388607;
  }
  return [left, right];
}

function render() {
  const preset = GENRE_PRESETS['driving-electronic'];
  if (!preset) throw new Error('preset');
  const peaks = grid.sfx.map((cue) => cue.at.sec + NUMBERS['sfx.peakOffsetFrames'] / FPS);
  const arrangement = arrange(grid, preset, grid.seed);
  const yielded = { ...arrangement, events: yieldEvents(arrangement.events, peaks) };
  const bed = renderArrangement(yielded, preset, grid.seed).channels;
  return { ...mixSfx(bed, grid.sfx, { seed: grid.seed, fps: FPS, sampleRate: sr, bedYielded: true }), undipped: bed };
}

describe('generators', () => {
  it('every role returns a buffer and its peak offset, deterministically', () => {
    expect([...SFX_ROLES]).toEqual(['click', 'tick', 'type', 'pop', 'whoosh', 'hit', 'shimmer', 'riser']);
    for (const role of SFX_ROLES) {
      const a = generateSfx(role, sr, 7);
      const b = generateSfx(role, sr, 7);
      expect(a.buffer).toEqual(b.buffer);
      expect(a.peakOffset).toBeGreaterThanOrEqual(0);
      expect(a.peakOffset).toBeLessThan(a.buffer.length);
      const peak = Math.abs(a.buffer[a.peakOffset] ?? 0);
      expect(a.buffer.every((v) => Math.abs(v) <= peak)).toBe(true);
    }
    expect(Math.abs(log2(1000) - Math.log2(1000))).toBeLessThan(1e-12);
    expect(Math.abs(log2(0.0037) - Math.log2(0.0037))).toBeLessThan(1e-12);
  });
});

describe('placement and gain', () => {
  const mix = render();
  const final = decode(encodeWav24(mix.channels, sr));
  const bed = decode(encodeWav24(mix.bed, sr));

  it('every SFX peak measured on the rendered WAV lands within 1 frame of its picture time', () => {
    for (const cue of mix.cues) {
      // The SFX alone: the rendered mix minus the rendered bed.
      const from = Math.round((cue.atSec - 0.6) * sr);
      const to = Math.round((cue.atSec + 0.6) * sr);
      let best = 0;
      let at = from;
      for (let n = from; n < to; n += 1) {
        const v = Math.abs((final[0][n] ?? 0) - (bed[0][n] ?? 0));
        if (v > best) {
          best = v;
          at = n;
        }
      }
      const offFrames = (at / sr - cue.atSec) * FPS;
      expect(Math.abs(offFrames - NUMBERS['sfx.peakOffsetFrames']), `${cue.role} ${cue.event}`).toBeLessThanOrEqual(NUMBERS['sfx.peakToleranceFrames']);
    }
  });

  it('measured rise is within 3-14 dB, with the hit above the others', () => {
    const channels: [Float32Array, Float32Array] = [Float32Array.from(final[0]), Float32Array.from(final[1])];
    const rises = Object.fromEntries(mix.cues.map((cue) => [cue.role, measureRise(channels, cue.baselineSec, cue.peakAtSec, sr)]));
    for (const [role, rise] of Object.entries(rises)) {
      expect(rise, role).toBeGreaterThanOrEqual(NUMBERS['sfx.riseDb'].min);
      expect(rise, role).toBeLessThanOrEqual(NUMBERS['sfx.riseDb'].max);
    }
    for (const [role, rise] of Object.entries(rises)) if (role !== 'hit') expect(rises.hit, `hit above ${role}`).toBeGreaterThan(rise);
    console.log(`measured rises ${JSON.stringify(Object.fromEntries(Object.entries(rises).map(([k, v]) => [k, Math.round(v * 10) / 10])))}`);
  });

  it('the bed dips before the hit and sfx.json records every cue', () => {
    const hit = mix.cues.find((cue) => cue.role === 'hit');
    expect(hit).toBeDefined();
    const level = (signal: Float32Array, from: number, to: number) => {
      let sum = 0;
      for (let n = Math.round(from * sr); n < Math.round(to * sr); n += 1) sum += (signal[n] ?? 0) ** 2;
      return Math.sqrt(sum / Math.round((to - from) * sr));
    };
    const peakAt = hit?.peakAtSec ?? 0;
    // Through the 0.3 s before the hit the bed is at mix.preHitDip.level of its undipped level; 0.4 s earlier it is untouched.
    const dipped = level(mix.bed[0], peakAt - 0.29, peakAt - 0.01);
    expect(dipped).toBeLessThanOrEqual(level(mix.undipped[0], peakAt - 0.29, peakAt - 0.01) * NUMBERS['mix.preHitDip'].level + 1e-9);
    expect(level(mix.bed[0], peakAt - 0.7, peakAt - 0.4)).toBeCloseTo(level(mix.undipped[0], peakAt - 0.7, peakAt - 0.4), 6);
    const file = writeSfxJson(mkdtempSync(path.join(tmpdir(), 'mfm-sfx-')), mix.cues);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.cues).toHaveLength(grid.sfx.length);
    expect(written.cues[0]).toEqual({ role: 'click', event: 'cta-button', atSec: 1.3, startSec: expect.any(Number), baselineSec: expect.any(Number), peakAtSec: expect.closeTo(1.3 + 0.5 / 30, 4), gainDb: expect.any(Number) });
  });
});

describe('rules', () => {
  it('a grid with two hit cues fails GRID_INVALID; unknown roles fail too', () => {
    const two = [...grid.sfx, { role: 'hit', at: { sec: 18 }, event: 'second' }];
    expect(() => checkCues(two)).toThrow(expect.objectContaining({ code: 'GRID_INVALID' }));
    expect(() => mixSfx([new Float32Array(sr), new Float32Array(sr)], two, { seed: 1, fps: 30, sampleRate: sr })).toThrow(/at most one hit/);
    expect(() => checkCues([{ role: 'boing', at: { sec: 1 }, event: 'x' }])).toThrow(/Unknown SFX role/);
  });

  it('bed hats and plucks skip and kicks halve inside sfx.ownWindowMs', () => {
    const events = [
      { at: 1.0, dur: 0.1, role: 'hat' as const, gain: 0.1 },
      { at: 1.06, dur: 0.1, role: 'pluck' as const, gain: 0.2, midi: 60 },
      { at: 1.05, dur: 0.4, role: 'kick' as const, gain: 0.8 },
      { at: 1.2, dur: 0.1, role: 'hat' as const, gain: 0.1 },
      { at: 1.0, dur: 2, role: 'pad' as const, gain: 0.05, midi: 57 },
    ];
    expect(yieldEvents(events, [1.0])).toEqual([
      { at: 1.05, dur: 0.4, role: 'kick', gain: 0.4 },
      { at: 1.2, dur: 0.1, role: 'hat', gain: 0.1 },
      { at: 1.0, dur: 2, role: 'pad', gain: 0.05, midi: 57 },
    ]);
  });
});

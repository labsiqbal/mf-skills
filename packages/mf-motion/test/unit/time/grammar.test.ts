import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type TimeGrid, gridEnd, parse, resolveSpec, setGrid, t, toFrame } from '../../../src/time/index';

const grid120: TimeGrid = { fps: '30', bpm: 120, beatsPerBar: 4, bars: 8, tailSec: 1.5 };
const sec = (spec: string | number, grid: TimeGrid | null = grid120) => resolveSpec(spec, grid).sec;
const error = (spec: string | number, grid: TimeGrid | null = grid120) => {
  try {
    resolveSpec(spec, grid);
  } catch (caught) {
    return caught as { code: string; details: Record<string, unknown> };
  }
  throw new Error(`expected "${spec}" to fail`);
};

describe('acceptance', () => {
  it('bar3.2 at 120 BPM 4/4 is 4.5 s and b9+0.5b is 4.25 s', () => {
    expect(resolveSpec('bar3.2', grid120)).toEqual({ sec: 4.5, frame: 135 });
    // 4.25 s is a frame at 60 fps; at 30 fps it snaps half up to frame 128.
    expect(resolveSpec('b9+0.5b', { ...grid120, fps: '60' })).toEqual({ sec: 4.25, frame: 255 });
    expect(resolveSpec('b9+0.5b', grid120).frame).toBe(128);
  });

  it('96f at 30000/1001 is frame 96', () => {
    expect(resolveSpec('96f', { fps: '30000/1001', lengthSec: 10 }).frame).toBe(96);
  });

  it('a cue cycle fails GRID_INVALID with the cycle', () => {
    const cyclic: TimeGrid = { ...grid120, cues: { a: '@b+1', b: '@c', c: '@a-0.5b', ok: 'bar2' } };
    expect(error('@a', cyclic)).toMatchObject({ code: 'GRID_INVALID', details: { cycle: ['a', 'b', 'c', 'a'] } });
    expect(sec('@ok', cyclic)).toBe(2);
  });

  it('bar2 without a grid fails GRID_REQUIRED', () => {
    expect(error('bar2', { fps: '30', lengthSec: 5 })).toMatchObject({ code: 'GRID_REQUIRED' });
    expect(error('bar2', null).code).toBe('GRID_REQUIRED');
  });

  it('whitespace inside a spec is an error', () => {
    for (const spec of ['bar3 .2', ' 3', '3 ', 'b9 +0.5b', '@drop\t']) expect(error(spec).code, JSON.stringify(spec)).toBe('GRID_INVALID');
  });
});

describe('productions', () => {
  it('parses every base', () => {
    expect(parse('3.25').base).toEqual({ kind: 'seconds', value: 3.25 });
    expect(parse('3.25s').base).toEqual({ kind: 'seconds', value: 3.25 });
    expect(parse(3.25).base).toEqual({ kind: 'seconds', value: 3.25 });
    expect(parse('96f').base).toEqual({ kind: 'frames', value: 96 });
    expect(parse('bar3').base).toEqual({ kind: 'bar', bar: 3, beat: 1 });
    expect(parse('bar3.2').base).toEqual({ kind: 'bar', bar: 3, beat: 2 });
    expect(parse('b9').base).toEqual({ kind: 'beat', beat: 9 });
    expect(parse('@end-card').base).toEqual({ kind: 'cue', name: 'end-card' });
    expect(parse('@drop-2')).toMatchObject({ base: { kind: 'cue', name: 'drop' }, offsets: [{ sign: -1, unit: 's', value: 2 }] });
    expect(parse('start').base).toEqual({ kind: 'start' });
    expect(parse('end').base).toEqual({ kind: 'end' });
  });

  it('parses offsets left to right in seconds, frames and beats', () => {
    expect(parse('bar2+0.5-3f+1.5s-0.25b').offsets).toEqual([
      { sign: 1, unit: 's', value: 0.5 },
      { sign: -1, unit: 'f', value: 3 },
      { sign: 1, unit: 's', value: 1.5 },
      { sign: -1, unit: 'b', value: 0.25 },
    ]);
    expect(sec('bar2+0.5-3f')).toBe(2.4);
    expect(sec('start+1b+1b')).toBe(1);
    expect(sec('end-1.5')).toBe(16);
  });

  it('resolves start, end, cues that name cues, and resolved cue values', () => {
    expect(sec('start')).toBe(0);
    expect(gridEnd(grid120)).toBe(17.5);
    expect(sec('end')).toBe(17.5);
    const cues: TimeGrid = { ...grid120, cues: { drop: 'bar5', hit: '@drop+0.5b', logo: { sec: 1.2, frame: 36 }, n: 2.5 } };
    // bar5 + half a beat = 8.25 s, snapped half up to frame 248 at 30 fps.
    expect(resolveSpec('@hit', cues)).toEqual({ sec: 248 / 30, frame: 248 });
    expect(sec('@logo+1f', cues)).toBeCloseTo(1.2333, 3);
    expect(sec('@n', cues)).toBe(2.5);
    expect(error('@missing', cues)).toMatchObject({ code: 'GRID_INVALID', details: { cue: 'missing' } });
  });

  it('snaps to the frame grid with round half up and a rational fps', () => {
    expect(toFrame(0.05, { num: 10, den: 1 })).toBe(1);
    expect(toFrame(0.149, { num: 10, den: 1 })).toBe(1);
    expect(toFrame(0.15, { num: 10, den: 1 })).toBe(2);
    const ntsc = resolveSpec('1', { fps: '30000/1001', lengthSec: 10 });
    expect(ntsc.frame).toBe(30);
    expect(ntsc.sec).toBeCloseTo(1.001, 9);
    expect(resolveSpec('0.0166', { fps: '30', lengthSec: 1 }).frame).toBe(0);
  });

  it('moves (no beat grid) accept seconds, frames, start, end and second or frame offsets only', () => {
    const moves: TimeGrid = { fps: '50', lengthSec: 4 };
    expect(sec('end-0.5', moves)).toBe(3.5);
    expect(sec('50f+0.2', moves)).toBe(1.2);
    expect(error('b2', moves).code).toBe('GRID_REQUIRED');
    expect(error('@drop', moves).code).toBe('GRID_REQUIRED');
    expect(error('1+0.5b', moves).code).toBe('GRID_REQUIRED');
    expect(error('end', { fps: '25' }).code).toBe('GRID_REQUIRED');
    expect(resolveSpec('2', { fps: '25' }).frame).toBe(50);
    expect(resolveSpec('end-0.5', { fps: '25', lengthSec: 4 })).toEqual({ sec: 3.52, frame: 88 });
  });

  it('rejects malformed specs with GRID_INVALID and the position', () => {
    const bad = ['', 'bar', 'bar0', 'bar3.', 'bar3.0', 'b', 'b0', '3.', '.5', '1.5f', '+1', '3+', '3+0.5f', '@', '@Drop', '@9x', 'Bar3', 'x', '3s2', 'start+1x', 'endx', '1e3', '-1'];
    for (const spec of bad) expect(error(spec).code, JSON.stringify(spec)).toBe('GRID_INVALID');
    expect(error('bar3.x').details).toMatchObject({ spec: 'bar3.x', position: 5 });
  });

  it('rejects results outside 0 to end', () => {
    expect(error('start-1')).toMatchObject({ code: 'GRID_INVALID', details: { spec: 'start-1' } });
    expect(error('end+1f').code).toBe('GRID_INVALID');
    expect(error('bar10').code).toBe('GRID_INVALID');
    expect(sec('bar9.2')).toBe(16.5);
    expect(sec('bar9')).toBe(16);
  });

  it('t(spec) uses the grid set for the runtime', () => {
    setGrid(grid120);
    expect(t('bar2')).toBe(2);
    setGrid(null);
    expect(() => t('bar2')).toThrow();
  });
});

describe('portability', () => {
  it('src/time imports nothing from Node', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/time');
    for (const file of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/from ['"]node:|require\(/);
    }
    const errors = readFileSync(path.resolve(dir, '../cli/errors.ts'), 'utf8');
    expect(errors).not.toMatch(/from ['"]node:|^import /m);
  });
});

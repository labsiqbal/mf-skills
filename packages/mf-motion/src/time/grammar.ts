// The time grammar: one hand-written parser and resolver for every time spec
// (seconds, frames, bars, beats, cues, start, end, offsets). It imports nothing
// from Node, so the same code runs in the CLI and in the browser runtime.
//
//   spec    := base offset*
//   base    := seconds | frames | bar | beat | cue | "start" | "end"
//   seconds := number "s"?          frames := integer "f"
//   bar     := "bar" integer ("." integer)?      beat := "b" integer
//   cue     := "@" name             offset := ("+"|"-") (number "s"? | integer "f" | number "b")
//   name    := [a-z][a-z0-9-]*  ("-" then a digit begins an offset, not a name)
import { MfmError } from '../cli/errors';

export type Base =
  | { kind: 'seconds'; value: number }
  | { kind: 'frames'; value: number }
  | { kind: 'bar'; bar: number; beat: number }
  | { kind: 'beat'; beat: number }
  | { kind: 'cue'; name: string }
  | { kind: 'start' }
  | { kind: 'end' };

export interface Offset {
  sign: 1 | -1;
  unit: 's' | 'f' | 'b';
  value: number;
}

export interface Ast {
  text: string;
  base: Base;
  offsets: Offset[];
}

/** A time spec as documents hold it: a string, or a bare number of seconds. */
export type TimeSpec = string | number;

/** A resolved time: seconds on the frame grid and the frame. */
export interface Resolved {
  sec: number;
  frame: number;
}

/**
 * What resolution needs. A film grid has bpm, beatsPerBar, bars and tailSec
 * (cues optional); a moves project has only fps and lengthSec.
 */
export interface TimeGrid {
  fps: string;
  bpm?: number;
  beatsPerBar?: number;
  bars?: number;
  tailSec?: number;
  /** Overrides the computed end (bars x beats x spb + tail). */
  lengthSec?: number;
  cues?: Record<string, TimeSpec | Resolved>;
}

function syntax(spec: string, position: number, reason: string): MfmError {
  return new MfmError('GRID_INVALID', { spec, position, reason }, { message: `Time spec "${spec}" is not valid at character ${position + 1}: ${reason}.` });
}

const DIGIT = /[0-9]/;
const NAME = /^[a-z][a-z0-9-]*$/;

class Scanner {
  position = 0;
  constructor(readonly text: string) {}
  get done() {
    return this.position >= this.text.length;
  }
  peek(n = 0) {
    return this.text[this.position + n] ?? '';
  }
  startsWith(word: string) {
    return this.text.startsWith(word, this.position);
  }
  integer(): number | null {
    const start = this.position;
    while (DIGIT.test(this.peek())) this.position += 1;
    if (this.position === start) return null;
    return Number(this.text.slice(start, this.position));
  }
  /** digits with an optional fraction: "3", "3.25". */
  number(): number | null {
    const start = this.position;
    if (this.integer() === null) return null;
    if (this.peek() === '.') {
      if (!DIGIT.test(this.peek(1))) throw syntax(this.text, this.position, 'a decimal point must be followed by digits');
      this.position += 1;
      this.integer();
    }
    return Number(this.text.slice(start, this.position));
  }
}

function parseBase(s: Scanner): Base {
  const spec = s.text;
  if (s.startsWith('start')) {
    s.position += 5;
    return { kind: 'start' };
  }
  if (s.startsWith('end')) {
    s.position += 3;
    return { kind: 'end' };
  }
  if (s.startsWith('bar')) {
    s.position += 3;
    const bar = s.integer();
    if (bar === null) throw syntax(spec, s.position, 'expected a bar number after "bar"');
    if (bar < 1) throw syntax(spec, s.position - 1, 'bars count from 1');
    let beat = 1;
    if (s.peek() === '.') {
      s.position += 1;
      const value = s.integer();
      if (value === null) throw syntax(spec, s.position, 'expected a beat number after "."');
      if (value < 1) throw syntax(spec, s.position - 1, 'beats count from 1');
      beat = value;
    }
    return { kind: 'bar', bar, beat };
  }
  if (s.peek() === 'b') {
    s.position += 1;
    const beat = s.integer();
    if (beat === null) throw syntax(spec, s.position, 'expected a beat number after "b"');
    if (beat < 1) throw syntax(spec, s.position - 1, 'beats count from 1');
    return { kind: 'beat', beat };
  }
  if (s.peek() === '@') {
    s.position += 1;
    const start = s.position;
    // A "-" followed by a digit starts an offset ("@drop-0.5b"), so inside a
    // cue name "-" must be followed by a letter.
    while (/[a-z0-9]/.test(s.peek()) || (s.peek() === '-' && /[a-z]/.test(s.peek(1)))) s.position += 1;
    const name = spec.slice(start, s.position);
    if (!NAME.test(name)) throw syntax(spec, start, 'a cue name starts with a-z and holds only a-z, 0-9 and "-"');
    return { kind: 'cue', name };
  }
  if (DIGIT.test(s.peek())) {
    const start = s.position;
    const value = s.number();
    if (value === null) throw syntax(spec, start, 'expected a number');
    if (s.peek() === 'f') {
      if (spec.slice(start, s.position).includes('.')) throw syntax(spec, start, 'frames are whole numbers');
      s.position += 1;
      return { kind: 'frames', value };
    }
    if (s.peek() === 's') s.position += 1;
    return { kind: 'seconds', value };
  }
  throw syntax(spec, s.position, s.done ? 'the spec is empty' : `unexpected "${s.peek()}"`);
}

function parseOffset(s: Scanner): Offset {
  const spec = s.text;
  const sign = s.peek() === '-' ? -1 : 1;
  s.position += 1;
  const start = s.position;
  const value = s.number();
  if (value === null) throw syntax(spec, start, 'expected a number after the sign');
  const unit = s.peek();
  if (unit === 'f') {
    if (spec.slice(start, s.position).includes('.')) throw syntax(spec, start, 'frame offsets are whole numbers');
    s.position += 1;
    return { sign, unit: 'f', value };
  }
  if (unit === 'b') {
    s.position += 1;
    return { sign, unit: 'b', value };
  }
  if (unit === 's') s.position += 1;
  return { sign, unit: 's', value };
}

/** Parse one time spec. A number is seconds. Whitespace anywhere is an error. */
export function parse(spec: TimeSpec): Ast {
  if (typeof spec === 'number') {
    if (!Number.isFinite(spec)) throw syntax(String(spec), 0, 'a number of seconds must be finite');
    return { text: String(spec), base: { kind: 'seconds', value: spec }, offsets: [] };
  }
  const whitespace = spec.search(/\s/);
  if (whitespace >= 0) throw syntax(spec, whitespace, 'whitespace is not allowed inside a spec');
  const s = new Scanner(spec);
  const base = parseBase(s);
  const offsets: Offset[] = [];
  while (!s.done) {
    if (s.peek() !== '+' && s.peek() !== '-') throw syntax(spec, s.position, `unexpected "${s.peek()}"`);
    offsets.push(parseOffset(s));
  }
  return { text: spec, base, offsets };
}

export interface Rational {
  num: number;
  den: number;
}

export function parseFps(fps: string): Rational {
  const match = fps.match(/^([1-9]\d*)(?:\/([1-9]\d*))?$/);
  if (!match) throw new MfmError('GRID_INVALID', { fps }, { message: `Frame rate "${fps}" is not an integer or a rational such as 30000/1001.` });
  return { num: Number(match[1]), den: Number(match[2] ?? '1') };
}

/** frame = round_half_up(sec * fps); a tiny tolerance absorbs binary rounding of exact halves. */
export function toFrame(sec: number, fps: Rational): number {
  return Math.floor((sec * fps.num) / fps.den + 0.5 + 1e-9);
}

export function frameToSec(frame: number, fps: Rational): number {
  return (frame * fps.den) / fps.num;
}

function hasBeats(grid: TimeGrid | null): grid is TimeGrid & { bpm: number; beatsPerBar: number } {
  return grid !== null && typeof grid.bpm === 'number' && grid.bpm > 0 && typeof grid.beatsPerBar === 'number';
}

/** Seconds per beat. */
export function secondsPerBeat(grid: TimeGrid & { bpm: number }): number {
  return 60 / grid.bpm;
}

/** The grid length: lengthSec when given, else bars x beatsPerBar x spb + tail. */
export function gridEnd(grid: TimeGrid | null): number | null {
  if (!grid) return null;
  if (typeof grid.lengthSec === 'number') return grid.lengthSec;
  if (hasBeats(grid) && typeof grid.bars === 'number') return grid.bars * grid.beatsPerBar * secondsPerBeat(grid) + (grid.tailSec ?? 0);
  return null;
}

function required(ast: Ast, what: string): MfmError {
  return new MfmError('GRID_REQUIRED', { spec: ast.text, needs: what }, {
    message: `Time spec "${ast.text}" uses ${what}, which needs a beat grid.`,
    hint: 'Use seconds (3.2), frames (96f), start or end here, or resolve against the film beat grid.',
  });
}

function isResolved(value: unknown): value is Resolved {
  return typeof value === 'object' && value !== null && typeof (value as Resolved).sec === 'number';
}

function seconds(ast: Ast, grid: TimeGrid | null, fps: Rational, stack: string[]): number {
  let sec: number;
  const base = ast.base;
  switch (base.kind) {
    case 'seconds':
      sec = base.value;
      break;
    case 'frames':
      sec = frameToSec(base.value, fps);
      break;
    case 'start':
      sec = 0;
      break;
    case 'end': {
      const end = gridEnd(grid);
      if (end === null) throw required(ast, '"end" without a known length');
      sec = end;
      break;
    }
    case 'bar':
      if (!hasBeats(grid)) throw required(ast, 'bars');
      sec = ((base.bar - 1) * grid.beatsPerBar + (base.beat - 1)) * secondsPerBeat(grid);
      break;
    case 'beat':
      if (!hasBeats(grid)) throw required(ast, 'beats');
      sec = (base.beat - 1) * secondsPerBeat(grid);
      break;
    case 'cue': {
      if (!hasBeats(grid) && !grid?.cues) throw required(ast, 'cues');
      const value = grid?.cues?.[base.name];
      if (value === undefined) {
        throw new MfmError('GRID_INVALID', { spec: ast.text, cue: base.name }, { message: `Time spec "${ast.text}" names the unknown cue @${base.name}.` });
      }
      if (stack.includes(base.name)) {
        const cycle = [...stack.slice(stack.indexOf(base.name)), base.name];
        throw new MfmError('GRID_INVALID', { spec: ast.text, cycle }, { message: `Cues refer to each other in a cycle: ${cycle.map((name) => `@${name}`).join(' -> ')}.` });
      }
      sec = isResolved(value) ? value.sec : seconds(parse(value), grid, fps, [...stack, base.name]);
      break;
    }
  }
  for (const offset of ast.offsets) {
    if (offset.unit === 'b') {
      if (!hasBeats(grid)) throw required(ast, 'beat offsets');
      sec += offset.sign * offset.value * secondsPerBeat(grid);
    } else if (offset.unit === 'f') {
      sec += offset.sign * frameToSec(offset.value, fps);
    } else {
      sec += offset.sign * offset.value;
    }
  }
  return sec;
}

/** Resolve a parsed spec on the grid and snap it to the frame grid. */
export function resolve(ast: Ast, grid: TimeGrid | null, fpsOverride?: string): Resolved {
  const fpsText = fpsOverride ?? grid?.fps;
  if (!fpsText) throw new MfmError('GRID_REQUIRED', { spec: ast.text, needs: 'fps' }, { message: `Time spec "${ast.text}" needs a frame rate to resolve.` });
  const fps = parseFps(fpsText);
  const raw = seconds(ast, grid, fps, []);
  const frame = toFrame(raw, fps);
  const sec = frameToSec(frame, fps);
  const end = gridEnd(grid);
  const endFrame = end === null ? null : toFrame(end, fps);
  if (frame < 0 || (endFrame !== null && frame > endFrame)) {
    throw new MfmError('GRID_INVALID', { spec: ast.text, sec: raw, frame, end }, {
      message: `Time spec "${ast.text}" resolves to ${raw.toFixed(3)} s, outside 0-${end === null ? 'unknown' : end.toFixed(3)} s.`,
    });
  }
  return { sec, frame };
}

/** parse + resolve. */
export function resolveSpec(spec: TimeSpec, grid: TimeGrid | null, fpsOverride?: string): Resolved {
  return resolve(parse(spec), grid, fpsOverride);
}

let runtimeGrid: TimeGrid | null = null;

/** Set the resolved grid the browser runtime's `t` uses (read from build/assets/grid.json). */
export function setGrid(grid: TimeGrid | null): void {
  runtimeGrid = grid;
}

/** Seconds for a spec on the current grid, for GSAP positions in the browser runtime. */
export function t(spec: TimeSpec): number {
  return resolveSpec(spec, runtimeGrid).sec;
}

/// <reference lib="dom" />
// The move runtime: mf.move() reads the inlined vars.json, sets the mode and
// orientation classes, moves the content root by the centring offset, runs
// the move's build and schedules its text lines; mf.done() checks the lines
// and the literal timeline registration, publishes MF_REPORT and seeks to 0.
// mf.rand and mf.noise2 are the runtime's only randomness.
import { type LineSchedule, lines } from './lines';

interface Timeline {
  duration(): number;
  seek(position: number, suppressEvents?: boolean): unknown;
  set(target: object, vars: object, position?: number): unknown;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MoveVarsDoc {
  move: string;
  vars: Record<string, unknown>;
  ctx: {
    aspect: '16:9' | '9:16' | '1:1';
    width: number;
    height: number;
    u: number;
    fps: string;
    mode: 'full' | 'alpha' | 'key';
    keyColor: string | null;
    seed: number;
    durationSec: number;
    safe: { copy: Rect; frame: Rect; avoid: Rect[]; captionBand: Rect | null };
    centreOffsetPx: number;
  };
}

export interface MoveBuild {
  vars: Record<string, unknown>;
  ctx: MoveVarsDoc['ctx'];
  root: HTMLElement;
  content: HTMLElement;
  tl: Timeline;
}

export interface MoveReport {
  lines: Array<{ id: string; entrance: string; exit: string; inSec: number; landSec: number; outSec: number | null; goneSec: number | null }>;
  safe: MoveVarsDoc['ctx']['safe'] | null;
  duration: number;
}

let schedules: LineSchedule[] = [];
let current: MoveVarsDoc | null = null;

/** The composition root (the element carrying data-composition-id). */
function compositionRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-composition-id]');
  if (!root) throw new Error('mf: the page has no [data-composition-id] root');
  return root;
}

/** The inlined vars.json (<script type="application/json" id="mf-vars">). */
export function readVars(): MoveVarsDoc {
  const node = document.getElementById('mf-vars');
  if (!node?.textContent) throw new Error('mf.move: the page has no inline vars (#mf-vars)');
  return JSON.parse(node.textContent) as MoveVarsDoc;
}

const ORIENTATION: Record<MoveVarsDoc['ctx']['aspect'], string> = { '9:16': 'is-portrait', '1:1': 'is-square', '16:9': 'is-landscape' };

/**
 * Set up a move: resolved vars over the defaults, mode and orientation classes
 * on the root, the centring offset on the content root, then the move's
 * build and its text lines on `tl`.
 */
export function move(options: { tl: Timeline; vars?: Record<string, unknown>; onBuild?: (build: MoveBuild) => void }): MoveBuild {
  const doc = readVars();
  current = doc;
  const root = compositionRoot();
  root.classList.remove('is-full', 'is-alpha', 'is-key', 'is-portrait', 'is-square', 'is-landscape');
  root.classList.add(`is-${doc.ctx.mode}`, ORIENTATION[doc.ctx.aspect]);
  const content = root.querySelector<HTMLElement>('.mf-content') ?? root;
  if (doc.ctx.centreOffsetPx) content.style.transform = `translateY(${doc.ctx.centreOffsetPx}px)`;
  const build: MoveBuild = { vars: { ...(options.vars ?? {}), ...doc.vars }, ctx: doc.ctx, root, content, tl: options.tl };
  options.onBuild?.(build);
  schedules = lines(options.tl as never, root);
  return build;
}

/** The id the page's scripts literally register: window.__timelines["<id>"] = ... */
export function registeredIds(): string[] {
  const ids: string[] = [];
  const pattern = /window\.__timelines\[\s*(["'])([^"']+)\1\s*\]\s*=/g;
  for (const script of Array.from(document.scripts)) {
    if (script.src || (script.type && script.type !== 'text/javascript' && script.type !== 'module')) continue;
    for (const match of (script.textContent ?? '').matchAll(pattern)) if (match[2]) ids.push(match[2]);
  }
  return ids;
}

/**
 * Finish a move: every mf-line was scheduled, the literal registration names
 * the composition id, the timeline covers the duration; publishes
 * window.MF_REPORT, registers the timeline and seeks to 0.
 */
export function done(tl: Timeline): MoveReport {
  const root = compositionRoot();
  const id = root.dataset.compositionId ?? '';
  const unscheduled = Array.from(root.querySelectorAll<HTMLElement>('.mf-line')).filter((element) => !element.dataset.mfSplit);
  if (unscheduled.length > 0) throw new Error(`mf.done: ${unscheduled.length} mf-line element(s) were never scheduled (${unscheduled.map((element) => element.id || element.textContent?.slice(0, 24)).join(', ')})`);
  const ids = registeredIds();
  if (!ids.includes(id) || ids.some((registered) => registered !== id)) {
    throw new Error(`mf.done: the page registers window.__timelines[${ids.map((value) => JSON.stringify(value)).join(', ') || 'nothing'}] but its composition id is "${id}"`);
  }
  const duration = current?.ctx.durationSec ?? Number(root.dataset.duration ?? '0');
  if (tl.duration() < duration) tl.set({}, {}, duration);
  const report: MoveReport = {
    lines: schedules.map((schedule) => ({
      id: schedule.element.id,
      entrance: schedule.entrance,
      exit: schedule.exit,
      inSec: schedule.inSec,
      landSec: schedule.landSec,
      outSec: schedule.outSec,
      goneSec: schedule.goneSec,
    })),
    safe: current?.ctx.safe ?? null,
    duration,
  };
  const page = window as unknown as { MF_REPORT?: MoveReport; __timelines?: Record<string, Timeline> };
  page.MF_REPORT = report;
  page.__timelines = page.__timelines ?? {};
  page.__timelines[id] = tl;
  tl.seek(0, false);
  return report;
}

/** mulberry32: a seeded generator of floats in [0, 1). */
export function rand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D value noise in [0, 1): smoothstep-interpolated lattice values from a hash of the seed and cell. */
export function noise2(seed: number): (x: number, y: number) => number {
  const lattice = (ix: number, iy: number) => {
    let h = (seed >>> 0) ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const sx = smooth(x - x0);
    const sy = smooth(y - y0);
    const top = lattice(x0, y0) + (lattice(x0 + 1, y0) - lattice(x0, y0)) * sx;
    const bottom = lattice(x0, y0 + 1) + (lattice(x0 + 1, y0 + 1) - lattice(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

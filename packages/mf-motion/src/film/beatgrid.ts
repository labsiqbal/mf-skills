// beatgrid check: validate plan/beatgrid.json with rules G001-G008
// (film-pipeline.md, Beat grid), resolve every time spec with the time
// grammar, and on a valid grid write plan/beatgrid.resolved.json, the approval
// table plan/beatgrid.md, and a plan.shown event bound to the grid's hash.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { appendEvent } from '../paths/events';
import { PLAN_FILES, planHash } from '../paths/plan';
import { readDoc, writeDoc } from '../schemas/index';
import { GENRE_PRESETS } from '../sound/presets/index';
import { SFX_ROLES } from '../sound/sfx';
import { type Resolved, type TimeGrid, type TimeSpec, gridEnd, parseFps, resolveSpec, secondsPerBeat, toFrame } from '../time/index';

export type GridRule = 'G001' | 'G002' | 'G003' | 'G004' | 'G005' | 'G006' | 'G007' | 'G008';

export interface GridProblem {
  code: GridRule;
  /** JSON path into beatgrid.json, for example "shots[2].to". */
  at: string;
  message: string;
}

export interface BeatgridCheck {
  /** plan/beatgrid.resolved.json, or null when the grid has problems. */
  resolved: string | null;
  /** The approval table (beatgrid.md), or "" when the grid has problems. */
  table: string;
  lengthSec: number;
  problems: GridProblem[];
  planHash: string;
  warnings: string[];
}

const FILM_FPS = String(NUMBERS['fps.film']);
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** Two resolved times are the same when they land on the same frame. */
const sameFrame = (a: Resolved, b: Resolved) => a.frame === b.frame;

type Grid = ReturnType<typeof readDoc<'beatgrid'>>['doc'];

/** Format seconds for the table: "0.0", "12.25". */
function secText(sec: number): string {
  return Number.isInteger(sec) ? sec.toFixed(1) : String(round3(sec));
}

/** The approval table: shot, time range in seconds, what is on screen, motion, sound. */
export function approvalTable(grid: { bpm: number; beatsPerBar: number; bars: number; tailSec: number; genre: string }, shots: Array<{ id: string; from: Resolved; to: Resolved; intent: string; scene: string; motion: string; sound: string }>, lengthSec: number): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '-';
  return [
    `# Beat grid: ${secText(lengthSec)} s at ${grid.bpm} BPM (${grid.bars} bars of ${grid.beatsPerBar}, tail ${grid.tailSec} s), sound ${grid.genre}`,
    '',
    '| Shot | Time (s) | On screen | Motion | Sound |',
    '|---|---|---|---|---|',
    ...shots.map((shot) => `| ${cell(shot.id)} | ${secText(shot.from.sec)}-${secText(shot.to.sec)} | ${cell(shot.intent)} (${cell(shot.scene)}) | ${cell(shot.motion)} | ${cell(shot.sound)} |`),
    '',
  ].join('\n');
}

/** Check, resolve and (when valid) show the grid of a film project. */
export function checkBeatgrid(projectRoot: string, options: { theme?: string | null; onWarn?: (message: string) => void } = {}): BeatgridCheck {
  const file = path.join(projectRoot, PLAN_FILES.beatgrid ?? 'plan/beatgrid.json');
  if (!existsSync(file)) {
    throw new MfmError('GRID_REQUIRED', { file }, { message: 'This project has no plan/beatgrid.json yet.', hint: 'Write the beat grid with time specs (time-grammar), then run `mf-motion beatgrid check --json`.' });
  }
  const { doc } = readDoc('beatgrid', file);
  const hash = planHash(file);
  const problems: GridProblem[] = [];
  const warnings: string[] = [];
  const add = (code: GridRule, at: string, message: string) => problems.push({ code, at, message });

  // G001: tempo, meter, whole bars; the genre names a preset.
  const bpmRange = NUMBERS['grid.bpm'];
  if (doc.bpm < bpmRange.min || doc.bpm > bpmRange.max) add('G001', 'bpm', `bpm ${doc.bpm} is outside ${bpmRange.min}-${bpmRange.max}.`);
  if (!(NUMBERS['grid.beatsPerBar'] as readonly number[]).includes(doc.beatsPerBar)) add('G001', 'beatsPerBar', `beatsPerBar must be one of ${NUMBERS['grid.beatsPerBar'].join(', ')}.`);
  if (!Number.isInteger(doc.bars)) add('G001', 'bars', `bars must be a whole number, not ${doc.bars}.`);
  if (!GENRE_PRESETS[doc.genre]) add('G001', 'genre', `genre "${doc.genre}" is not a sound preset (${Object.keys(GENRE_PRESETS).join(', ')}).`);

  const timeGrid: TimeGrid = { fps: FILM_FPS, bpm: doc.bpm, beatsPerBar: doc.beatsPerBar, bars: doc.bars, tailSec: doc.tailSec, cues: doc.cues };
  const lengthSec = gridEnd(timeGrid) ?? 0;
  const fps = parseFps(FILM_FPS);
  const frames = toFrame(lengthSec, fps);
  const spb = secondsPerBeat({ ...timeGrid, bpm: doc.bpm });

  // G002: length near the request and inside the grid range.
  const tolerance = NUMBERS['film.lengthToleranceSec'];
  const range = NUMBERS['film.gridRangeSec'];
  if (Math.abs(lengthSec - doc.requestedSec) > tolerance) add('G002', 'bars', `The grid is ${round3(lengthSec)} s; the brief asks for ${doc.requestedSec} s (within ${tolerance} s).`);
  if (lengthSec < range.min || lengthSec > range.max) add('G002', 'bars', `The grid is ${round3(lengthSec)} s, outside ${range.min}-${range.max} s.`);

  // G007: every spec resolves inside the film; cues are acyclic (the resolver reports cycles).
  const resolveAt = (spec: TimeSpec, at: string): Resolved | null => {
    try {
      return resolveSpec(spec, timeGrid);
    } catch (error) {
      if (error instanceof MfmError && (error.code === 'GRID_INVALID' || error.code === 'GRID_REQUIRED')) {
        add('G007', at, error.message);
        return null;
      }
      throw error;
    }
  };
  const cues = Object.fromEntries(Object.entries(doc.cues).map(([name, spec]) => [name, resolveAt(spec, `cues.${name}`)]));
  const sections = doc.sections.map((section, i) => ({ ...section, from: resolveAt(section.from, `sections[${i}].from`), to: resolveAt(section.to, `sections[${i}].to`) }));
  const shots = doc.shots.map((shot, i) => ({ ...shot, from: resolveAt(shot.from, `shots[${i}].from`), to: resolveAt(shot.to, `shots[${i}].to`) }));
  const sfx = doc.sfx.map((cue, i) => ({ ...cue, at: resolveAt(cue.at, `sfx[${i}].at`) }));
  const start: Resolved = { sec: 0, frame: 0 };
  const end: Resolved = { sec: frames / (fps.num / fps.den), frame: frames };

  // G003: sections tile the film; energy 0-1; at most one drop.
  contiguous('G003', 'sections', sections, start, end, add);
  sections.forEach((section, i) => {
    if (section.energy < 0 || section.energy > 1) add('G003', `sections[${i}].energy`, `energy ${section.energy} is outside 0-1.`);
  });
  const drops = sections.filter((section) => section.drop);
  if (drops.length > 1) add('G003', 'sections', `At most one section may drop; ${drops.map((section) => section.name).join(', ')} all do.`);

  // G004: shots tile the film, each at least one beat; ids unique.
  contiguous('G004', 'shots', shots, start, end, add);
  const beatFrames = toFrame(spb, fps);
  shots.forEach((shot, i) => {
    if (shot.from && shot.to && shot.to.frame - shot.from.frame < beatFrames) add('G004', `shots[${i}]`, `Shot ${shot.id} is ${round3(shot.to.sec - shot.from.sec)} s, shorter than one beat (${round3(spb)} s).`);
  });
  const seen = new Set<string>();
  shots.forEach((shot, i) => {
    if (seen.has(shot.id)) add('G004', `shots[${i}].id`, `Shot id ${shot.id} is used twice.`);
    seen.add(shot.id);
  });

  // G005: scenes of the chosen theme (themes arrive with MFM-076).
  const sceneWarning = options.theme
    ? `Scene ids are not checked against theme ${options.theme} yet; the theme catalogue arrives with themes (MFM-076).`
    : 'No theme is chosen yet, so scene ids are not checked (G005); run `mf-motion beatgrid check --json` again after choosing one.';
  warnings.push(sceneWarning);
  options.onWarn?.(sceneWarning);

  // G006: SFX roles and at most one hit; events are checked against the built shots at build.
  const roles = new Set<string>(SFX_ROLES);
  doc.sfx.forEach((cue, i) => {
    if (!roles.has(cue.role)) add('G006', `sfx[${i}].role`, `SFX role ${cue.role} is not one of ${SFX_ROLES.join(', ')}.`);
  });
  const hits = doc.sfx.filter((cue) => cue.role === 'hit');
  if (hits.length > NUMBERS['sfx.roles'].hitMaxPerFilm) add('G006', 'sfx', `A film has at most one hit; this grid has ${hits.length} (${hits.map((cue) => cue.event).join(', ')}).`);

  // G008: a user track sets the tempo and the first downbeat.
  if (doc.track) {
    const analysisFile = path.join(projectRoot, doc.track.analysis);
    if (!existsSync(analysisFile)) add('G008', 'track.analysis', `${doc.track.analysis} does not exist; run \`mf-motion score --track <file> --json\` first.`);
    else {
      const analysis = JSON.parse(readFileSync(analysisFile, 'utf8')) as { bpm?: number; downbeats?: number[] };
      if (typeof analysis.bpm === 'number' && round3(analysis.bpm) !== round3(doc.bpm)) add('G008', 'bpm', `bpm ${doc.bpm} differs from the track's analysed ${analysis.bpm}.`);
      const first = analysis.downbeats?.[0];
      if (typeof first === 'number' && round3(first) !== round3(doc.track.offsetSec)) add('G008', 'track.offsetSec', `track.offsetSec ${doc.track.offsetSec} differs from the track's first downbeat ${first}.`);
    }
  }

  if (problems.length > 0) return { resolved: null, table: '', lengthSec: round3(lengthSec), problems, planHash: hash, warnings };

  const must = <T>(value: T | null): T => {
    if (value === null) throw new Error('unresolved spec after a clean check');
    return value;
  };
  const resolvedShots = shots.map((shot) => ({ ...shot, from: must(shot.from), to: must(shot.to) }));
  const resolvedFile = path.join(projectRoot, 'plan', 'beatgrid.resolved.json');
  writeDoc('beatgrid-resolved', resolvedFile, {
    ...doc,
    kind: 'beatgrid-resolved',
    cues: Object.fromEntries(Object.entries(cues).map(([name, value]) => [name, must(value)])),
    sections: sections.map((section) => ({ ...section, from: must(section.from), to: must(section.to) })),
    shots: resolvedShots,
    sfx: sfx.map((cue) => ({ ...cue, at: must(cue.at) })),
    spb,
    lengthSec: round3(lengthSec),
    frames,
  });
  const table = approvalTable(doc, resolvedShots, lengthSec);
  writeFileSync(path.join(projectRoot, 'plan', 'beatgrid.md'), table);
  appendEvent(projectRoot, { type: 'plan.shown', actor: 'cli', data: { subject: 'beatgrid', planHash: hash } }, { command: 'beatgrid check' });
  return { resolved: resolvedFile, table, lengthSec: round3(lengthSec), problems, planHash: hash, warnings };
}

/** Spans that must run from start to end with no gap or overlap. */
function contiguous(code: GridRule, list: string, spans: Array<{ from: Resolved | null; to: Resolved | null }>, start: Resolved, end: Resolved, add: (code: GridRule, at: string, message: string) => void): void {
  if (spans.length === 0) {
    add(code, list, `${list} is empty; it must run from 0 to the end of the film.`);
    return;
  }
  if (spans.some((span) => !span.from || !span.to)) return; // G007 already names the spec.
  const first = spans[0];
  if (first?.from && !sameFrame(first.from, start)) add(code, `${list}[0].from`, `${list} must start at 0 s, not ${round3(first.from.sec)} s.`);
  spans.forEach((span, i) => {
    if (span.from && span.to && span.to.frame <= span.from.frame) add(code, `${list}[${i}]`, `${list}[${i}] ends at ${round3(span.to.sec)} s, not after its start ${round3(span.from.sec)} s.`);
    const next = spans[i + 1];
    if (next?.from && span.to && !sameFrame(span.to, next.from)) {
      add(code, `${list}[${i + 1}].from`, `${next.from.frame > span.to.frame ? 'Gap' : 'Overlap'} between ${list}[${i}] (ends ${round3(span.to.sec)} s) and ${list}[${i + 1}] (starts ${round3(next.from.sec)} s).`);
    }
  });
  const last = spans[spans.length - 1];
  if (last?.to && !sameFrame(last.to, end)) add(code, `${list}[${spans.length - 1}].to`, `${list} must end at the end of the film (${round3(end.sec)} s), not ${round3(last.to.sec)} s.`);
}

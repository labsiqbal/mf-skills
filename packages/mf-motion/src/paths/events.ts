// The append-only project event log, events.jsonl: one JSON object per line,
// each appended with a single appendFile call under the project lock, with a
// strictly increasing seq.
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { acquireLock, type LockOptions } from './lock';

export const EVENTS_SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  'project.created',
  'brand.captured',
  'brand.picked',
  'rights.notice',
  'plan.shown',
  'approval.recorded',
  'build.done',
  'render.started',
  'render.finished',
  'measure.done',
  'gate.verdict',
  'consent.granted',
  'cloud.call',
  'delivered',
  'clean',
  'migrate',
  // Agent notes written by `mf-motion note`; the event type list in the docs
  // names `note` as an append path but no type for it.
  'note.added',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type Actor = 'cli' | 'agent' | 'user';

export interface ProjectEvent {
  schemaVersion: number;
  at: string;
  seq: number;
  type: EventType;
  actor: Actor;
  durationMs: number | null;
  round: number | null;
  data: Record<string, unknown>;
}

export interface NewEvent {
  type: EventType;
  actor: Actor;
  durationMs?: number | null;
  round?: number | null;
  data?: Record<string, unknown>;
}

const EVENT_KEYS = ['schemaVersion', 'at', 'seq', 'type', 'actor', 'durationMs', 'round', 'data'];

/**
 * Local guard for one event line until the schema registry provides the
 * `events` schema. Returns a list of problems; empty means valid.
 */
export function eventProblems(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['event is not an object'];
  const event = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(event)) if (!EVENT_KEYS.includes(key)) problems.push(`unknown key ${key}`);
  if (!Number.isInteger(event.schemaVersion) || (event.schemaVersion as number) < 1) problems.push('schemaVersion must be an integer >= 1');
  if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) problems.push('at must be an ISO time');
  if (!Number.isInteger(event.seq) || (event.seq as number) < 1) problems.push('seq must be an integer >= 1');
  if (!(EVENT_TYPES as readonly unknown[]).includes(event.type)) problems.push(`type ${String(event.type)} is not an event type`);
  if (!['cli', 'agent', 'user'].includes(event.actor as string)) problems.push('actor must be cli, agent or user');
  if (!(event.durationMs === null || (typeof event.durationMs === 'number' && event.durationMs >= 0))) problems.push('durationMs must be null or >= 0');
  if (!(event.round === null || (Number.isInteger(event.round) && (event.round as number) >= 1))) problems.push('round must be null or an integer >= 1');
  if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) problems.push('data must be an object');
  return problems;
}

export function eventsFile(projectRoot: string): string {
  return path.join(projectRoot, 'events.jsonl');
}

export function lockFile(root: string): string {
  return path.join(root, '.lock');
}

function parseLine(line: string, file: string, lineNumber: number): ProjectEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new MfmError('SCHEMA_INVALID', { file, line: lineNumber }, { message: `${file} line ${lineNumber} is not JSON.` });
  }
  const problems = eventProblems(value);
  if (problems.length > 0) {
    throw new MfmError('SCHEMA_INVALID', { file, line: lineNumber, problems }, { message: `${file} line ${lineNumber} is not a valid event.` });
  }
  const event = value as ProjectEvent;
  if (event.schemaVersion > EVENTS_SCHEMA_VERSION) {
    throw new MfmError('SCHEMA_TOO_NEW', { file, line: lineNumber, schemaVersion: event.schemaVersion });
  }
  return event;
}

/** Every event of a project, in file order. */
export function readEvents(projectRoot: string): ProjectEvent[] {
  const file = eventsFile(projectRoot);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const events: ProjectEvent[] = [];
  lines.forEach((line, index) => {
    if (line.trim() !== '') events.push(parseLine(line, file, index + 1));
  });
  return events;
}

/** The last event line, read from the end of the file. */
export function lastEvent(projectRoot: string): ProjectEvent | null {
  const file = eventsFile(projectRoot);
  if (!existsSync(file)) return null;
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    let window = 64 * 1024;
    for (;;) {
      const start = Math.max(0, size - window);
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n').filter((line) => line.trim() !== '');
      // The first line of a partial window may be cut; only trust it when the window reaches the file start.
      if (lines.length > (start === 0 ? 0 : 1)) {
        const line = lines[lines.length - 1] ?? '';
        return parseLine(line, file, 0);
      }
      if (start === 0) return null;
      window *= 4;
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Append one event under the project lock (re-entrant when the caller holds it):
 * seq is the last seq plus one, written with one appendFile call.
 */
export function appendEvent(projectRoot: string, event: NewEvent, lock: LockOptions = { command: 'append-event' }): ProjectEvent {
  const release = acquireLock(lockFile(projectRoot), lock);
  try {
    const previous = lastEvent(projectRoot);
    const full: ProjectEvent = {
      schemaVersion: EVENTS_SCHEMA_VERSION,
      at: new Date().toISOString(),
      seq: (previous?.seq ?? 0) + 1,
      type: event.type,
      actor: event.actor,
      durationMs: event.durationMs ?? null,
      round: event.round ?? null,
      data: event.data ?? {},
    };
    const problems = eventProblems(full);
    if (problems.length > 0) {
      throw new MfmError('SCHEMA_INVALID', { problems }, { message: 'Refused to append an invalid event.' });
    }
    appendFileSync(eventsFile(projectRoot), `${JSON.stringify(full)}\n`);
    return full;
  } finally {
    release();
  }
}

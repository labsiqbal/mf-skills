// The append-only project event log, events.jsonl: one JSON object per line,
// each appended with a single appendFile call under the project lock, with a
// strictly increasing seq.
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { MfmError } from '../cli/errors';
import { issuesOf, parseDoc } from '../schemas/index';
import { EVENT_TYPES, EVENTS_VERSION, type EventType, eventSchema } from '../schemas/events';
import { acquireLock, type LockOptions } from './lock';

export const EVENTS_SCHEMA_VERSION = EVENTS_VERSION;
export { EVENT_TYPES };
export type { EventType };
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

/** Problems of one event line against the `events` schema; empty means valid. */
export function eventProblems(value: unknown): string[] {
  const result = v.safeParse(eventSchema, value);
  return result.success ? [] : issuesOf(result.issues).map((issue) => `${issue.path} ${issue.message}`);
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
  // Older lines migrate in memory; the file itself is never rewritten.
  return parseDoc('events', value, `${file} line ${lineNumber}`).doc as ProjectEvent;
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

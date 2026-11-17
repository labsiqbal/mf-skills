import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import { appendEvent, eventProblems, lastEvent, lastShown, planHash, readEvents } from '../../../src/paths/index';

const project = () => mkdtempSync(join(tmpdir(), 'mfm-events-'));

describe('event log', () => {
  it('appends one line per event with seq increasing from 1', () => {
    const root = project();
    const first = appendEvent(root, { type: 'project.created', actor: 'cli', data: { title: 't' } });
    const second = appendEvent(root, { type: 'note.added', actor: 'agent', data: { text: 'n' } });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(readEvents(root).map((event) => event.type)).toEqual(['project.created', 'note.added']);
    expect(lastEvent(root)?.seq).toBe(2);
    expect(Object.keys(first)).toEqual(['schemaVersion', 'at', 'seq', 'type', 'actor', 'durationMs', 'round', 'data']);
  });

  it('continues seq from the last line of a long log', () => {
    const root = project();
    const filler = 'x'.repeat(2000);
    for (let i = 0; i < 80; i += 1) appendEvent(root, { type: 'note.added', actor: 'agent', data: { text: filler } });
    expect(appendEvent(root, { type: 'note.added', actor: 'agent' }).seq).toBe(81);
  });

  it('guards the event line shape', () => {
    expect(eventProblems({ schemaVersion: 1, at: new Date().toISOString(), seq: 1, type: 'note.added', actor: 'agent', durationMs: null, round: null, data: {} })).toEqual([]);
    const problems = eventProblems({ schemaVersion: 1, at: 'yesterday', seq: 0, type: 'nope', actor: 'bot', durationMs: -1, round: 0, data: [], extra: 1 });
    for (const field of ['extra', 'at', 'seq', 'type', 'actor', 'durationMs', 'round', 'data']) {
      expect(problems.some((problem) => problem.startsWith(`${field} `)), field).toBe(true);
    }
    expect(() => appendEvent(project(), { type: 'bogus' as 'note.added', actor: 'agent' })).toThrow(MfmError);
  });

  it('refuses malformed and newer lines when reading', () => {
    const root = project();
    appendEvent(root, { type: 'note.added', actor: 'agent' });
    appendFileSync(join(root, 'events.jsonl'), 'not json\n');
    expect(() => readEvents(root)).toThrow(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
    const newer = project();
    writeFileSync(join(newer, 'events.jsonl'), `${JSON.stringify({ schemaVersion: 9, at: new Date().toISOString(), seq: 1, type: 'note.added', actor: 'agent', durationMs: null, round: null, data: {} })}\n`);
    expect(() => readEvents(newer)).toThrow(expect.objectContaining({ code: 'SCHEMA_TOO_NEW' }));
  });
});

describe('plan hashes', () => {
  it('hash the plan text with CRLF folded to LF', () => {
    const root = project();
    writeFileSync(join(root, 'a.json'), '{\n  "bpm": 120\n}\n');
    writeFileSync(join(root, 'b.json'), '{\r\n  "bpm": 120\r\n}\r\n');
    writeFileSync(join(root, 'c.json'), '{\n  "bpm": 121\n}\n');
    expect(planHash(join(root, 'a.json'))).toMatch(/^[0-9a-f]{64}$/);
    expect(planHash(join(root, 'a.json'))).toBe(planHash(join(root, 'b.json')));
    expect(planHash(join(root, 'a.json'))).not.toBe(planHash(join(root, 'c.json')));
  });

  it('lastShown returns the most recent plan.shown for the subject', () => {
    const root = project();
    appendEvent(root, { type: 'plan.shown', actor: 'cli', data: { subject: 'beatgrid', planHash: 'a' } });
    appendEvent(root, { type: 'plan.shown', actor: 'cli', data: { subject: 'placement', planHash: 'b' } });
    appendEvent(root, { type: 'plan.shown', actor: 'cli', data: { subject: 'beatgrid', planHash: 'c' } });
    expect(lastShown(root, 'beatgrid')?.data.planHash).toBe('c');
    expect(lastShown(root, 'placement')?.data.planHash).toBe('b');
    expect(lastShown(root, 'theme')).toBeNull();
  });
});

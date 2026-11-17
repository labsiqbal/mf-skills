import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { type Kind, jsonSchemaOf, parseDoc, readDoc, writeDoc } from '../../../src/schemas/index';
import { RESERVED_VARS } from '../../../src/schemas/move-meta';
import { scoresSchema } from '../../../src/schemas/scores';
import { MOVE_SIGNATURE, MoveSignature, THEME_SIGNATURE } from '../../../src/schemas/signature';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/schemas');
const fixture = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Record<string, any>;

const PLAN_KINDS: Kind[] = [
  'beatgrid',
  'beatgrid-resolved',
  'placement',
  'transcript',
  'move-meta',
  'theme-meta',
  'metrics',
  'scores',
  'judge-packet',
  'verdict',
  'sound',
  'track-analysis',
  'spec',
  'style',
  'library-index',
];

function rejected(kind: Kind, doc: unknown): boolean {
  try {
    parseDoc(kind, doc);
    return false;
  } catch (error) {
    expect((error as { code: string }).code).toBe('SCHEMA_INVALID');
    return true;
  }
}

describe('plan and quality kinds', () => {
  it.each(PLAN_KINDS)('%s round-trips its valid fixture', (kind) => {
    const file = join(mkdtempSync(join(tmpdir(), 'mfm-plan-')), `${kind}.json`);
    const doc = fixture(`${kind}.valid.json`);
    writeDoc(kind, file, doc);
    expect(readDoc(kind, file)).toEqual({ doc, from: 1, migrated: false });
  });

  it.each(PLAN_KINDS)('%s rejects its invalid fixture and an unknown key', (kind) => {
    expect(rejected(kind, fixture(`${kind}.invalid.json`))).toBe(true);
    expect(rejected(kind, { ...fixture(`${kind}.valid.json`), surprise: 1 })).toBe(true);
  });

  it.each(PLAN_KINDS)('%s has a draft 2020-12 JSON Schema', (kind) => {
    const schema = jsonSchemaOf(kind);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.additionalProperties).toBe(false);
    expect((schema.properties as Record<string, unknown>).kind).toEqual({ const: kind });
  });
});

describe('move meta', () => {
  it('rejects every reserved variable name, including aspect', () => {
    expect(RESERVED_VARS).toEqual(['aspect', 'mode', 'fps', 'seed', 'brand', 'width', 'height', 'keyColor', 'durationSec']);
    for (const name of RESERVED_VARS) {
      const meta = fixture('move-meta.valid.json');
      meta.vars[name] = { type: 'text', default: '', describe: 'reserved' };
      expect(rejected('move-meta', meta), name).toBe(true);
    }
  });

  it('limits oneLiner to 90 characters and needs at least two say lines of at most 80', () => {
    const meta = fixture('move-meta.valid.json');
    expect(rejected('move-meta', { ...meta, oneLiner: 'x'.repeat(91) })).toBe(true);
    expect(parseDoc('move-meta', { ...meta, oneLiner: 'x'.repeat(90) }).doc.oneLiner).toHaveLength(90);
    expect(rejected('move-meta', { ...meta, say: ['only one'] })).toBe(true);
    expect(rejected('move-meta', { ...meta, say: ['ok', 'y'.repeat(81)] })).toBe(true);
  });

  it('checks durations, holds, enums and list items', () => {
    const meta = fixture('move-meta.valid.json');
    expect(rejected('move-meta', { ...meta, durationSec: { min: 3, default: 2, max: 5 } })).toBe(true);
    expect(rejected('move-meta', { ...meta, holds: [{ from: 0.8, to: 0.2 }] })).toBe(true);
    expect(rejected('move-meta', { ...meta, vars: { tone: { type: 'enum', default: 'a', describe: 'no values' } } })).toBe(true);
    expect(rejected('move-meta', { ...meta, vars: { rows: { type: 'list', default: [], describe: 'no items' } } })).toBe(true);
    const { tessarine, mossmallow } = meta.examples;
    expect(rejected('move-meta', { ...meta, examples: { tessarine, mossmallow } })).toBe(true);
  });
});

describe('signatures', () => {
  it('reject a move signature value outside the closed vocabulary', () => {
    const meta = fixture('move-meta.valid.json');
    expect(rejected('move-meta', { ...meta, signature: { ...meta.signature, motion: 'wiggle' } })).toBe(true);
    expect(v.safeParse(MoveSignature, { ...meta.signature, layout: 'stack' }).success).toBe(true);
    expect(v.safeParse(MoveSignature, { ...meta.signature, extra: 'x' }).success).toBe(false);
  });

  it('keep the documented vocabulary sizes', () => {
    expect(Object.fromEntries(Object.entries(MOVE_SIGNATURE).map(([key, values]) => [key, values.length]))).toEqual({
      layout: 12, motion: 15, material: 9, data: 12, use: 10,
    });
    expect(Object.fromEntries(Object.entries(THEME_SIGNATURE).map(([key, values]) => [key, values.length]))).toEqual({
      pace: 6, grammar: 9, material: 9, palette: 6, type: 6, sound: 8,
    });
  });
});

describe('scores', () => {
  const fix = { at: '3.20-4.10', where: 'Shot 2, the card row.', problem: 'The cut lands half a beat late.', change: 'Move the cut to bar 3 beat 1.' };

  it('fails at target 8 when rhythm is 7 without a fix, and passes with one fix', () => {
    const scores = fixture('scores.valid.json');
    scores.axes.rhythm.score = 7;
    expect(v.safeParse(scoresSchema(8), scores).success).toBe(false);
    expect(rejected('scores', scores)).toBe(true);
    scores.axes.rhythm.fixes = [fix];
    expect(v.safeParse(scoresSchema(8), scores).success).toBe(true);
    expect(parseDoc('scores', scores).doc.axes.rhythm.score).toBe(7);
  });

  it('applies the active target: 8 needs a fix at target 9 but not at 8', () => {
    const scores = fixture('scores.valid.json');
    scores.axes.finish.score = 8;
    expect(v.safeParse(scoresSchema(8), scores).success).toBe(true);
    expect(v.safeParse(scoresSchema(9), scores).success).toBe(false);
    scores.axes.finish.fixes = [fix];
    expect(v.safeParse(scoresSchema(9), scores).success).toBe(true);
  });

  it('requires integer scores from 1 to 10 and one-sentence fix fields', () => {
    const scores = fixture('scores.valid.json');
    expect(v.safeParse(scoresSchema(8), { ...scores, axes: { ...scores.axes, hook: { ...scores.axes.hook, score: 8.5 } } }).success).toBe(false);
    expect(v.safeParse(scoresSchema(8), { ...scores, axes: { ...scores.axes, hook: { ...scores.axes.hook, score: 11 } } }).success).toBe(false);
    const badFix = { ...fix, change: 'Two lines\nare not allowed.' };
    expect(v.safeParse(scoresSchema(8), { ...scores, axes: { ...scores.axes, hook: { score: 7, notes: [], fixes: [badFix] } } }).success).toBe(false);
  });
});

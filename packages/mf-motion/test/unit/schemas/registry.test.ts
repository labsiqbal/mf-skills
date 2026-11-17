import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../src/cli/commands/index';
import { type Kind, KINDS, jsonSchemaOf, parseDoc, readDoc, schemaVersions, schemas, writeDoc } from '../../../src/schemas/index';
import { Hex, Id, RelPath } from '../../../src/schemas/shared';
import { runIn } from '../cli/harness';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/schemas');
const fixture = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Record<string, any>;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string; exitCode?: number });
  }
  return null;
};

describe('schema registry', () => {
  it('registers the user-state kinds with their versions and migrators', () => {
    expect(KINDS).toEqual(['profile', 'project', 'brand', 'brief', 'events']);
    expect(schemaVersions()).toEqual({ profile: 1, project: 1, brand: 1, brief: 1, events: 1 });
    for (const kind of KINDS) {
      expect(typeof schemas[kind].migrators).toBe('object');
      expect(v.safeParse(schemas[kind].schema, fixture(`${kind}.valid.json`)).success, kind).toBe(true);
    }
  });

  it.each(KINDS.filter((kind) => kind !== 'events'))('%s round-trips its valid fixture through writeDoc and readDoc', (kind) => {
    const file = join(mkdtempSync(join(tmpdir(), 'mfm-schema-')), `${kind}.json`);
    const doc = fixture(`${kind}.valid.json`);
    writeDoc(kind as Kind, file, doc);
    expect(readDoc(kind as Kind, file)).toEqual({ doc, from: 1, migrated: false });
  });

  it.each(KINDS)('%s rejects an unknown key', (kind) => {
    const doc = { ...fixture(`${kind}.valid.json`), surprise: true };
    expect(code(() => parseDoc(kind, doc))).toMatchObject({ code: 'SCHEMA_INVALID', exitCode: 2 });
  });

  it('accepts free-form notes only under x', () => {
    expect(parseDoc('project', fixture('project.valid.json')).doc.x).toEqual({ agentNote: 'free-form notes live under x' });
    expect(code(() => parseDoc('project', { ...fixture('project.valid.json'), x: [1] }))).toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('rejects lower-case hex colours', () => {
    const brand = fixture('brand.valid.json');
    brand.colors.accent = '#8b6dff';
    expect(code(() => parseDoc('brand', brand))).toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(v.safeParse(Hex, '#8B6DFF').success).toBe(true);
    expect(v.safeParse(Hex, '#8b6dff').success).toBe(false);
    expect(v.safeParse(Hex, '#FFF').success).toBe(false);
  });

  it('refuses a version 2 document with SCHEMA_TOO_NEW (exit 4)', () => {
    expect(code(() => parseDoc('profile', fixture('profile.v2.json')))).toMatchObject({ code: 'SCHEMA_TOO_NEW', exitCode: 4 });
    expect(code(() => parseDoc('events', { ...fixture('events.valid.json'), schemaVersion: 2 }))).toMatchObject({ code: 'SCHEMA_TOO_NEW' });
  });

  it('reads the synthetic version 0 profile in memory', () => {
    const parsed = readDoc('profile', join(fixtures, 'profile.v0.json'));
    expect(parsed.from).toBe(0);
    expect(parsed.migrated).toBe(true);
    expect(parsed.doc).toEqual(fixture('profile.valid.json'));
    expect(JSON.parse(readFileSync(join(fixtures, 'profile.v0.json'), 'utf8')).schemaVersion).toBe(0);
  });

  it('accepts a string or null for profile.cloud.voice-cloud.model, nothing else', () => {
    const profile = fixture('profile.valid.json');
    profile.cloud['voice-cloud'].model = 'voice-model-2';
    expect(parseDoc('profile', profile).doc.cloud['voice-cloud'].model).toBe('voice-model-2');
    profile.cloud['voice-cloud'].model = null;
    expect(parseDoc('profile', profile).doc.cloud['voice-cloud'].model).toBeNull();
    profile.cloud['voice-cloud'].model = 3;
    expect(code(() => parseDoc('profile', profile))).toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('enforces ids, relative POSIX paths, languages and picked shot counts', () => {
    expect(v.safeParse(Id, 'a'.repeat(48)).success).toBe(true);
    expect(v.safeParse(Id, 'a'.repeat(49)).success).toBe(false);
    expect(v.safeParse(Id, 'Launch-Film').success).toBe(false);
    for (const good of ['shots/shot-1.png', 'logo.svg', 'a/b..c/d']) expect(v.safeParse(RelPath, good).success, good).toBe(true);
    for (const bad of ['../x', 'a/../../b', '/abs/x', 'C:/x', 'a\\b', '..', '']) expect(v.safeParse(RelPath, bad).success, bad).toBe(false);
    expect(code(() => parseDoc('project', { ...fixture('project.valid.json'), language: 'not a tag' }))).toMatchObject({ code: 'SCHEMA_INVALID' });
    const brand = fixture('brand.valid.json');
    brand.shots = brand.shots.slice(0, 2);
    expect(code(() => parseDoc('brand', brand))).toMatchObject({ code: 'SCHEMA_INVALID' });
    brand.status = 'draft';
    expect(parseDoc('brand', brand).doc.status).toBe('draft');
  });

  it('checks the data of approval and plan events', () => {
    const event = fixture('events.valid.json');
    expect(code(() => parseDoc('events', { ...event, data: { subject: 'beatgrid', text: 'yes' } }))).toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(code(() => parseDoc('events', { ...event, data: { subject: 'nope', text: 'yes', planHash: 'x' } }))).toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(parseDoc('events', { ...event, type: 'note.added', actor: 'agent', data: { text: 'free' } }).doc.type).toBe('note.added');
  });

  it('produces draft 2020-12 JSON Schemas with strict objects', () => {
    for (const kind of KINDS) {
      const schema = jsonSchemaOf(kind);
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
    }
    const brand = jsonSchemaOf('brand') as any;
    expect(brand.properties.colors.properties.accent).toMatchObject({ type: 'string', pattern: '^#[0-9A-F]{6}$' });
    expect(brand.properties.colors.properties.palette).toMatchObject({ type: 'array', maxItems: 12 });
    expect(brand.required).toContain('colors');
    expect(brand.required).not.toContain('x');
    const profile = jsonSchemaOf('profile') as any;
    expect(profile.properties.cloud.properties['voice-cloud'].properties.model).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    const brief = jsonSchemaOf('brief') as any;
    expect(brief.properties.lengthSec).toMatchObject({ type: 'number', minimum: 10, maximum: 30 });
  });

  it('accepts the project.json written by `new`', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mfm-home-'));
    const result = await runIn(['new', 'Schema Check', '--type', 'film', '--home', home, '--json'], COMMANDS);
    expect(result.code).toBe(0);
    const root = JSON.parse(result.stdout).data.project.root as string;
    expect(readDoc('project', join(root, 'project.json')).migrated).toBe(false);
    for (const line of readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n')) {
      expect(parseDoc('events', JSON.parse(line)).doc.seq).toBe(1);
    }
  });
});

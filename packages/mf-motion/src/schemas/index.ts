// One registry of persisted contracts, keyed by kind. Readers accept any
// version from the oldest migrator up to current and migrate in memory;
// writers always write current; a newer version is refused with SCHEMA_TOO_NEW.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { MfmError } from '../cli/errors';
import { BRAND_VERSION, brandSchema } from './brand';
import { BRIEF_VERSION, briefSchema } from './brief';
import { EVENTS_VERSION, eventSchema } from './events';
import { PROFILE_VERSION, migrateProfile0To1, profileSchema } from './profile';
import { PROJECT_VERSION, projectSchema } from './project';
import { type JsonSchema, toJsonSchema } from './shared';
import { beatgridResolvedSchema, beatgridSchema } from './beatgrid';
import { judgePacketSchema } from './judge-packet';
import { libraryIndexSchema } from './library-index';
import { metricsSchema } from './metrics';
import { moveMetaSchema } from './move-meta';
import { placementSchema } from './placement';
import { scoresRegistered } from './scores';
import { soundSchema } from './sound';
import { specSchema } from './spec';
import { styleSchema } from './style';
import { themeMetaSchema } from './theme-meta';
import { trackAnalysisSchema } from './track-analysis';
import { transcriptSchema } from './transcript';
import { verdictSchema } from './verdict';

export type Migrator = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface SchemaEntry {
  /** Current schemaVersion of the kind. */
  version: number;
  schema: v.GenericSchema;
  /** migrators[n] turns version n into version n + 1. */
  migrators: Record<number, Migrator>;
  /** Where the document lives, for help text. */
  file: string;
  /** JSONL kinds (events) have no `kind` field and are never rewritten. */
  lines?: boolean;
}

export const schemas = {
  profile: { version: PROFILE_VERSION, schema: profileSchema, migrators: { 0: migrateProfile0To1 }, file: '<data home>/profile.json' },
  project: { version: PROJECT_VERSION, schema: projectSchema, migrators: {}, file: '<project>/project.json' },
  brand: { version: BRAND_VERSION, schema: brandSchema, migrators: {}, file: '<data home>/brands/<id>/brand.json' },
  brief: { version: BRIEF_VERSION, schema: briefSchema, migrators: {}, file: '<project>/plan/brief.json' },
  events: { version: EVENTS_VERSION, schema: eventSchema, migrators: {}, file: '<project>/events.jsonl', lines: true },
  // Plan and quality contracts.
  beatgrid: { version: 1, schema: beatgridSchema, migrators: {}, file: '<project>/plan/beatgrid.json' },
  'beatgrid-resolved': { version: 1, schema: beatgridResolvedSchema, migrators: {}, file: '<project>/plan/beatgrid.resolved.json' },
  placement: { version: 1, schema: placementSchema, migrators: {}, file: '<project>/plan/placement.json' },
  transcript: { version: 1, schema: transcriptSchema, migrators: {}, file: '<project>/media/transcript.json' },
  'move-meta': { version: 1, schema: moveMetaSchema, migrators: {}, file: 'meta exported by every move module' },
  'theme-meta': { version: 1, schema: themeMetaSchema, migrators: {}, file: 'meta exported by every theme module' },
  metrics: { version: 1, schema: metricsSchema, migrators: {}, file: '<project>/rounds/<n>/metrics.json' },
  scores: { version: 1, schema: scoresRegistered, migrators: {}, file: '<project>/rounds/<n>/scores.json' },
  'judge-packet': { version: 1, schema: judgePacketSchema, migrators: {}, file: '<project>/rounds/<n>/packet/packet.json' },
  verdict: { version: 1, schema: verdictSchema, migrators: {}, file: '<project>/rounds/<n>/verdict.json' },
  sound: { version: 1, schema: soundSchema, migrators: {}, file: '<project>/sound/sound.json' },
  'track-analysis': { version: 1, schema: trackAnalysisSchema, migrators: {}, file: '<project>/sound/track-analysis.json' },
  spec: { version: 1, schema: specSchema, migrators: {}, file: '<project>/plan/spec.json' },
  style: { version: 1, schema: styleSchema, migrators: {}, file: '<project>/ref/style.json' },
  'library-index': { version: 1, schema: libraryIndexSchema, migrators: {}, file: '<data home>/library/index.json' },
} satisfies Record<string, SchemaEntry>;

export type Kind = keyof typeof schemas;
export const KINDS = Object.keys(schemas) as Kind[];

export function isKind(value: string): value is Kind {
  return Object.hasOwn(schemas, value);
}

/** `{ kind: version }` for `mf-motion version`. */
export function schemaVersions(): Record<string, number> {
  return Object.fromEntries(KINDS.map((kind) => [kind, schemas[kind].version]));
}

/** Draft 2020-12 JSON Schema of a kind. */
export function jsonSchemaOf(kind: Kind): JsonSchema {
  const entry: SchemaEntry = schemas[kind];
  return toJsonSchema(entry.schema, kind);
}

export interface Issue {
  path: string;
  message: string;
}

export function issuesOf(error: v.ValiError<v.GenericSchema> | v.GenericIssue[]): Issue[] {
  const list = Array.isArray(error) ? error : error.issues;
  return list.map((issue) => ({
    path: (issue.path ?? []).map((item) => String(item.key)).join('.') || '(root)',
    message: issue.message,
  }));
}

function versionOf(value: unknown): number | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).schemaVersion;
  return Number.isInteger(version) ? (version as number) : null;
}

/** The oldest version a kind can still read. */
export function oldestVersion(kind: Kind): number {
  const entry: SchemaEntry = schemas[kind];
  const steps = Object.keys(entry.migrators).map(Number);
  return steps.length > 0 ? Math.min(...steps) : entry.version;
}

export interface Parsed<T> {
  doc: T;
  /** Version found before migration. */
  from: number;
  migrated: boolean;
}

/** Validate an in-memory value of a kind, migrating older versions first. */
export function parseDoc<K extends Kind>(kind: K, value: unknown, source: string = kind): Parsed<v.InferOutput<(typeof schemas)[K]['schema']>> {
  const entry: SchemaEntry = schemas[kind];
  const from = versionOf(value);
  if (from === null) {
    throw new MfmError('SCHEMA_INVALID', { kind, file: source, issues: [{ path: 'schemaVersion', message: 'missing or not an integer' }] }, {
      message: `${source} has no integer schemaVersion.`,
    });
  }
  if (from > entry.version) {
    throw new MfmError('SCHEMA_TOO_NEW', { kind, file: source, schemaVersion: from, supported: entry.version }, {
      message: `${source} is ${kind} version ${from}; this CLI reads up to version ${entry.version}.`,
      hint: 'Update the mf-motion CLI to a version that knows this schema.',
    });
  }
  let doc = value as Record<string, unknown>;
  for (let version = from; version < entry.version; version += 1) {
    const step = entry.migrators[version];
    if (!step) {
      throw new MfmError('SCHEMA_INVALID', { kind, file: source, schemaVersion: from }, {
        message: `${source} is ${kind} version ${from}, which no migrator reads.`,
      });
    }
    doc = step(structuredClone(doc));
  }
  const result = v.safeParse(entry.schema, doc);
  if (!result.success) {
    throw new MfmError('SCHEMA_INVALID', { kind, file: source, issues: issuesOf(result.issues) }, {
      message: `${source} is not a valid ${kind}: ${issuesOf(result.issues)
        .slice(0, 3)
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}.`,
    });
  }
  return { doc: result.output as v.InferOutput<(typeof schemas)[K]['schema']>, from, migrated: from !== entry.version };
}

/** Read a JSON document of a kind, migrating older versions in memory. */
export function readDoc<K extends Kind>(kind: K, file: string): Parsed<v.InferOutput<(typeof schemas)[K]['schema']>> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    throw new MfmError('SCHEMA_INVALID', { kind, file }, { message: `${file} is not valid JSON.` });
  }
  return parseDoc(kind, value, file);
}

/** Validate and write a document of a kind at its current version (temporary file, then rename). */
export function writeDoc<K extends Kind>(kind: K, file: string, doc: unknown): void {
  const entry: SchemaEntry = schemas[kind];
  if (entry.lines) throw new Error(`${kind} is a JSONL kind; append lines instead`);
  const { doc: valid, migrated } = parseDoc(kind, doc, file);
  if (migrated) throw new MfmError('SCHEMA_INVALID', { kind, file }, { message: `Refused to write ${kind} below version ${entry.version}.` });
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(valid, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export { toJsonSchema };
export type { JsonSchema };

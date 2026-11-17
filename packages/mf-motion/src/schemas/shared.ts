// Shared schema pieces and rules for every persisted contract:
// strict objects (unknown keys rejected except under `x`), upper-case hex,
// POSIX relative paths, kebab-case ids of at most 48 characters, ISO times.
import * as v from 'valibot';

export const ID_MAX = 48;

/** Kebab-case id: [a-z0-9]+(-[a-z0-9]+)*, at most 48 characters. */
export const Id = v.pipe(v.string(), v.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), v.maxLength(ID_MAX), v.description('kebab-case id'));

/** Brand id: a registrable domain with dots kept (tessarine.example) or a kebab-case slug. */
export const BrandId = v.pipe(
  v.string(),
  v.regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/),
  v.maxLength(ID_MAX * 2),
  v.description('brand id: domain with dots kept, or a kebab-case slug'),
);

/** #RRGGBB, upper case. */
export const Hex = v.pipe(v.string(), v.regex(/^#[0-9A-F]{6}$/), v.description('#RRGGBB, upper case'));

export const ASPECTS = ['16:9', '9:16', '1:1'] as const;
export const Aspect = v.picklist(ASPECTS);

export const PROFILES = ['film', 'broll', 'overlay-alpha', 'overlay-key'] as const;
export const Profile = v.picklist(PROFILES);

export const AXES = ['hook', 'brand', 'motion', 'legibility', 'rhythm', 'finish'] as const;
export const Axis = v.picklist(AXES);

/** Time grammar value: seconds as a number or an expression string (time-grammar.md). */
export const TimeSpec = v.union([v.string(), v.number()]);

const oneSentence = v.pipe(v.string(), v.minLength(1), v.regex(/^[^\r\n]*$/));

/** One fix line: at "3.20" or "3.20-4.10" seconds; every field one sentence without line breaks. */
export const Fix = v.strictObject({
  at: v.pipe(v.string(), v.regex(/^\d+(\.\d+)?(-\d+(\.\d+)?)?$/)),
  where: oneSentence,
  problem: oneSentence,
  change: oneSentence,
});

/** ISO 8601 date-time. */
export const IsoTime = v.pipe(v.string(), v.isoTimestamp());

/** Seconds with at most 3 decimals. */
export const Seconds = v.pipe(
  v.number(),
  v.minValue(0),
  v.check((value) => Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6, 'at most 3 decimals'),
);

/**
 * POSIX path relative to the document's root folder: no backslashes, no drive,
 * no leading slash, no `..` segment.
 */
export const RelPath = v.pipe(
  v.string(),
  v.minLength(1),
  v.regex(/^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!(.*\/)?\.\.(\/|$)).+$/),
  v.description('POSIX path relative to the document root'),
);

/** BCP 47 language tag. */
export const Language = v.pipe(
  v.string(),
  v.check((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, 'a BCP 47 language tag'),
  v.description('BCP 47 language tag'),
);

const isPlainObject = (input: unknown) => typeof input === 'object' && input !== null && !Array.isArray(input);

/** A string-keyed object; valibot records alone also accept arrays. */
export function plainRecord<const T extends v.GenericSchema>(value: T) {
  return v.pipe(v.custom<Record<string, unknown>>(isPlainObject, 'an object, not an array'), v.record(v.string(), value));
}

/** Free-form notes the CLI never reads. */
export const Notes = v.optional(plainRecord(v.unknown()));

/** A persisted document: schemaVersion and kind first, strict, with an optional `x`. */
export function documentSchema<const K extends string, const E extends v.ObjectEntries>(kind: K, version: number, entries: E) {
  return v.strictObject({
    schemaVersion: v.literal(version),
    kind: v.literal(kind),
    ...entries,
    x: Notes,
  });
}

// JSON Schema (draft 2020-12) generated from the valibot schemas, for agents
// and editors. Covers the schema and action types these contracts use.

export type JsonSchema = { [key: string]: unknown };
type Node = { type: string; [key: string]: unknown };

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

function convert(node: Node): JsonSchema {
  if (Array.isArray(node.pipe)) {
    // pipe[0] is the base schema (itself possibly a pipe); the rest are actions.
    // Later schema steps narrow the value further and replace the base shape.
    const [base, ...steps] = node.pipe as Node[];
    let out = convert(base as Node);
    const actionSteps: Node[] = [];
    for (const step of steps) {
      if (step.kind === 'schema') out = { ...out, ...convert(step) };
      else actionSteps.push(step);
    }
    applyActions(out, actionSteps);
    return out;
  }
  let out: JsonSchema;
  switch (node.type) {
    case 'string':
      out = { type: 'string' };
      break;
    case 'number':
      out = { type: 'number' };
      break;
    case 'boolean':
      out = { type: 'boolean' };
      break;
    case 'null':
      out = { type: 'null' };
      break;
    case 'unknown':
    case 'any':
    case 'custom':
      out = {};
      break;
    case 'literal':
      out = { const: node.literal };
      break;
    case 'picklist':
      out = { enum: [...(node.options as unknown[])] };
      break;
    case 'nullable': {
      const inner = convert(node.wrapped as Node);
      out = { anyOf: [inner, { type: 'null' }] };
      break;
    }
    case 'optional':
      out = convert(node.wrapped as Node);
      break;
    case 'array':
      out = { type: 'array', items: convert(node.item as Node) };
      break;
    case 'record':
      out = { type: 'object', additionalProperties: convert(node.value as Node) };
      break;
    case 'union':
    case 'variant':
      out = { anyOf: (node.options as Node[]).map(convert) };
      break;
    case 'object':
    case 'strict_object':
    case 'loose_object': {
      const entries = node.entries as Record<string, Node>;
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(entries)) {
        properties[key] = convert(child);
        if (child.type !== 'optional') required.push(key);
      }
      out = { type: 'object', properties, required, additionalProperties: node.type !== 'strict_object' };
      break;
    }
    default:
      throw new Error(`No JSON Schema mapping for valibot type "${node.type}"`);
  }
  return out;
}

function applyActions(out: JsonSchema, steps: Node[]): void {
  const isArray = out.type === 'array';
  for (const action of steps) {
    switch (action.type) {
      case 'regex':
        out.pattern = (action.requirement as RegExp).source;
        break;
      case 'min_length':
        out[isArray ? 'minItems' : 'minLength'] = action.requirement;
        break;
      case 'max_length':
        out[isArray ? 'maxItems' : 'maxLength'] = action.requirement;
        break;
      case 'min_value':
        out.minimum = action.requirement;
        break;
      case 'max_value':
        out.maximum = action.requirement;
        break;
      case 'integer':
        out.type = 'integer';
        break;
      case 'iso_timestamp':
        out.format = 'date-time';
        break;
      case 'description':
        out.description = action.description;
        break;
      case 'check':
        out.description = out.description ?? (typeof action.message === 'string' ? action.message : undefined);
        if (out.description === undefined) delete out.description;
        break;
      default:
        throw new Error(`No JSON Schema mapping for valibot action "${action.type}"`);
    }
  }
}

/** Draft 2020-12 JSON Schema of a valibot schema. */
export function toJsonSchema(schema: v.GenericSchema, title?: string): JsonSchema {
  return { $schema: DRAFT, ...(title ? { title } : {}), ...convert(schema as unknown as Node) };
}

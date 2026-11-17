// The meta object every move module exports.
import * as v from 'valibot';
import { Aspect, Id, documentSchema } from './shared';
import { MoveSignature } from './signature';

export const CATEGORIES = ['social', 'creator', 'ai', 'dev', 'productivity', 'business', 'data', 'paper', 'system', 'explain'] as const;
export const Category = v.picklist(CATEGORIES);

/** Variable names the renderer owns; a move may not declare them. */
export const RESERVED_VARS = ['aspect', 'mode', 'fps', 'seed', 'brand', 'width', 'height', 'keyColor', 'durationSec'] as const;

export const ONE_LINER_MAX = 90;
export const SAY_MAX = 80;
export const SAY_MIN_COUNT = 2;
export const DEMO_BRANDS = ['tessarine', 'mossmallow', 'quillfen'] as const;

export const VAR_TYPES = ['text', 'number', 'color-role', 'image', 'list', 'enum', 'boolean'] as const;

const varSpecEntries = {
  type: v.picklist(VAR_TYPES),
  default: v.unknown(),
  maxChars: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  values: v.optional(v.array(v.string())),
  maxItems: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  describe: v.pipe(v.string(), v.minLength(1)),
};

function enumHasValues<T extends { type: string; values?: string[] | undefined }>() {
  return v.check<T, string>((spec) => spec.type !== 'enum' || (spec.values?.length ?? 0) > 0, 'an enum variable lists its values');
}

/** Item spec of a list variable (one level; lists of lists are not supported). */
const VarItemSpec = v.pipe(v.strictObject(varSpecEntries), enumHasValues());

export const VarSpec = v.pipe(
  v.strictObject({ ...varSpecEntries, items: v.optional(VarItemSpec) }),
  enumHasValues(),
  v.check((spec) => spec.type !== 'list' || spec.items !== undefined, 'a list variable declares its items'),
);

const fraction = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const semver = v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/));
const nonEmpty = <T extends v.GenericSchema>(item: T) => v.pipe(v.array(item), v.minLength(1));

export const moveMetaSchema = v.pipe(
  documentSchema('move-meta', 1, {
    id: Id,
    version: semver,
    name: v.pipe(v.string(), v.minLength(1)),
    oneLiner: v.pipe(v.string(), v.minLength(1), v.maxLength(ONE_LINER_MAX)),
    category: Category,
    uses: nonEmpty(v.picklist(['overlay', 'broll'])),
    aspects: nonEmpty(Aspect),
    modes: nonEmpty(v.picklist(['full', 'alpha', 'key'])),
    durationSec: v.strictObject({
      min: v.pipe(v.number(), v.minValue(0)),
      default: v.pipe(v.number(), v.minValue(0)),
      max: v.pipe(v.number(), v.minValue(0)),
    }),
    /** Fractions 0-1 of the duration exempt from the still-stretch rule. */
    holds: v.array(v.strictObject({ from: fraction, to: fraction })),
    avoidFace: v.boolean(),
    /** "When the speaker says" triggers. */
    say: v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(SAY_MAX))), v.minLength(SAY_MIN_COUNT)),
    tags: v.array(v.string()),
    signature: MoveSignature,
    vars: v.pipe(
      v.record(v.string(), VarSpec),
      v.check(
        (vars) => !Object.keys(vars).some((name) => (RESERVED_VARS as readonly string[]).includes(name)),
        `a move may not declare a reserved variable (${RESERVED_VARS.join(', ')})`,
      ),
    ),
    examples: v.strictObject({
      tessarine: v.record(v.string(), v.unknown()),
      mossmallow: v.record(v.string(), v.unknown()),
      quillfen: v.record(v.string(), v.unknown()),
    }),
    /** Kit pieces used, for the coverage report. */
    kit: v.array(v.string()),
    status: v.picklist(['seed', 'draft', 'pass', 'dropped']),
  }),
  v.check((meta) => meta.durationSec.min <= meta.durationSec.default && meta.durationSec.default <= meta.durationSec.max, 'durationSec min <= default <= max'),
  v.check((meta) => meta.holds.every((hold) => hold.from < hold.to), 'every hold ends after it starts'),
);


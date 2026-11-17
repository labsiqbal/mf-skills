// The meta object every theme module exports.
import * as v from 'valibot';
import { Aspect, Id, documentSchema } from './shared';
import { ONE_LINER_MAX } from './move-meta';
import { ThemeSignature } from './signature';

const fraction = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const pair = <T extends v.GenericSchema>(item: T) => v.pipe(v.array(item), v.minLength(2), v.maxLength(2));

export const themeMetaSchema = v.pipe(
  documentSchema('theme-meta', 1, {
    id: Id,
    version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/)),
    name: v.pipe(v.string(), v.minLength(1)),
    oneLiner: v.pipe(v.string(), v.minLength(1), v.maxLength(ONE_LINER_MAX)),
    bestFor: v.array(v.string()),
    aspects: v.pipe(v.array(Aspect), v.minLength(1)),
    lengthSec: v.strictObject({ min: v.pipe(v.number(), v.minValue(0)), max: v.pipe(v.number(), v.minValue(0)) }),
    /** [low, high] beats per minute. */
    bpm: pair(v.pipe(v.number(), v.minValue(1))),
    genre: v.pipe(v.string(), v.minLength(1)),
    /** Three fractions 0-1 used by the theme board. */
    stills: v.pipe(v.array(fraction), v.minLength(3), v.maxLength(3)),
    /** Scene template ids the theme provides. */
    scenes: v.pipe(v.array(Id), v.minLength(1)),
    signature: ThemeSignature,
    status: v.picklist(['seed', 'draft', 'pass', 'dropped']),
  }),
  v.check((meta) => meta.lengthSec.min <= meta.lengthSec.max, 'lengthSec min <= max'),
  v.check((meta) => (meta.bpm[0] ?? 0) <= (meta.bpm[1] ?? 0), 'bpm low <= high'),
);

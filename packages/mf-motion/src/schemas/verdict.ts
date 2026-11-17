// The verdict (rounds/<n>/verdict.json); only `mf-motion gate` writes it.
import * as v from 'valibot';
import { Axis, IsoTime, Profile, documentSchema } from './shared';
import { Unit } from './judge-packet';

const axisScore = v.pipe(v.number(), v.minValue(0), v.maxValue(10));
const limitValue = v.union([v.number(), v.string()]);
const sha256 = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

export const verdictSchema = documentSchema('verdict', 1, {
  unit: Unit,
  round: v.pipe(v.number(), v.integer(), v.minValue(1)),
  profile: Profile,
  target: v.picklist([8, 9]),
  library: v.boolean(),
  level: v.picklist(['PASS', 'PASS-SELF', 'PASS-MEASURED', 'FAIL']),
  hardFailures: v.array(v.strictObject({ check: v.string(), value: limitValue, limit: limitValue })),
  capped: v.array(v.strictObject({ axis: Axis, raw: axisScore, capped: axisScore, because: v.string() })),
  effective: v.nullable(
    v.strictObject({ hook: axisScore, brand: axisScore, motion: axisScore, legibility: axisScore, rhythm: axisScore, finish: axisScore }),
  ),
  min: v.nullable(axisScore),
  mean: v.nullable(axisScore),
  packetHash: sha256,
  scoresHash: v.nullable(sha256),
  rubricVersion: v.pipe(v.string(), v.minLength(1)),
  engine: v.pipe(v.string(), v.minLength(1)),
  cli: v.pipe(v.string(), v.minLength(1)),
  at: IsoTime,
});

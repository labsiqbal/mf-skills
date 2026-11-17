// Reference style numbers (ref/style.json).
import * as v from 'valibot';
import { Hex, RelPath, documentSchema } from './shared';

const sec = v.pipe(v.number(), v.minValue(0));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));

export const styleSchema = documentSchema('style', 1, {
  source: RelPath,
  durationSec: sec,
  cuts: v.array(sec),
  shotLengths: v.array(sec),
  shotStats: v.strictObject({ cuts: count, shots: count, median: sec, mean: sec, shortest: sec, longest: sec }),
  palette: v.array(
    v.strictObject({ hex: Hex, share: v.pipe(v.number(), v.minValue(0), v.maxValue(1)), area: v.picklist(['ground', 'subject', 'type']) }),
  ),
  motionEnergy: v.array(v.pipe(v.number(), v.minValue(0))),
  sheets: v.array(RelPath),
  strips: v.array(RelPath),
});

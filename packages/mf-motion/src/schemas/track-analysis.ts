import * as v from 'valibot';
import { RelPath, documentSchema } from './shared';

const nonNegative = v.pipe(v.number(), v.minValue(0));

export const trackAnalysisSchema = documentSchema('track-analysis', 1, {
  file: RelPath,
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  provider: v.picklist(['hyperframes-local', 'fallback']),
  bpm: v.pipe(v.number(), v.minValue(1)),
  bpmCurve: v.array(v.pipe(v.number(), v.minValue(1))),
  beats: v.array(nonNegative),
  downbeats: v.array(nonNegative),
  meter: v.picklist([3, 4]),
  sections: v.array(v.strictObject({ from: nonNegative, to: nonNegative, label: v.nullable(v.string()) })),
  drop: v.nullable(v.strictObject({ atSec: nonNegative, confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) })),
  lufs: v.number(),
  truePeak: v.number(),
});

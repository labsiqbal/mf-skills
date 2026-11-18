// Measurements of one delivered file (rounds/<n>/metrics.json).
import * as v from 'valibot';
import { Aspect, Axis, Hex, Profile, documentSchema } from './shared';
import { SfxRole } from './sound';

const sec = v.pipe(v.number(), v.minValue(0));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const fraction = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const limitValue = v.union([v.number(), v.string()]);

export const AUDIT_PROBLEMS = ['frame-margin', 'copy-safe', 'spill', 'overlap', 'caption-band', 'face-band', 'min-size', 'short-line'] as const;

export const metricsSchema = documentSchema('metrics', 1, {
  file: v.pipe(v.string(), v.minLength(1)),
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  profile: Profile,
  aspect: Aspect,
  mode: v.picklist(['full', 'alpha', 'key']),
  durationSec: sec,
  expectedSec: sec,
  frames: count,
  fps: v.pipe(v.string(), v.regex(/^[1-9]\d*(\/[1-9]\d*)?$/)),
  timestamps: v.strictObject({ irregular: count, maxJitterMs: v.pipe(v.number(), v.minValue(0)) }),
  /** film and broll only. */
  frame0Ink: v.nullable(fraction),
  overlayCoverage: v.nullable(v.strictObject({ first: fraction, last: fraction, firstInkSec: sec })),
  stills: v.array(v.strictObject({ fromSec: sec, toSec: sec, lenSec: sec, exempt: v.nullable(v.picklist(['end-card', 'hold'])) })),
  longestStillSec: sec,
  contrast: v.array(
    v.strictObject({ atSec: sec, elementId: v.string(), ratio: v.pipe(v.number(), v.minValue(1)), plate: v.nullable(v.string()) }),
  ),
  audit: v.strictObject({
    hits: v.array(v.strictObject({ fromSec: sec, toSec: sec, elementId: v.string(), problem: v.picklist(AUDIT_PROBLEMS) })),
  }),
  lines: v.array(
    v.strictObject({ elementId: v.string(), inSec: sec, outSec: sec, holdSec: sec, words: count, ok: v.boolean() }),
  ),
  key: v.nullable(v.strictObject({ color: Hex, impurePixels: count })),
  audio: v.nullable(
    v.strictObject({
      lufs: v.number(),
      truePeak: v.number(),
      lowShare: fraction,
      sfx: v.array(v.strictObject({ role: SfxRole, event: v.string(), atSec: sec, peakOffsetMs: v.number(), riseDb: v.number() })),
    }),
  ),
  engineCheck: v.strictObject({
    errors: count,
    warnings: count,
    findings: v.array(v.strictObject({ code: v.string(), atSec: v.nullable(sec), message: v.string() })),
  }),
  hard: v.array(v.strictObject({ check: v.string(), pass: v.boolean(), value: limitValue, limit: limitValue })),
  caps: v.array(v.strictObject({ axis: Axis, cap: v.pipe(v.number(), v.minValue(1), v.maxValue(10)), because: v.string() })),
});

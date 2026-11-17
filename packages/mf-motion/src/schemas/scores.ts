// The judge's scores (rounds/<n>/scores.json). Any axis under the active
// target must carry at least one fix line.
import * as v from 'valibot';
import { AXES, Fix, IsoTime, documentSchema } from './shared';

export const TARGETS = [8, 9] as const;
export type Target = (typeof TARGETS)[number];

const AxisScore = v.strictObject({
  /** Integer 1-10. */
  score: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)),
  notes: v.array(v.string()),
  fixes: v.array(Fix),
});

const scoresBase = documentSchema('scores', 1, {
  /** Must equal the packet's hash. */
  packetHash: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  judge: v.strictObject({
    mode: v.picklist(['fresh', 'self']),
    context: v.picklist(['subagent', 'same-session', 'lab-api']),
    provider: v.nullable(v.string()),
    modelId: v.nullable(v.string()),
  }),
  axes: v.strictObject({
    hook: AxisScore,
    brand: AxisScore,
    motion: AxisScore,
    legibility: AxisScore,
    rhythm: AxisScore,
    finish: AxisScore,
  }),
  at: IsoTime,
});

/** Axes scored under the target without a fix line. */
export function axesMissingFixes(doc: v.InferOutput<typeof scoresBase>, target: Target): string[] {
  return AXES.filter((axis) => doc.axes[axis].score < target && doc.axes[axis].fixes.length === 0);
}

/** The scores schema for an active target (8 or 9). */
export function scoresSchema(target: Target) {
  return v.pipe(
    scoresBase,
    v.check((doc) => axesMissingFixes(doc, target).length === 0, `every axis under ${target} carries at least one fix line`),
  );
}

/**
 * Registered schema: target 8, the lowest target, so the rule always holds;
 * the gate re-validates with its active target.
 */
export const scoresRegistered = scoresSchema(8);

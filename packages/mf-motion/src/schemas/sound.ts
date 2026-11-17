import * as v from 'valibot';
import { RelPath, Seconds, documentSchema } from './shared';

export const SFX_ROLES = ['click', 'tick', 'type', 'pop', 'whoosh', 'hit', 'shimmer', 'riser'] as const;
export const SfxRole = v.picklist(SFX_ROLES);

export const soundSchema = documentSchema('sound', 1, {
  mode: v.picklist(['synth', 'track']),
  file: RelPath,
  raw: v.nullable(RelPath),
  seconds: Seconds,
  bpm: v.pipe(v.number(), v.minValue(1)),
  key: v.nullable(v.string()),
  genre: v.nullable(v.string()),
  seed: v.nullable(v.pipe(v.number(), v.integer())),
  lufs: v.number(),
  truePeak: v.number(),
  lowShare: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  voice: v.nullable(RelPath),
  sfx: v.array(
    v.strictObject({
      role: SfxRole,
      event: v.pipe(v.string(), v.minLength(1)),
      atSec: Seconds,
      peakAtSec: Seconds,
      gainDb: v.number(),
    }),
  ),
});

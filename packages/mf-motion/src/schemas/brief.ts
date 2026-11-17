import * as v from 'valibot';
import { Aspect, Id, IsoTime, RelPath, Seconds, documentSchema } from './shared';

export const BRIEF_VERSION = 1;

/** film.lengthSec range (safe-zones-and-numbers.md). */
export const FILM_LENGTH_SEC = { min: 10, max: 30 } as const;

export const briefSchema = documentSchema('brief', BRIEF_VERSION, {
  purpose: v.pipe(v.string(), v.minLength(1)),
  audience: v.pipe(v.string(), v.minLength(1)),
  lengthSec: v.pipe(Seconds, v.minValue(FILM_LENGTH_SEC.min), v.maxValue(FILM_LENGTH_SEC.max)),
  aspect: Aspect,
  theme: v.nullable(Id),
  signatureMoment: v.pipe(v.string(), v.minLength(1)),
  cta: v.nullable(v.string()),
  mustSay: v.array(v.string()),
  mustNotSay: v.array(v.string()),
  captions: v.boolean(),
  voiceover: v.picklist(['none', 'local', 'cloud', 'user']),
  music: v.picklist(['synth', 'user-track']),
  reference: v.nullable(RelPath),
  answeredAt: IsoTime,
});

export type BriefDoc = v.InferOutput<typeof briefSchema>;

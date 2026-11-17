import * as v from 'valibot';
import { Aspect, BrandId, Id, IsoTime, Language, documentSchema } from './shared';

export const PROJECT_VERSION = 1;

export const projectSchema = documentSchema('project', PROJECT_VERSION, {
  id: Id,
  title: v.pipe(v.string(), v.minLength(1)),
  type: v.picklist(['film', 'moves']),
  aspect: Aspect,
  width: v.pipe(v.number(), v.integer(), v.minValue(1)),
  height: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** "30" or a rational such as "30000/1001". */
  fps: v.pipe(v.string(), v.regex(/^[1-9]\d*(\/[1-9]\d*)?$/)),
  brand: v.nullable(BrandId),
  theme: v.nullable(Id),
  language: Language,
  engine: v.strictObject({ hyperframes: v.string(), gsap: v.string(), three: v.string() }),
  /** CLI version that created the project. */
  cli: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+([-+].*)?$/)),
  createdAt: IsoTime,
});

export type ProjectDoc = v.InferOutput<typeof projectSchema>;

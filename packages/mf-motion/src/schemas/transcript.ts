import * as v from 'valibot';
import { Language, documentSchema } from './shared';

const time = v.pipe(v.number(), v.minValue(0));

export const transcriptSchema = v.pipe(
  documentSchema('transcript', 1, {
    language: Language,
    engine: v.pipe(v.string(), v.minLength(1)),
    model: v.pipe(v.string(), v.minLength(1)),
    words: v.array(
      v.strictObject({
        w: v.pipe(v.string(), v.minLength(1)),
        start: time,
        end: time,
        conf: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
      }),
    ),
    lines: v.array(v.strictObject({ text: v.string(), start: time, end: time })),
  }),
  v.check(
    (doc) => [...doc.words, ...doc.lines].every((span) => span.end >= span.start),
    'every word and line ends at or after its start',
  ),
);

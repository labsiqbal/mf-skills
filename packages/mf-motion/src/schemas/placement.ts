import * as v from 'valibot';
import { Aspect, Id, RelPath, plainRecord, documentSchema } from './shared';

export const placementSchema = v.pipe(
  documentSchema('placement', 1, {
    source: v.strictObject({
      /** The user's own footage; the one absolute path a document may hold. */
      media: v.pipe(v.string(), v.minLength(1)),
      transcript: RelPath,
      fps: v.pipe(v.string(), v.regex(/^[1-9]\d*(\/[1-9]\d*)?$/)),
      durationSec: v.pipe(v.number(), v.minValue(0)),
    }),
    aspect: Aspect,
    mode: v.picklist(['alpha', 'key', 'broll-only']),
    items: v.array(
      v.strictObject({
        id: v.pipe(v.string(), v.regex(/^p\d{2,}$/)),
        at: v.pipe(v.number(), v.minValue(0)),
        durSec: v.pipe(v.number(), v.minValue(0), v.check((value) => value > 0, 'greater than 0')),
        move: Id,
        version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/)),
        layer: v.picklist(['overlay', 'broll']),
        vars: plainRecord(v.unknown()),
        /** Verbatim transcript words the move answers. */
        say: v.pipe(v.string(), v.minLength(1)),
        reason: v.pipe(v.string(), v.minLength(1)),
      }),
    ),
  }),
  v.check((doc) => new Set(doc.items.map((item) => item.id)).size === doc.items.length, 'placement ids are unique'),
);

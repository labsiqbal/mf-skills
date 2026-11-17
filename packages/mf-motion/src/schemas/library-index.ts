// The user library index (<data home>/library/index.json).
import * as v from 'valibot';
import { Id, IsoTime, RelPath, documentSchema } from './shared';

export const libraryIndexSchema = v.pipe(
  documentSchema('library-index', 1, {
    entries: v.array(
      v.strictObject({
        type: v.picklist(['move', 'theme']),
        id: Id,
        version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/)),
        path: RelPath,
        sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
        /** Path to the PASS verdict. */
        verdict: v.pipe(v.string(), v.minLength(1)),
        addedAt: IsoTime,
      }),
    ),
  }),
  v.check(
    (doc) => new Set(doc.entries.map((entry) => `${entry.type}:${entry.id}`)).size === doc.entries.length,
    'one entry per type and id',
  ),
);

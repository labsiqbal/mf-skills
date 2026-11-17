// The judge packet manifest (rounds/<n>/packet/packet.json).
import * as v from 'valibot';
import { Aspect, Id, Profile, RelPath, documentSchema } from './shared';

const sha256 = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

export const Unit = v.strictObject({
  type: v.picklist(['film', 'move', 'theme']),
  id: Id,
  version: v.nullable(v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+$/))),
});

export const judgePacketSchema = documentSchema('judge-packet', 1, {
  unit: Unit,
  profile: Profile,
  aspect: Aspect,
  mode: v.picklist(['full', 'alpha', 'key']),
  target: v.picklist([8, 9]),
  rubricVersion: v.pipe(v.string(), v.minLength(1)),
  /** The lab fills it; runtime packets leave both null. */
  builder: v.strictObject({ provider: v.nullable(v.string()), modelId: v.nullable(v.string()) }),
  files: v.array(
    v.strictObject({
      role: v.pipe(v.string(), v.minLength(1)),
      path: RelPath,
      sha256,
      bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
  ),
  metrics: v.strictObject({ path: RelPath, sha256 }),
  /** sha256 over the canonical JSON of everything above except hash. */
  hash: sha256,
});

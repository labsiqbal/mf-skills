import { KINDS, isKind, jsonSchemaOf } from '../../schemas/index';
import { MfmError } from '../errors';
import { defineCommand } from '../registry';

export const schemaCommand = defineCommand({
  name: 'schema',
  summary: 'Print the JSON Schema (draft 2020-12) of a document kind.',
  positionals: [{ name: 'kind', description: `one of ${KINDS.join(', ')}`, required: true }],
  flags: {},
  dataSchema: { type: 'object', description: 'a draft 2020-12 JSON Schema' },
  handler({ args }) {
    const kind = String(args.kind);
    if (!isKind(kind)) {
      throw new MfmError('USAGE', { argument: 'kind', value: kind, allowed: KINDS }, {
        message: `Unknown schema kind "${kind}".`,
        hint: `Kinds: ${KINDS.join(', ')}.`,
      });
    }
    return { data: jsonSchemaOf(kind) };
  },
  human: (data) => JSON.stringify(data, null, 2).split('\n'),
});

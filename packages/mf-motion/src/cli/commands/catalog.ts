import { readCatalogue } from '../../library/catalogue';
import { allMoves } from '../../library/registry';
import { MAX_CATALOGUE_RESULTS, searchCatalogue } from '../../library/search';
import { CATEGORIES } from '../../schemas/move-meta';
import { MfmError } from '../errors';
import { defineCommand } from '../registry';

export const catalogCommand = defineCommand({
  name: 'catalog',
  summary: 'Read the move catalogue index or one category.',
  positionals: [{ name: 'category', description: 'move category' }],
  flags: {
    use: { type: 'string', enum: ['overlay', 'broll'], description: 'filter by how a move is used' },
    aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'filter by frame aspect' },
  },
  dataSchema: {
    type: 'object',
    required: ['text', 'tokens'],
    properties: { text: { type: 'string' }, tokens: { type: 'integer' } },
  },
  handler({ args, flags }) {
    const category = CATEGORIES.find((value) => value === args.category);
    if (args.category && !category) throw new MfmError('USAGE', { category: args.category, choices: CATEGORIES }, { message: `Unknown catalogue category: ${args.category}.` });
    const { entries, warnings } = allMoves();
    const data = readCatalogue(entries, {
      ...(category && { category }),
      ...(flags.use && { use: flags.use }),
      ...(flags.aspect && { aspect: flags.aspect }),
    });
    return { data, warnings };
  },
  human: ({ text }) => text.trimEnd().split('\n'),
});

export const catalogSearchCommand = defineCommand({
  name: 'catalog search',
  summary: 'Find moves by what the speaker says.',
  positionals: [{ name: 'words', description: 'words to look for', required: true, variadic: true }],
  flags: { limit: { type: 'integer', default: MAX_CATALOGUE_RESULTS, description: 'maximum matches (1-8)' } },
  dataSchema: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'category', 'say', 'score'],
          properties: { id: { type: 'string' }, category: { type: 'string' }, say: { type: 'array', items: { type: 'string' } }, score: { type: 'number' } },
        },
      },
    },
  },
  handler({ args, flags }) {
    if (flags.limit < 1 || flags.limit > MAX_CATALOGUE_RESULTS) throw new MfmError('USAGE', { limit: flags.limit }, { message: 'The search limit must be between 1 and 8.' });
    const words = Array.isArray(args.words) ? args.words.join(' ') : String(args.words ?? '');
    const { entries, warnings } = allMoves();
    return { data: { results: searchCatalogue(entries.map(({ meta }) => meta), words, flags.limit) }, warnings };
  },
  human: ({ results }) => results.map(({ id, category, say }) => `- ${id} (${category}) | ${say.slice(0, 2).join(', ')}`),
});

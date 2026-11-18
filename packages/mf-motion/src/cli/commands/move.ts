// Move commands. move info: a move's meta, variables schema and demo examples
// (MFM-041); move render: resolve, build and lint a move (MFM-041), then render
// the master and encode the formats (MFM-042).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureEngine } from '../../engine/index';
import type { AspectKey } from '../../kit/numbers';
import type { MoveMode } from '../../kit/build/move';
import { varsJsonSchema } from '../../library/contract';
import { allMoves, findMove } from '../../library/registry';
import { buildMove } from '../../moves/build';
import { dataHome } from '../../paths/index';
import { MfmError } from '../errors';
import { defineCommand } from '../registry';

const ASPECTS = ['16:9', '9:16', '1:1'] as const;
const MODES = ['full', 'alpha', 'key'] as const;

export const moveInfoCommand = defineCommand({
  name: 'move info',
  summary: "Show one move: its meta, the JSON Schema of its variables and its examples for the demo brands.",
  positionals: [{ name: 'id', description: 'move id', required: true }],
  flags: {},
  dataSchema: {
    type: 'object',
    required: ['meta', 'varsSchema', 'examples'],
    properties: { meta: { type: 'object' }, varsSchema: { type: 'object' }, examples: { type: 'object' } },
  },
  handler({ args }) {
    const { warnings } = allMoves();
    const { meta } = findMove(String(args.id));
    return { data: { meta, varsSchema: varsJsonSchema(meta), examples: meta.examples }, warnings };
  },
});

/** Variables from --vars (JSON) or --vars-file (a JSON file); null when neither is given. */
function readVars(flags: { vars?: string; 'vars-file'?: string }, cwd: string): Record<string, unknown> | null {
  if (flags.vars !== undefined && flags['vars-file'] !== undefined) throw new MfmError('USAGE', { flags: ['--vars', '--vars-file'] }, { message: 'Give --vars or --vars-file, not both.' });
  let text: string;
  let source: string;
  if (flags.vars !== undefined) {
    text = flags.vars;
    source = '--vars';
  } else if (flags['vars-file'] !== undefined) {
    const file = path.resolve(cwd, flags['vars-file']);
    if (!existsSync(file)) throw new MfmError('USAGE', { flag: '--vars-file', file }, { message: `${file} does not exist.` });
    text = readFileSync(file, 'utf8');
    source = file;
  } else return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MfmError('VARS_INVALID', { source }, { message: `The variables in ${source} are not valid JSON.` });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MfmError('VARS_INVALID', { source }, { message: `The variables in ${source} must be a JSON object.` });
  return parsed as Record<string, unknown>;
}

export const moveRenderCommand = defineCommand({
  name: 'move render',
  summary: 'Build a move for a brand, aspect and mode into <out>/build/ (vars inlined) and lint it.',
  positionals: [{ name: 'id', description: 'move id', required: true }],
  flags: {
    brand: { type: 'string', required: true, value: '<id>', description: 'brand library id, or demo:tessarine, demo:mossmallow or demo:quillfen' },
    aspect: { type: 'string', required: true, enum: ASPECTS, value: '<aspect>', description: '16:9, 9:16 or 1:1' },
    mode: { type: 'string', required: true, enum: MODES, value: '<mode>', description: 'full (opaque), alpha (transparent) or key (over the key colour)' },
    vars: { type: 'string', value: '<json>', description: 'move variables as a JSON object' },
    'vars-file': { type: 'string', value: '<path>', description: 'move variables from a JSON file' },
    duration: { type: 'number', value: '<sec>', description: "length in seconds within the move's range (default its default length)" },
    fps: { type: 'string', value: '<rate>', description: 'frame rate (default 30)' },
    out: { type: 'string', value: '<dir>', description: 'output folder (default ./mf-motion-out/<move>-<aspect>-<mode>/)' },
  },
  dataSchema: {
    type: 'object',
    required: ['master', 'outputs', 'keyColor', 'verdict', 'build'],
    properties: {
      master: { type: ['string', 'null'] },
      outputs: { type: 'array', items: { type: 'object', required: ['format', 'path', 'bytes'], properties: { format: { type: 'string' }, path: { type: 'string' }, bytes: { type: 'integer' } } } },
      keyColor: { type: ['string', 'null'] },
      verdict: { type: ['string', 'null'] },
      build: { type: 'string' },
      lintWarnings: { type: 'array', items: { type: 'object' } },
    },
  },
  async handler({ args, flags, cwd, env, global, log }) {
    const id = String(args.id);
    const { warnings } = allMoves();
    findMove(id);
    const vars = readVars(flags, cwd);
    const aspect = flags.aspect as AspectKey;
    const mode = flags.mode as MoveMode;
    // Folder names keep to characters every file system accepts (9:16 becomes 9x16).
    const out = flags.out ? path.resolve(cwd, flags.out) : path.resolve(cwd, 'mf-motion-out', `${id}-${aspect.replace(':', 'x')}-${mode}`);
    const engine = await ensureEngine(undefined, { env, onProgress: (message) => log.progress(message) });
    const result = await buildMove({
      id,
      brand: flags.brand,
      aspect,
      mode,
      vars,
      ...(flags.duration !== undefined ? { durationSec: flags.duration } : {}),
      ...(flags.fps !== undefined ? { fps: flags.fps } : {}),
      out,
      home: dataHome({ flag: global.home, env, cwd }),
      engine,
    });
    return {
      data: { master: null, outputs: [], keyColor: result.keyColor, verdict: null, build: result.build, lintWarnings: result.lint.warnings },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
});

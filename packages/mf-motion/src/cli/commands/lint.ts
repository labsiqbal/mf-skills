import path from 'node:path';
import { lint } from '../../lint/index';
import { defineCommand } from '../registry';

const FINDING = {
  type: 'object',
  required: ['code', 'file', 'line', 'col', 'message', 'snippet'],
  properties: {
    code: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'integer' },
    col: { type: 'integer' },
    message: { type: 'string' },
    snippet: { type: 'string' },
  },
} as const;

export const lintCommand = defineCommand({
  name: 'lint',
  summary: 'Check a build folder for network use, nondeterminism, text-line, copy and structure problems.',
  positionals: [{ name: 'build-dir', description: 'the HyperFrames build folder (holds index.html)', required: true }],
  flags: {
    profile: { type: 'string', enum: ['film', 'broll', 'overlay-alpha', 'overlay-key'], description: 'check profile of the piece' },
    round: { type: 'string', value: '<dir>', description: 'round folder to write lint.json into' },
  },
  dataSchema: {
    type: 'object',
    required: ['errors', 'warnings'],
    properties: { errors: { type: 'array', items: FINDING }, warnings: { type: 'array', items: FINDING } },
  },
  handler({ args, flags, cwd }) {
    const buildDir = path.resolve(cwd, String(args['build-dir']));
    const result = lint(buildDir, {
      ...(flags.profile ? { profile: flags.profile } : {}),
      ...(flags.round ? { round: path.resolve(cwd, flags.round) } : {}),
    });
    return { data: result, exitCode: result.errors.length > 0 ? 1 : 0 };
  },
  human: (data) => [
    ...[...data.errors, ...data.warnings].map((f) => `${f.file}:${f.line}:${f.col} ${f.code} ${f.message}`),
    `${data.errors.length} error(s), ${data.warnings.length} warning(s)`,
  ],
});

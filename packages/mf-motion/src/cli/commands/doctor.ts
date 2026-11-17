import { runDoctor } from '../../doctor/index';
import { defineCommand } from '../registry';

const CHECK_SCHEMA = {
  type: 'object',
  required: ['id', 'status', 'found', 'need', 'fix'],
  properties: {
    id: { type: 'string' },
    status: { enum: ['ok', 'missing', 'optional', 'warn'] },
    found: { type: ['string', 'null'] },
    need: { type: 'string' },
    fix: { type: ['string', 'null'] },
  },
} as const;

export const doctorCommand = defineCommand({
  name: 'doctor',
  summary: 'Check Node, FFmpeg, the engine, Chrome, disk and fonts; with --fix install the CLI copy, engine and Chrome into the cache.',
  flags: {
    fix: { type: 'boolean', description: 'install the pinned CLI copy, the engine and Chrome into the cache (never system packages)' },
    fonts: { type: 'list', enum: ['cjk', 'emoji'], value: 'cjk,emoji', description: 'with --fix, also fetch these optional fonts' },
    transcribe: { type: 'boolean', description: 'with --fix, also prefetch the transcription model' },
    offline: { type: 'boolean', description: 'report install state only; touch no network' },
    'cli-tarball': { type: 'string', value: '<tgz>', description: 'with --fix, install the CLI copy from this local npm pack tarball instead of the registry' },
  },
  network: true,
  dataSchema: {
    type: 'object',
    required: ['ok', 'launcher', 'checks', 'disk', 'engine', 'chrome'],
    properties: {
      ok: { type: 'boolean' },
      launcher: { type: 'array', items: { type: 'string' } },
      checks: { type: 'array', items: CHECK_SCHEMA },
      disk: { type: 'object', required: ['freeGb', 'path'], properties: { freeGb: { type: 'number' }, path: { type: 'string' } } },
      engine: { type: 'object', required: ['version', 'path'], properties: { version: { type: ['string', 'null'] }, path: { type: ['string', 'null'] } } },
      chrome: { type: 'object', required: ['version', 'path'], properties: { version: { type: ['string', 'null'] }, path: { type: ['string', 'null'] } } },
    },
  },
  async handler({ flags, env, cwd, global, log }) {
    const data = await runDoctor({
      fix: flags.fix,
      fonts: flags.fonts as Array<'cjk' | 'emoji'>,
      transcribe: flags.transcribe,
      offline: flags.offline,
      ...(flags['cli-tarball'] !== undefined ? { cliTarball: flags['cli-tarball'] } : {}),
      env,
      cwd,
      ...(global.home !== undefined ? { home: global.home } : {}),
      onProgress: (message) => log.progress(message),
      onWarn: (message) => log.warn(message),
    });
    const fixable = data.checks.some((check) => check.status === 'missing' && check.fix?.startsWith('mf-motion doctor --fix'));
    return {
      data,
      exitCode: data.ok ? 0 : 1,
      next: data.ok ? [] : fixable && !flags.fix ? ['mf-motion doctor --fix --json'] : [],
    };
  },
  human: (data) => [
    ...data.checks.map((check) => `${check.status.padEnd(8)} ${check.id}${check.found ? `  ${check.found}` : ''}${check.fix ? `\n         fix: ${check.fix}` : ''}`),
    `launcher: ${data.launcher.join(' ')}`,
    data.ok ? 'doctor: everything required is in place' : 'doctor: some required pieces are missing',
  ],
});

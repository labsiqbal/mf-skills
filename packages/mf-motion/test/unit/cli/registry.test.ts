import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../src/cli/commands/index';
import { MfmError } from '../../../src/cli/errors';
import { type AnyCommand, defineCommand, parseCommandLine } from '../../../src/cli/registry';
import { runIn } from './harness';

const render = defineCommand({
  name: 'move render',
  summary: 'Render a move.',
  positionals: [{ name: 'id', description: 'move id', required: true }],
  flags: {
    brand: { type: 'string', required: true, value: '<id>', description: 'brand id' },
    aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9', description: 'aspect' },
    duration: { type: 'number', description: 'seconds' },
    seed: { type: 'integer', default: 1, description: 'seed' },
    formats: { type: 'list', enum: ['mp4', 'mov', 'webm'], description: 'formats' },
    set: { type: 'string', multiple: true, description: 'key=value' },
    gate: { type: 'boolean', description: 'run the gate' },
  },
  dataSchema: { type: 'object' },
  handler: ({ flags, args, log }) => {
    log.progress('rendering');
    log.debug('debug detail');
    return { data: { flags, args }, warnings: [{ code: 'FONT_LICENCE_UNKNOWN', message: 'font' }], next: ['mf-motion gate --json'] };
  },
});
const info = defineCommand({
  name: 'move info',
  summary: 'Describe a move.',
  positionals: [{ name: 'id', description: 'move id', required: true }],
  flags: {},
  dataSchema: { type: 'object' },
  handler: () => ({ data: {} }),
});
const search = defineCommand({
  name: 'catalog search',
  summary: 'Search.',
  positionals: [{ name: 'words', description: 'words', required: true, variadic: true }],
  flags: {},
  dataSchema: { type: 'object' },
  handler: ({ args }) => ({ data: args }),
});
const catalog = defineCommand({
  name: 'catalog',
  summary: 'Catalogue.',
  positionals: [{ name: 'category', description: 'category' }],
  flags: {},
  dataSchema: { type: 'object' },
  handler: ({ args }) => ({ data: args }),
});
const crash = defineCommand({
  name: 'crash',
  summary: 'Throws a plain error.',
  flags: {},
  dataSchema: {},
  handler: () => {
    throw new TypeError('boom');
  },
});
const refuse = defineCommand({
  name: 'refuse',
  summary: 'Throws an MfmError.',
  flags: {},
  dataSchema: {},
  handler: () => {
    throw new MfmError('LOCKED', { lock: 'x' }, { next: ['mf-motion status --json'] });
  },
});
const negative = defineCommand({
  name: 'negative',
  summary: 'Ran with a negative result.',
  flags: {},
  dataSchema: {},
  handler: () => ({ data: { errors: 2 }, exitCode: 1 }),
});

const commands: readonly AnyCommand[] = [...COMMANDS, render, info, search, catalog, crash, refuse, negative];

function usage(argv: string[]) {
  try {
    parseCommandLine(argv, commands);
  } catch (error) {
    expect(error).toBeInstanceOf(MfmError);
    return error as MfmError;
  }
  throw new Error(`expected a USAGE error for ${argv.join(' ')}`);
}

describe('parseCommandLine', () => {
  it('matches the longest command name and converts flag types', () => {
    const parsed = parseCommandLine(
      ['--json', 'move', 'render', 'title-lockup', '--brand', 'demo', '--duration', '2.5', '--formats', 'mp4,webm', '--set', 'a=1', '--set', 'b=2', '--gate'],
      commands,
    );
    expect(parsed.command?.name).toBe('move render');
    expect(parsed.global.json).toBe(true);
    expect(parsed.args).toEqual({ id: 'title-lockup' });
    expect(parsed.flags).toEqual({
      brand: 'demo',
      aspect: '16:9',
      duration: 2.5,
      seed: 1,
      formats: ['mp4', 'webm'],
      set: ['a=1', 'b=2'],
      gate: true,
    });
  });

  it('prefers a subcommand over a positional and collects variadic words', () => {
    expect(parseCommandLine(['catalog', 'search', 'logo', 'reveal'], commands).args).toEqual({ words: ['logo', 'reveal'] });
    expect(parseCommandLine(['catalog', 'data'], commands).args).toEqual({ category: 'data' });
    expect(parseCommandLine(['catalog'], commands).args).toEqual({ category: undefined });
  });

  it('reads global value flags placed before the command', () => {
    const parsed = parseCommandLine(['--project', './launch', '--home', '/tmp/h', 'version'], commands);
    expect(parsed.command?.name).toBe('version');
    expect(parsed.global).toMatchObject({ project: './launch', home: '/tmp/h' });
  });

  it('rejects an unknown flag with a hint naming it', () => {
    const error = usage(['move', 'render', 'x', '--brand', 'b', '--colour', 'red']);
    expect(error.code).toBe('USAGE');
    expect(error.exitCode).toBe(2);
    expect(error.details).toEqual({ flag: '--colour' });
    expect(error.hint).toContain('`--colour`');
  });

  it('rejects a missing required flag, naming the flag', () => {
    const error = usage(['move', 'render', 'x']);
    expect(error.message).toContain('--brand');
    expect(error.hint).toContain('--brand <id>');
    expect(error.details).toEqual({ flag: '--brand' });
  });

  it('rejects invalid values', () => {
    expect(usage(['move', 'render', 'x', '--brand', 'b', '--aspect', '4:5']).details).toMatchObject({ flag: '--aspect', value: '4:5' });
    expect(usage(['move', 'render', 'x', '--brand', 'b', '--duration', 'long']).details).toMatchObject({ flag: '--duration' });
    expect(usage(['move', 'render', 'x', '--brand', 'b', '--seed', '1.5']).details).toMatchObject({ flag: '--seed' });
    expect(usage(['move', 'render', 'x', '--brand', 'b', '--formats', 'mp4,gif']).details).toMatchObject({ value: 'gif' });
    expect(usage(['move', 'render', 'x', '--brand']).details).toMatchObject({ flag: '--brand' });
  });

  it('rejects missing and extra positionals', () => {
    expect(usage(['move', 'info']).details).toEqual({ argument: 'id' });
    expect(usage(['move', 'info', 'a', 'b']).details).toEqual({ argument: 'b' });
    expect(usage(['catalog', 'search']).details).toEqual({ argument: 'words' });
  });

  it('rejects unknown commands and bare groups with the right hint', () => {
    expect(usage(['vresion']).hint).toContain('Did you mean `version`?');
    const group = usage(['move']);
    expect(group.hint).toContain('render');
    expect(group.hint).toContain('info');
    expect(usage([]).message).toBe('No command given.');
  });

  it('refuses --quiet with --verbose', () => {
    expect(usage(['version', '--quiet', '--verbose']).code).toBe('USAGE');
  });
});

describe('runCli', () => {
  it('prints exactly one JSON envelope on stdout and progress on stderr', async () => {
    const result = await runIn(['move', 'render', 'x', '--brand', 'b', '--json', '--verbose'], commands);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(result.stdout);
    expect(Object.keys(envelope)).toEqual(['ok', 'command', 'cli', 'schemaVersion', 'data', 'warnings', 'next']);
    expect(envelope).toMatchObject({
      ok: true,
      command: 'move render',
      cli: '1.0.0',
      schemaVersion: 1,
      warnings: [{ code: 'FONT_LICENCE_UNKNOWN', message: 'font' }],
      next: ['mf-motion gate --json'],
    });
    expect(result.stderr).toContain('rendering');
    expect(result.stderr).toContain('debug detail');
  });

  it('hides progress with --quiet and debug without --verbose', async () => {
    const quiet = await runIn(['move', 'render', 'x', '--brand', 'b', '--json', '--quiet'], commands);
    expect(quiet.stderr).toBe('');
    const normal = await runIn(['move', 'render', 'x', '--brand', 'b', '--json'], commands);
    expect(normal.stderr).toBe('rendering\n');
  });

  it('renders a failure envelope with the error code, hint, details and next', async () => {
    const result = await runIn(['refuse', '--json'], commands);
    expect(result.code).toBe(4);
    const envelope = JSON.parse(result.stdout);
    expect(Object.keys(envelope)).toEqual(['ok', 'command', 'cli', 'schemaVersion', 'error', 'warnings', 'next']);
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toEqual({
      code: 'LOCKED',
      message: 'Another mf-motion process holds the lock for this resource.',
      hint: 'Wait for the other command to finish, then run this one again.',
      details: { lock: 'x' },
    });
    expect(envelope.next).toEqual(['mf-motion status --json']);
  });

  it('turns a thrown non-MfmError into INTERNAL exit 5, with a stack only under --verbose', async () => {
    const plain = await runIn(['crash', '--json'], commands);
    expect(plain.code).toBe(5);
    const envelope = JSON.parse(plain.stdout);
    expect(envelope.error.code).toBe('INTERNAL');
    expect(envelope.error.details).toEqual({ cause: 'boom' });

    const verbose = await runIn(['crash', '--json', '--verbose'], commands);
    expect(verbose.code).toBe(5);
    expect(JSON.parse(verbose.stdout).error.details.stack).toContain('TypeError: boom');

    const human = await runIn(['crash'], commands);
    expect(human.stderr).toContain('error INTERNAL');
    expect(human.stderr).not.toContain('TypeError');
    const humanVerbose = await runIn(['crash', '--verbose'], commands);
    expect(humanVerbose.stderr).toContain('TypeError: boom');
  });

  it('keeps ok true and exits 1 for a negative result', async () => {
    const result = await runIn(['negative', '--json'], commands);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { errors: 2 } });
  });

  it('renders usage errors as JSON when --json is present even if parsing fails', async () => {
    const result = await runIn(['version', '--json', '--nope'], commands);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error).toMatchObject({ code: 'USAGE', details: { flag: '--nope' } });
  });

  it('prints human output with data lines, warnings on stderr and next commands', async () => {
    const result = await runIn(['move', 'render', 'x', '--brand', 'b'], commands);
    expect(result.stdout).toContain('flags.brand: b');
    expect(result.stdout).toContain('next:\n  mf-motion gate --json');
    expect(result.stderr).toContain('warning FONT_LICENCE_UNKNOWN: font');
    expect(result.stdout).not.toContain('\u001b[');
  });

  it('prints generated help and the JSON flag schema', async () => {
    const help = await runIn(['move', 'render', '--help'], commands);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: mf-motion move render <id> --brand <id>');
    expect(help.stdout).toContain('--aspect 16:9|9:16|1:1');
    const schema = await runIn(['move', 'render', '--json', '--help'], commands);
    const data = JSON.parse(schema.stdout).data;
    expect(data.flags.required).toEqual(['brand']);
    expect(data.flags.properties.aspect).toMatchObject({ type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' });
    expect(data.flags.properties.formats).toMatchObject({ type: 'array', items: { type: 'string', enum: ['mp4', 'mov', 'webm'] } });
    expect(data.flags.properties.set).toMatchObject({ type: 'array', 'x-repeatable': true });
    expect(data.positionals).toEqual([{ name: 'id', description: 'move id', required: true, variadic: false }]);
    const top = await runIn(['--json', '--help'], commands);
    expect(JSON.parse(top.stdout).data.commands.map((c: { name: string }) => c.name)).toContain('move render');
  });
});

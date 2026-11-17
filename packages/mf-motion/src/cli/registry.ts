// Typed command registry: one entry per command, parsed with node:util
// parseArgs, help generated from the entries, and one top-level wrapper that
// renders the envelope and returns the exit code. Agent-flow tests import
// `parseCommandLine` to prove every documented command line parses.
import { parseArgs } from 'node:util';
import { version as CLI_VERSION } from '../../package.json';
import { EXIT, type ErrorCode, type ExitCode, MfmError, isMfmError } from './errors';
import {
  type Envelope,
  type Logger,
  type Sink,
  type Warning,
  createLogger,
  failureEnvelope,
  renderHuman,
  renderJson,
  successEnvelope,
  useColor,
} from './output';

export { CLI_VERSION };

/** A JSON Schema document (draft 2020-12 subset), used for help and data shapes. */
export type JsonSchema = { [key: string]: unknown };

export type FlagType = 'string' | 'boolean' | 'number' | 'integer' | 'list';

export interface FlagSpec {
  type: FlagType;
  description: string;
  required?: boolean;
  /** Allowed values; for `list`, allowed items. */
  enum?: readonly string[];
  /** Repeatable flag (`--set a=1 --set b=2`); values collect into an array. */
  multiple?: boolean;
  short?: string;
  default?: string | number | boolean | readonly string[];
  /** Placeholder shown in usage, for example `<dir>`. */
  value?: string;
}

export type FlagMap = Record<string, FlagSpec>;

export interface PositionalSpec {
  name: string;
  description: string;
  required?: boolean;
  /** Collects every remaining positional; only the last positional may be variadic. */
  variadic?: boolean;
}

type ScalarOf<S extends FlagSpec> = S['type'] extends 'boolean'
  ? boolean
  : S['type'] extends 'number' | 'integer'
    ? number
    : S['type'] extends 'list'
      ? string[]
      : S['enum'] extends readonly string[]
        ? S['enum'][number]
        : string;

type ValueOf<S extends FlagSpec> = S['multiple'] extends true ? Array<ScalarOf<S>> : ScalarOf<S>;

type Present<S extends FlagSpec> = S['required'] extends true
  ? true
  : S['type'] extends 'boolean' | 'list'
    ? true
    : S['multiple'] extends true
      ? true
      : S extends { default: unknown }
        ? true
        : false;

/** Handler-side view of parsed flags: always-present flags are required properties. */
export type FlagValues<F extends FlagMap> = {
  [K in keyof F as Present<F[K]> extends true ? K : never]: ValueOf<F[K]>;
} & {
  [K in keyof F as Present<F[K]> extends true ? never : K]?: ValueOf<F[K]>;
};

export interface GlobalOptions {
  json: boolean;
  project?: string;
  home?: string;
  quiet: boolean;
  verbose: boolean;
  color: boolean;
}

export interface CommandContext<F extends FlagMap> {
  flags: FlagValues<F>;
  args: Record<string, string | string[] | undefined>;
  global: GlobalOptions;
  env: NodeJS.ProcessEnv;
  cwd: string;
  log: Logger;
  cli: string;
}

export interface HandlerResult<D = unknown> {
  data: D;
  warnings?: Warning[];
  next?: string[];
  /** 1 when the command ran but its result is negative (lint errors, gate FAIL). */
  exitCode?: 0 | 1;
}

export interface CommandSpec<F extends FlagMap = FlagMap, D = unknown> {
  /** Full command name, words separated by single spaces, for example `brand capture`. */
  name: string;
  summary: string;
  positionals?: readonly PositionalSpec[];
  flags: F;
  /** JSON Schema of `data` on success. */
  dataSchema: JsonSchema;
  /** Needs the network by nature; stated in help. */
  network?: boolean;
  handler: (context: CommandContext<F>) => Promise<HandlerResult<D>> | HandlerResult<D>;
  /** Optional human rendering of `data`; default is `key: value` lines. */
  human?: (data: D) => string[];
}

/** Registry entry with its flag types erased, so commands of any shape share one list. */
export interface AnyCommand {
  name: string;
  summary: string;
  positionals?: readonly PositionalSpec[];
  flags: FlagMap;
  dataSchema: JsonSchema;
  network?: boolean;
  handler: (context: CommandContext<FlagMap>) => Promise<HandlerResult> | HandlerResult;
  human?: (data: unknown) => string[];
}

/** Declare a command with typed flags; the result goes into the registry list. */
export function defineCommand<const F extends FlagMap, D>(spec: CommandSpec<F, D>): AnyCommand {
  return spec as unknown as AnyCommand;
}

export const GLOBAL_FLAGS = {
  json: { type: 'boolean', description: 'Machine output: exactly one JSON document on stdout; progress goes to stderr.' },
  project: { type: 'string', value: '<dir>', description: 'Project root; default: the nearest project.json walking up from the current folder.' },
  home: { type: 'string', value: '<dir>', description: 'Data home for this call (same as MF_MOTION_HOME).' },
  quiet: { type: 'boolean', description: 'Only errors on stderr.' },
  verbose: { type: 'boolean', description: 'Extra detail on stderr, including stack traces.' },
  'no-color': { type: 'boolean', description: 'Plain stderr (also when NO_COLOR is set or stderr is not a terminal).' },
  help: { type: 'boolean', short: 'h', description: 'Usage for the command; with --json, its flag schema.' },
  version: { type: 'boolean', description: 'Print the CLI version, engine pins and schema versions.' },
} as const satisfies FlagMap;

const GLOBAL_NAMES = new Set(Object.keys(GLOBAL_FLAGS));
const GLOBAL_VALUE_FLAGS = new Set(
  Object.entries(GLOBAL_FLAGS)
    .filter(([, spec]) => spec.type !== 'boolean')
    .map(([name]) => name),
);

export interface ParsedCommandLine {
  /** null for top-level --help / --version handling without a command. */
  command: AnyCommand | null;
  flags: Record<string, unknown>;
  args: Record<string, string | string[] | undefined>;
  positionals: string[];
  global: Omit<GlobalOptions, 'color'> & { noColor: boolean; help: boolean; version: boolean };
}

function usageError(message: string, hint: string, details: Record<string, unknown> = {}): MfmError {
  return new MfmError('USAGE', details, { message, hint });
}

function flagHint(command: AnyCommand | null): string {
  return command
    ? `Run \`mf-motion ${command.name} --help\` for its flags.`
    : 'Run `mf-motion --help` for the command list.';
}

/** Edit distance counting a swap of two neighbouring letters as one edit. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => d[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = d[i];
      if (row) row[j] = best;
    }
  }
  return at(a.length, b.length);
}

function suggest(word: string, candidates: string[]): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const name of candidates) {
    const distance = editDistance(word, name);
    if (distance <= Math.max(1, Math.floor(name.length / 3)) && (!best || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name;
}

/** Split leading global flags and the command words from the rest of argv. */
function locateCommand(argv: readonly string[], commands: readonly AnyCommand[]) {
  const words: string[] = [];
  const wordIndexes: number[] = [];
  let index = 0;
  // Global flags may come before the command words.
  while (index < argv.length) {
    const token = argv[index] ?? '';
    if (token === '--') break;
    if (token.startsWith('-')) {
      const name = token.replace(/^--?/, '').split('=')[0] ?? '';
      if (GLOBAL_VALUE_FLAGS.has(name) && !token.includes('=')) index += 1;
      index += 1;
      continue;
    }
    break;
  }
  while (index < argv.length) {
    const token = argv[index] ?? '';
    if (token.startsWith('-')) break;
    words.push(token);
    wordIndexes.push(index);
    index += 1;
  }
  let match: AnyCommand | null = null;
  let matchedWords = 0;
  for (const command of commands) {
    const parts = command.name.split(' ');
    if (parts.length > words.length || parts.length <= matchedWords) continue;
    if (parts.every((part, i) => part === words[i])) {
      match = command;
      matchedWords = parts.length;
    }
  }
  const consumed = new Set(wordIndexes.slice(0, matchedWords));
  const rest = argv.filter((_, i) => !consumed.has(i));
  return { match, words, rest };
}

function toParseArgsOptions(flags: FlagMap) {
  const options: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {};
  for (const [name, spec] of Object.entries(flags)) {
    options[name] = {
      type: spec.type === 'boolean' ? 'boolean' : 'string',
      ...(spec.short ? { short: spec.short } : {}),
      ...(spec.multiple ? { multiple: true } : {}),
    };
  }
  return options;
}

function convertFlag(name: string, spec: FlagSpec, raw: unknown, command: AnyCommand): unknown {
  const one = (value: string): unknown => {
    if (spec.type === 'number' || spec.type === 'integer') {
      const number = Number(value);
      const valid = value.trim() !== '' && Number.isFinite(number) && (spec.type === 'number' || Number.isInteger(number));
      if (!valid) {
        throw usageError(
          `--${name} needs ${spec.type === 'integer' ? 'a whole number' : 'a number'}, got "${value}".`,
          flagHint(command),
          { flag: `--${name}`, value },
        );
      }
      return number;
    }
    if (spec.type === 'list') {
      const items = value.split(',').map((item) => item.trim()).filter((item) => item !== '');
      if (spec.enum) {
        const bad = items.find((item) => !spec.enum?.includes(item));
        if (bad !== undefined) {
          throw usageError(`--${name} does not accept "${bad}".`, `Allowed values: ${spec.enum.join(', ')}.`, {
            flag: `--${name}`,
            value: bad,
            allowed: [...spec.enum],
          });
        }
      }
      return items;
    }
    if (spec.enum && !spec.enum.includes(value)) {
      throw usageError(`--${name} does not accept "${value}".`, `Allowed values: ${spec.enum.join(', ')}.`, {
        flag: `--${name}`,
        value,
        allowed: [...spec.enum],
      });
    }
    return value;
  };
  if (spec.type === 'boolean') return raw === true;
  if (spec.multiple) return Array.isArray(raw) ? raw.map((value) => one(String(value))) : [];
  return one(String(raw));
}

function defaultFor(spec: FlagSpec): unknown {
  if (spec.default !== undefined) return Array.isArray(spec.default) ? [...spec.default] : spec.default;
  if (spec.type === 'boolean') return false;
  if (spec.type === 'list' || spec.multiple) return [];
  return undefined;
}

function parseError(error: unknown, command: AnyCommand | null): MfmError {
  const code = (error as { code?: string }).code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  const flag = message.match(/'(-[^' ]+)/)?.[1];
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && flag) {
    const where = command ? ` for \`${command.name}\`` : '';
    const names = command ? [...Object.keys(command.flags), ...GLOBAL_NAMES] : [...GLOBAL_NAMES];
    const close = suggest(flag.replace(/^--?/, ''), names);
    const hint = `\`${flag}\` is not a flag${where}.${close ? ` Did you mean \`--${close}\`?` : ''} ${flagHint(command)}`;
    return usageError(`Unknown flag ${flag}${where}.`, hint, { flag });
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && flag) {
    return usageError(`Flag ${flag} has a missing or invalid value.`, `Give \`${flag}\` a value. ${flagHint(command)}`, { flag });
  }
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
    return usageError(message, flagHint(command));
  }
  return usageError(message, flagHint(command));
}

/** Parse argv into a command and typed values; throws USAGE MfmErrors only. */
export function parseCommandLine(argv: readonly string[], commands: readonly AnyCommand[]): ParsedCommandLine {
  const { match, words, rest } = locateCommand(argv, commands);
  const flagSpecs: FlagMap = { ...(match?.flags ?? {}), ...GLOBAL_FLAGS };
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...rest],
      options: toParseArgsOptions(flagSpecs),
      strict: true,
      allowPositionals: true,
    }) as { values: Record<string, unknown>; positionals: string[] };
  } catch (error) {
    throw parseError(error, match);
  }
  const values = parsed.values;
  const global = {
    json: values.json === true,
    quiet: values.quiet === true,
    verbose: values.verbose === true,
    noColor: values['no-color'] === true,
    help: values.help === true,
    version: values.version === true,
    ...(typeof values.project === 'string' ? { project: values.project } : {}),
    ...(typeof values.home === 'string' ? { home: values.home } : {}),
  };
  if (global.quiet && global.verbose) {
    throw usageError('--quiet and --verbose cannot be used together.', 'Pick one of them.', { flag: '--quiet' });
  }
  if (!match) {
    if (global.help || global.version) {
      if (words.length === 0) return { command: null, flags: {}, args: {}, positionals: [], global };
    }
    if (words.length === 0) {
      throw usageError('No command given.', 'Run `mf-motion --help` for the command list.');
    }
    const first = words[0] ?? '';
    const groupCommands = commands.filter((command) => command.name.split(' ')[0] === first);
    if (groupCommands.length > 0) {
      const subcommands = groupCommands.map((command) => command.name.split(' ').slice(1).join(' ')).filter(Boolean);
      throw usageError(
        `\`${words.slice(0, 2).join(' ')}\` is not a command.`,
        `\`${first}\` takes one of: ${subcommands.join(', ')}. Run \`mf-motion --help\` for the command list.`,
        { command: words.slice(0, 2).join(' ') },
      );
    }
    const close = suggest(first, [...new Set(commands.map((command) => command.name.split(' ')[0] ?? ''))]);
    throw usageError(
      `Unknown command \`${first}\`.`,
      `${close ? `Did you mean \`${close}\`? ` : ''}Run \`mf-motion --help\` for the command list.`,
      { command: first },
    );
  }
  const flags: Record<string, unknown> = {};
  if (!global.help) {
    for (const [name, spec] of Object.entries(match.flags)) {
      const raw = values[name];
      if (raw === undefined) {
        if (spec.required) {
          throw usageError(`\`${match.name}\` needs --${name}.`, `Add \`--${name} ${spec.value ?? '<value>'}\`. ${flagHint(match)}`, {
            flag: `--${name}`,
          });
        }
        const fallback = defaultFor(spec);
        if (fallback !== undefined) flags[name] = fallback;
        continue;
      }
      flags[name] = convertFlag(name, spec, raw, match);
    }
  }
  const positionals = parsed.positionals;
  const args: Record<string, string | string[] | undefined> = {};
  const specs = match.positionals ?? [];
  if (!global.help) {
    specs.forEach((spec, index) => {
      if (spec.variadic) {
        const restValues = positionals.slice(index);
        if (spec.required && restValues.length === 0) {
          throw usageError(`\`${match.name}\` needs <${spec.name}>.`, flagHint(match), { argument: spec.name });
        }
        args[spec.name] = restValues;
        return;
      }
      const value = positionals[index];
      if (value === undefined && spec.required) {
        throw usageError(`\`${match.name}\` needs <${spec.name}>.`, flagHint(match), { argument: spec.name });
      }
      args[spec.name] = value;
    });
    const variadic = specs.some((spec) => spec.variadic);
    if (!variadic && positionals.length > specs.length) {
      const extra = positionals[specs.length] ?? '';
      throw usageError(`Unexpected argument "${extra}" for \`${match.name}\`.`, flagHint(match), { argument: extra });
    }
  }
  return { command: match, flags, args, positionals, global };
}

function flagSchema(spec: FlagSpec): JsonSchema {
  const item: JsonSchema =
    spec.type === 'boolean'
      ? { type: 'boolean' }
      : spec.type === 'number'
        ? { type: 'number' }
        : spec.type === 'integer'
          ? { type: 'integer' }
          : { type: 'string', ...(spec.enum ? { enum: [...spec.enum] } : {}) };
  const base: JsonSchema =
    spec.type === 'list' || spec.multiple ? { type: 'array', items: item } : item;
  return {
    ...base,
    description: spec.description,
    ...(spec.default !== undefined ? { default: spec.default } : spec.type === 'boolean' ? { default: false } : {}),
    ...(spec.type === 'list' ? { 'x-format': 'comma-separated' } : {}),
    ...(spec.multiple ? { 'x-repeatable': true } : {}),
  };
}

/** JSON Schema of a flag set, as printed by `--json --help`. */
export function flagsJsonSchema(flags: FlagMap): JsonSchema {
  const required = Object.entries(flags)
    .filter(([, spec]) => spec.required)
    .map(([name]) => name);
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(flags).map(([name, spec]) => [name, flagSchema(spec)])),
    required,
    additionalProperties: false,
  };
}

function flagUsage(name: string, spec: FlagSpec): string {
  const value = spec.type === 'boolean' ? '' : ` ${spec.value ?? (spec.enum ? spec.enum.join('|') : `<${spec.type === 'list' ? 'a,b' : spec.type === 'string' ? 'value' : 'n'}>`)}`;
  const text = `--${name}${value}${spec.multiple ? '...' : ''}`;
  return spec.required ? text : `[${text}]`;
}

export function commandUsage(command: AnyCommand): string {
  const positionals = (command.positionals ?? []).map((spec) => {
    const text = `<${spec.name}${spec.variadic ? '...' : ''}>`;
    return spec.required ? text : `[${text}]`;
  });
  const flags = Object.entries(command.flags).map(([name, spec]) => flagUsage(name, spec));
  return ['mf-motion', command.name, ...positionals, ...flags].join(' ');
}

function flagLines(flags: FlagMap): string[] {
  const rows = Object.entries(flags).map(([name, spec]) => {
    const short = spec.short ? `-${spec.short}, ` : '';
    const extras = [
      spec.required ? 'required' : '',
      spec.enum ? `one of ${spec.enum.join(', ')}` : '',
      spec.default !== undefined ? `default ${String(spec.default)}` : '',
    ].filter(Boolean);
    return {
      left: `${short}${flagUsage(name, { ...spec, required: true })}`,
      right: `${spec.description}${extras.length ? ` (${extras.join('; ')})` : ''}`,
    };
  });
  const width = Math.max(0, ...rows.map((row) => row.left.length));
  return rows.map((row) => `  ${row.left.padEnd(width)}  ${row.right}`);
}

export function commandHelpText(command: AnyCommand): string {
  const lines = [`Usage: ${commandUsage(command)}`, '', command.summary];
  if (command.network) lines.push('', 'Needs the network.');
  if ((command.positionals ?? []).length > 0) {
    lines.push('', 'Arguments:');
    for (const spec of command.positionals ?? []) {
      lines.push(`  <${spec.name}>  ${spec.description}${spec.required ? ' (required)' : ''}`);
    }
  }
  if (Object.keys(command.flags).length > 0) lines.push('', 'Flags:', ...flagLines(command.flags));
  lines.push('', 'Global flags:', ...flagLines(GLOBAL_FLAGS));
  return `${lines.join('\n')}\n`;
}

export function topHelpText(commands: readonly AnyCommand[]): string {
  const width = Math.max(...commands.map((command) => command.name.length), 0);
  const lines = [
    'Usage: mf-motion <command> [arguments] [flags]',
    '',
    'Commands:',
    ...commands.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Global flags:',
    ...flagLines(GLOBAL_FLAGS),
    '',
    'Run `mf-motion <command> --help` for a command\'s flags.',
  ];
  return `${lines.join('\n')}\n`;
}

export function commandHelpData(command: AnyCommand) {
  return {
    command: command.name,
    summary: command.summary,
    usage: commandUsage(command),
    network: command.network === true,
    positionals: (command.positionals ?? []).map((spec) => ({
      name: spec.name,
      description: spec.description,
      required: spec.required === true,
      variadic: spec.variadic === true,
    })),
    flags: flagsJsonSchema(command.flags),
    globalFlags: flagsJsonSchema(GLOBAL_FLAGS),
    data: command.dataSchema,
  };
}

export function topHelpData(commands: readonly AnyCommand[]) {
  return {
    commands: commands.map((command) => ({ name: command.name, summary: command.summary, usage: commandUsage(command) })),
    globalFlags: flagsJsonSchema(GLOBAL_FLAGS),
  };
}

export interface CliIO {
  stdout: Sink;
  stderr: Sink;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

/** Best-effort read of output flags when parsing itself failed, so the error still renders as asked. */
function rawOutputFlags(argv: readonly string[]) {
  const before = argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv;
  return {
    json: before.includes('--json'),
    verbose: before.includes('--verbose'),
    noColor: before.includes('--no-color'),
  };
}

function guessCommandName(argv: readonly string[], commands: readonly AnyCommand[]): string {
  const { match, words } = locateCommand(argv, commands);
  return match?.name ?? words.slice(0, 2).join(' ');
}

/** Run one command line; never throws; returns the process exit code. */
export async function runCli(argv: readonly string[], io: CliIO, commands: readonly AnyCommand[]): Promise<ExitCode> {
  const raw = rawOutputFlags(argv);
  let commandName = guessCommandName(argv, commands);
  let json = raw.json;
  let verbose = raw.verbose;
  let color = useColor(raw.noColor, io.env, io.stderr);
  let human: ((data: unknown) => string[]) | undefined;
  let exitCode: ExitCode = EXIT.ok;
  let envelope: Envelope;
  try {
    const parsed = parseCommandLine(argv, commands);
    json = parsed.global.json;
    verbose = parsed.global.verbose;
    color = useColor(parsed.global.noColor, io.env, io.stderr);
    if (parsed.global.version) {
      const versionCommand = commands.find((command) => command.name === 'version');
      if (!versionCommand) throw new MfmError('INTERNAL', {}, { message: 'The version command is not registered.' });
      return await runCli(['version', ...(json ? ['--json'] : []), ...(verbose ? ['--verbose'] : [])], io, commands);
    }
    if (parsed.global.help) {
      if (parsed.command) {
        commandName = parsed.command.name;
        if (!json) {
          io.stdout.write(commandHelpText(parsed.command));
          return EXIT.ok;
        }
        envelope = successEnvelope(commandName, CLI_VERSION, commandHelpData(parsed.command));
      } else {
        commandName = '';
        if (!json) {
          io.stdout.write(topHelpText(commands));
          return EXIT.ok;
        }
        envelope = successEnvelope(commandName, CLI_VERSION, topHelpData(commands));
      }
    } else {
      const command = parsed.command;
      if (!command) throw usageError('No command given.', 'Run `mf-motion --help` for the command list.');
      commandName = command.name;
      human = command.human;
      const log = createLogger(io.stderr, { quiet: parsed.global.quiet, verbose, color });
      const { noColor: _noColor, help: _help, version: _version, ...globalRest } = parsed.global;
      const result = await command.handler({
        flags: parsed.flags as FlagValues<FlagMap>,
        args: parsed.args,
        global: { ...globalRest, color },
        env: io.env,
        cwd: io.cwd,
        log,
        cli: CLI_VERSION,
      });
      exitCode = result.exitCode ?? EXIT.ok;
      envelope = successEnvelope(commandName, CLI_VERSION, result.data, result.warnings ?? [], result.next ?? []);
    }
  } catch (error) {
    const failure = toFailure(error, verbose);
    exitCode = failure.exitCode;
    envelope = failureEnvelope(commandName, CLI_VERSION, failure.error, [], failure.next);
  }
  if (json) {
    io.stdout.write(renderJson(envelope));
  } else {
    const text = renderHuman(envelope, { color }, human);
    if (text.stdout) io.stdout.write(text.stdout);
    if (text.stderr) io.stderr.write(text.stderr);
  }
  return exitCode;
}

function toFailure(error: unknown, verbose: boolean): {
  exitCode: ExitCode;
  error: { code: ErrorCode; message: string; hint: string; details: Record<string, unknown> };
  next: string[];
} {
  if (isMfmError(error)) {
    return {
      exitCode: error.exitCode,
      error: { code: error.code, message: error.message, hint: error.hint, details: error.details },
      next: error.next,
    };
  }
  const internal = new MfmError('INTERNAL');
  const cause = error instanceof Error ? error : new Error(String(error));
  const details: Record<string, unknown> = { cause: cause.message };
  if (verbose && cause.stack) details.stack = cause.stack;
  return {
    exitCode: internal.exitCode,
    error: { code: 'INTERNAL', message: internal.message, hint: internal.hint, details },
    next: [],
  };
}

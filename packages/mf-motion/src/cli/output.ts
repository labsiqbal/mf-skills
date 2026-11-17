// The output envelope, its human rendering and the stderr logger.
import type { ErrorCode } from './errors';

/** Version of the envelope shape itself. */
export const ENVELOPE_SCHEMA_VERSION = 1;

export interface Warning {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface EnvelopeError {
  code: ErrorCode;
  message: string;
  hint: string;
  details: Record<string, unknown>;
}

interface EnvelopeBase {
  command: string;
  cli: string;
  schemaVersion: number;
  warnings: Warning[];
  next: string[];
}

export interface SuccessEnvelope extends EnvelopeBase {
  ok: true;
  data: unknown;
}

export interface FailureEnvelope extends EnvelopeBase {
  ok: false;
  error: EnvelopeError;
}

export type Envelope = SuccessEnvelope | FailureEnvelope;

export function successEnvelope(
  command: string,
  cli: string,
  data: unknown,
  warnings: Warning[] = [],
  next: string[] = [],
): SuccessEnvelope {
  return { ok: true, command, cli, schemaVersion: ENVELOPE_SCHEMA_VERSION, data, warnings, next };
}

export function failureEnvelope(
  command: string,
  cli: string,
  error: EnvelopeError,
  warnings: Warning[] = [],
  next: string[] = [],
): FailureEnvelope {
  return { ok: false, command, cli, schemaVersion: ENVELOPE_SCHEMA_VERSION, error, warnings, next };
}

/** Exactly one JSON document, newline terminated. */
export function renderJson(envelope: Envelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

/** Writable sink for CLI text. */
export interface Sink {
  write(text: string): unknown;
  isTTY?: boolean;
}

export interface Style {
  color: boolean;
}

const paint = (style: Style, code: number, text: string) => (style.color ? `\u001b[${code}m${text}\u001b[0m` : text);
export const red = (style: Style, text: string) => paint(style, 31, text);
export const yellow = (style: Style, text: string) => paint(style, 33, text);
export const dim = (style: Style, text: string) => paint(style, 2, text);
export const bold = (style: Style, text: string) => paint(style, 1, text);

function scalar(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Flatten data into `key: value` lines; nested objects use dotted keys. */
export function dataLines(data: unknown, prefix = ''): string[] {
  if (data === null || typeof data !== 'object') return prefix ? [`${prefix}: ${scalar(data)}`] : [scalar(data)];
  if (Array.isArray(data)) {
    if (data.every((item) => item === null || typeof item !== 'object')) {
      return [`${prefix || 'items'}: ${data.length === 0 ? 'none' : data.map(scalar).join(', ')}`];
    }
    return data.flatMap((item, index) => dataLines(item, `${prefix || 'items'}[${index}]`));
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return [`${prefix || 'data'}: none`];
  return entries.flatMap(([key, value]) => dataLines(value, prefix ? `${prefix}.${key}` : key));
}

/** Human rendering: facts on stdout for success; the error on stderr for failure. */
export function renderHuman(
  envelope: Envelope,
  style: Style,
  human?: (data: unknown) => string[],
): { stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  for (const warning of envelope.warnings) err.push(`${yellow(style, `warning ${warning.code}`)}: ${warning.message}`);
  if (envelope.ok) {
    out.push(...(human ? human(envelope.data) : dataLines(envelope.data)));
  } else {
    err.push(`${red(style, `error ${envelope.error.code}`)}: ${envelope.error.message}`);
    err.push(`hint: ${envelope.error.hint}`);
    const stack = envelope.error.details.stack;
    if (typeof stack === 'string') err.push(dim(style, stack));
  }
  const target = envelope.ok ? out : err;
  if (envelope.next.length > 0) {
    target.push(bold(style, 'next:'));
    for (const command of envelope.next) target.push(`  ${command}`);
  }
  const join = (lines: string[]) => (lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return { stdout: join(out), stderr: join(err) };
}

export interface LoggerOptions {
  quiet: boolean;
  verbose: boolean;
  color: boolean;
}

/** Progress and diagnostics; always stderr so stdout stays machine-readable. */
export interface Logger {
  /** Progress lines; hidden with --quiet. */
  progress(message: string): void;
  /** Warnings that are not part of the envelope; hidden with --quiet. */
  warn(message: string): void;
  /** Detail shown only with --verbose. */
  debug(message: string): void;
}

export function createLogger(stderr: Sink, options: LoggerOptions): Logger {
  const style = { color: options.color };
  return {
    progress(message) {
      if (!options.quiet) stderr.write(`${message}\n`);
    },
    warn(message) {
      if (!options.quiet) stderr.write(`${yellow(style, 'warning')}: ${message}\n`);
    },
    debug(message) {
      if (options.verbose) stderr.write(`${dim(style, message)}\n`);
    },
  };
}

/** Colour only when allowed by flag and environment and stderr is a terminal. */
export function useColor(noColorFlag: boolean, env: NodeJS.ProcessEnv, stderr: Sink): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return stderr.isTTY === true;
}

// Every HyperFrames call goes through here: the bin runs as `node <entry>`
// with the engine environment, a timeout that stops the whole process tree,
// and the result read from the last JSON value on stdout.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { type ErrorCode, MfmError } from '../cli/errors';
import { npmBin } from '../proc/npmBin';
import { type RunResult, lastJson, run } from '../proc/run';
import { type EngineEnvOptions, engineEnv } from './env';
import { assertPrivateCache, readOk, writeOk } from './install';

const MINUTE = 60 * 1000;

/** Time limits per engine command. */
export const TIMEOUTS = {
  render: 60 * MINUTE,
  check: 10 * MINUTE,
  snapshot: 5 * MINUTE,
  capture: 5 * MINUTE,
  audio: 5 * MINUTE,
  tts: 10 * MINUTE,
  transcribe: 30 * MINUTE,
  'remove-background': 30 * MINUTE,
  browser: 15 * MINUTE,
  info: 1 * MINUTE,
} as const;

export interface Engine {
  /** Installed engine folder from ensureEngine. */
  dir: string;
  version: string;
}

export interface CallOptions {
  timeoutMs: number;
  /** Error code for an engine failure: CHECK_FAILED for check, RENDER_FAILED for everything else. */
  failure: Extract<ErrorCode, 'RENDER_FAILED' | 'CHECK_FAILED'>;
  cwd?: string;
  /** Build folder of the call; a stray .env there is deleted first. */
  buildDir?: string;
  env?: Omit<EngineEnvOptions, 'engineDir' | 'browserPath'>;
  /** Engine prints JSON on success (most commands); render prints nothing. */
  expectJson?: boolean;
  /**
   * Refuse a cache the engine would swap for one in the user's home (default).
   * Only --version and --help, which never touch the cache, skip it.
   */
  privateCache?: boolean;
  /**
   * A command that exits non-zero with a full report (no `error` envelope) has
   * still succeeded: `check` exits 1 with `ok: false` when it finds errors.
   */
  reportOnFailure?: boolean;
  onStderr?: (chunk: string) => void;
}

export interface CallResult {
  json: unknown;
  run: RunResult;
}

/** The argument vector the adapter spawns: `[node, <hyperframes entry>, ...args]`. */
export function engineCommand(engine: Engine, args: readonly string[]): string[] {
  const [node, entry] = npmBin('hyperframes', 'hyperframes', engine.dir);
  return [node, entry, ...args];
}

function engineError(failure: CallOptions['failure'], json: unknown, result: RunResult): MfmError {
  const report = json as { reason?: unknown; error?: { code?: unknown; message?: unknown; hint?: unknown } } | undefined;
  const error = report?.error;
  const engineCode = typeof error?.code === 'string' ? error.code
    : report?.reason === 'whisper_unavailable' ? report.reason : null;
  const engineMessage = typeof error?.message === 'string' ? error.message : null;
  return new MfmError(
    failure,
    {
      engineCode,
      engineMessage,
      ...(typeof error?.hint === 'string' ? { engineHint: error.hint } : {}),
      exitCode: result.code,
      stderrTail: result.stderr.slice(-2000),
    },
    engineMessage ? { message: `The engine reported: ${engineMessage}` } : {},
  );
}

/** Run one engine command; maps failures to the call's error code with details.engineCode. */
export async function callEngine(engine: Engine, args: readonly string[], options: CallOptions): Promise<CallResult> {
  if (options.privateCache !== false) assertPrivateCache(engine.dir);
  if (options.buildDir) rmSync(path.join(options.buildDir, '.env'), { force: true });
  const browserPath = readOk(engine.dir)?.browserPath ?? null;
  const env = engineEnv({ ...options.env, engineDir: engine.dir, browserPath });
  const [node, ...rest] = engineCommand(engine, args);
  const result = await run(node ?? process.execPath, rest, {
    cwd: options.cwd ?? options.buildDir ?? engine.dir,
    env,
    timeoutMs: options.timeoutMs,
    killTree: true,
    ...(options.onStderr ? { onStderr: options.onStderr } : {}),
  });
  if (result.timedOut) {
    throw new MfmError('TIMEOUT', { tool: 'hyperframes', command: args[0] ?? '', timeoutMs: options.timeoutMs }, {
      message: `hyperframes ${args[0] ?? ''} did not finish within ${Math.round(options.timeoutMs / 1000)} s and was stopped.`,
    });
  }
  if (result.spawnError) {
    throw new MfmError('ENGINE_MISSING', { spawnError: result.spawnError.code }, { message: 'The render engine could not be started.' });
  }
  const json = lastJson(result.stdout);
  const envelope = json as { ok?: unknown; error?: unknown } | undefined;
  const isReport = options.reportOnFailure === true && envelope !== undefined && typeof envelope === 'object' && envelope.error === undefined;
  const reportedFailure = envelope?.ok === false;
  if ((result.code !== 0 || reportedFailure) && !isReport) throw engineError(options.failure, json, result);
  if (options.expectJson !== false && json === undefined) {
    throw new MfmError('ENGINE_OUTPUT_UNPARSEABLE', { command: args[0] ?? '', stdoutTail: result.stdout.slice(-2000) });
  }
  return { json, run: result };
}

/** `hyperframes --version`. */
export async function engineVersion(engine: Engine): Promise<string> {
  const { run: result } = await callEngine(engine, ['--version'], {
    timeoutMs: TIMEOUTS.info,
    failure: 'RENDER_FAILED',
    expectJson: false,
    privateCache: false,
  });
  return result.stdout.trim();
}

/** `hyperframes <command...> --help`, as printed. */
export async function engineHelp(engine: Engine, command: readonly string[]): Promise<string> {
  const { run: result } = await callEngine(engine, [...command, '--help'], {
    timeoutMs: TIMEOUTS.info,
    failure: 'RENDER_FAILED',
    expectJson: false,
    privateCache: false,
  });
  return result.stdout + result.stderr;
}

/** `browser ensure` then `browser path`; records the Chrome path in the engine's .ok. */
export async function ensureBrowser(engine: Engine, onStderr?: (chunk: string) => void): Promise<string> {
  await callEngine(engine, ['browser', 'ensure'], {
    timeoutMs: TIMEOUTS.browser,
    failure: 'RENDER_FAILED',
    expectJson: false,
    ...(onStderr ? { onStderr } : {}),
  });
  const { run: result } = await callEngine(engine, ['browser', 'path'], { timeoutMs: TIMEOUTS.info, failure: 'RENDER_FAILED', expectJson: false });
  const browserPath = result.stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
  if (!browserPath || !existsSync(browserPath)) {
    throw new MfmError('CHROME_LAUNCH_FAILED', { reported: browserPath }, { message: 'The engine did not report a usable Chrome path.' });
  }
  const ok = readOk(engine.dir);
  if (ok) writeOk(engine.dir, { ...ok, browserPath });
  return browserPath;
}

export interface Finding {
  section: string;
  code: string;
  severity: string;
  message: string;
  time: number | null;
  selector: string | null;
}

export interface CheckResult {
  errors: number;
  warnings: number;
  findings: Finding[];
  snapshots: string[];
  /** Engine crops of findings (`finding-NN-<code>.png`), absolute paths. */
  findingFiles: string[];
  raw: unknown;
}

type Section = { errorCount?: number; warningCount?: number; findings?: Array<Record<string, unknown>> };

/** `check --json --snapshots --at-transitions [--at t,...]`; a report with error findings is a result, not a failure. */
export async function check(engine: Engine, buildDir: string, options: { at?: number[] } = {}): Promise<CheckResult> {
  const args = ['check', buildDir, '--json', '--snapshots', '--at-transitions'];
  if (options.at && options.at.length > 0) args.push('--at', options.at.join(','));
  const { json } = await callEngine(engine, args, { timeoutMs: TIMEOUTS.check, failure: 'CHECK_FAILED', buildDir, reportOnFailure: true });
  const report = json as Record<string, unknown>;
  let errors = 0;
  let warnings = 0;
  const findings: Finding[] = [];
  for (const [section, value] of Object.entries(report)) {
    const part = value as Section | null;
    if (!part || typeof part !== 'object' || !Array.isArray(part.findings)) continue;
    errors += part.errorCount ?? 0;
    warnings += part.warningCount ?? 0;
    for (const finding of part.findings) {
      findings.push({
        section,
        code: String(finding.code ?? ''),
        severity: String(finding.severity ?? ''),
        message: String(finding.message ?? ''),
        time: typeof finding.time === 'number' ? finding.time : null,
        selector: typeof finding.selector === 'string' ? finding.selector : null,
      });
    }
  }
  const shots = report.snapshots as { files?: unknown; findingFiles?: unknown } | undefined;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return { errors, warnings, findings, snapshots: strings(shots?.files), findingFiles: strings(shots?.findingFiles), raw: json };
}

export interface SnapshotResult {
  frames: Array<{ path: string; time: number; role: string | null }>;
  sheets: string[];
  raw: unknown;
}

function snapshotResult(json: unknown): SnapshotResult {
  const value = json as { frames?: Array<{ path: string; time: number; role?: string }>; contactSheets?: string[] };
  return {
    frames: (value.frames ?? []).map((frame) => ({ path: frame.path, time: frame.time, role: frame.role ?? null })),
    sheets: value.contactSheets ?? [],
    raw: json,
  };
}

/** `snapshot --review --json`: beat frames, seam strips and the phone sheet. */
export async function snapshotReview(engine: Engine, buildDir: string, outDir: string): Promise<SnapshotResult> {
  const { json } = await callEngine(engine, ['snapshot', buildDir, '--review', '--json', '--output', outDir], {
    timeoutMs: TIMEOUTS.snapshot,
    failure: 'RENDER_FAILED',
    buildDir,
  });
  return snapshotResult(json);
}

/** `snapshot --at t,... --no-end --json`: stills at exactly these times. */
export async function snapshotAt(engine: Engine, buildDir: string, times: number[], outDir: string): Promise<SnapshotResult> {
  const { json } = await callEngine(engine, ['snapshot', buildDir, '--at', times.join(','), '--no-end', '--json', '--output', outDir], {
    timeoutMs: TIMEOUTS.snapshot,
    failure: 'RENDER_FAILED',
    buildDir,
  });
  return snapshotResult(json);
}

export interface RenderOptions {
  format: 'png-sequence' | 'mp4' | 'webm' | 'mov';
  fps: string;
  /** File, or folder for png-sequence. */
  output: string;
  workers?: number;
  /** Production lab only, with explicit workers. */
  renderLockOff?: boolean;
  onStderr?: (chunk: string) => void;
}

/** `render --format <f> --fps <r> --quality delivery --json --output <out> [--workers n]`. */
export async function render(engine: Engine, buildDir: string, options: RenderOptions): Promise<{ output: string }> {
  const args = ['render', buildDir, '--format', options.format, '--fps', options.fps, '--quality', 'delivery', '--json', '--output', options.output];
  if (options.workers !== undefined) args.push('--workers', String(options.workers));
  await callEngine(engine, args, {
    timeoutMs: TIMEOUTS.render,
    failure: 'RENDER_FAILED',
    buildDir,
    expectJson: false,
    ...(options.renderLockOff ? { env: { renderLockOff: true } } : {}),
    ...(options.onStderr ? { onStderr: options.onStderr } : {}),
  });
  if (!existsSync(options.output)) {
    throw new MfmError('RENDER_FAILED', { output: options.output }, { message: 'The engine finished but wrote no output.' });
  }
  return { output: options.output };
}

export type CaptureSource = { url: string } | { localFile: string; localRoot: string };

/** `capture <url> --skip-vision --json` or `capture --local-file <html> --local-root <dir> --skip-vision --json`. */
export async function capture(engine: Engine, source: CaptureSource, outDir: string, options: { vision?: boolean } = {}): Promise<unknown> {
  const args = ['capture'];
  if ('url' in source) args.push(source.url);
  else args.push('--local-file', source.localFile, '--local-root', source.localRoot);
  if (!options.vision) args.push('--skip-vision');
  args.push('--json', '--output', outDir);
  const { json } = await callEngine(engine, args, { timeoutMs: TIMEOUTS.capture, failure: 'RENDER_FAILED', cwd: path.dirname(outDir) });
  return json;
}

/** `audio <file> --only beats,downbeats,bpm,sections --quality local --json`. */
export async function audio(engine: Engine, file: string, only = 'beats,downbeats,bpm,sections'): Promise<unknown> {
  const { json } = await callEngine(engine, ['audio', file, '--only', only, '--quality', 'local', '--json'], {
    timeoutMs: TIMEOUTS.audio,
    failure: 'RENDER_FAILED',
  });
  return json;
}

/** `tts --text-file <file> --voice <id> --output <wav> --json` (Kokoro-82M, local). */
export async function tts(engine: Engine, textFile: string, voice: string, output: string): Promise<unknown> {
  const { json } = await callEngine(engine, ['tts', '--text-file', textFile, '--voice', voice, '--output', output, '--json'], {
    timeoutMs: TIMEOUTS.tts,
    failure: 'RENDER_FAILED',
  });
  return json;
}

/** Invoke local Whisper. Only doctor opts in to runtime installation. */
export async function transcribe(
  engine: Engine,
  file: string,
  options: { model?: string; language?: string; engine?: 'whisper'; runtimeInstall?: boolean; cwd?: string; parent?: NodeJS.ProcessEnv } = {},
): Promise<unknown> {
  const args = ['transcribe', file, '--json', '--engine', options.engine ?? 'whisper', options.runtimeInstall ? '--runtime-install' : '--no-runtime-install'];
  if (options.model) args.push('--model', options.model);
  if (options.language) args.push('--language', options.language);
  const { json } = await callEngine(engine, args, {
    timeoutMs: TIMEOUTS.transcribe,
    failure: 'RENDER_FAILED',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.parent === undefined ? {} : { env: { parent: options.parent } }),
  });
  return json;
}

/** `remove-background <in> --output <out> --json`; optional installs allowed after `cutout enable`. */
export async function removeBackground(engine: Engine, input: string, output: string): Promise<unknown> {
  const { json } = await callEngine(engine, ['remove-background', input, '--output', output, '--json'], {
    timeoutMs: TIMEOUTS['remove-background'],
    failure: 'RENDER_FAILED',
    env: { allowOptionalInstall: true },
  });
  return json;
}

/** Every flag each adapter function passes, per engine command (checked against the recorded help). */
export const ADAPTER_FLAGS: Record<string, string[]> = {
  check: ['--json', '--snapshots', '--at-transitions', '--at'],
  snapshot: ['--review', '--json', '--output', '--at', '--no-end'],
  render: ['--format', '--fps', '--quality', '--json', '--output', '--workers'],
  capture: ['--local-file', '--local-root', '--skip-vision', '--json', '--output'],
  audio: ['--only', '--quality', '--json'],
  tts: ['--text-file', '--voice', '--output', '--json'],
  transcribe: ['--json', '--model', '--language', '--engine', '--runtime-install', '--no-runtime-install'],
  'remove-background': ['--output', '--json'],
  browser: [],
};

/** Engine commands the adapter calls, as recorded help fixtures name them. */
export const ADAPTER_COMMANDS = Object.keys(ADAPTER_FLAGS);

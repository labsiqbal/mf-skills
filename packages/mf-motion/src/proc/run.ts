// The only place mf-motion starts child processes. Programs get an argument
// array and never a shell, so file names, URLs and variables cannot inject
// commands. Streams are captured, runs are time-limited, and JSON results are
// read from the last JSON value a tool prints.
import { spawn } from 'node:child_process';
import { MfmError } from '../cli/errors';

export interface RunOptions {
  cwd?: string;
  /** Full environment for the child; default: this process's environment. */
  env?: NodeJS.ProcessEnv;
  /** Milliseconds before the child is stopped; default 10 minutes. 0 disables the limit. */
  timeoutMs?: number;
  /** Written to the child's stdin, which is then closed. */
  input?: string | Buffer;
  /** Called with each stderr chunk as it arrives (progress passthrough). */
  onStderr?: (chunk: string) => void;
  /** Called with each stdout chunk as it arrives. */
  onStdout?: (chunk: string) => void;
  /** Captured bytes kept per stream; older output is dropped first. Default 32 MiB. */
  maxCaptureBytes?: number;
  /**
   * Stop the whole process tree on timeout (the child and everything it
   * started): a process group on POSIX, `taskkill /T` on Windows.
   */
  killTree?: boolean;
}

export interface RunResult {
  file: string;
  args: readonly string[];
  /** Exit code, or null when the process was killed or never started. */
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Set when the program could not be started (for example ENOENT). */
  spawnError?: { code: string; message: string };
}

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5000;

class Capture {
  private chunks: Buffer[] = [];
  private bytes = 0;
  constructor(private readonly limit: number) {}
  push(chunk: Buffer) {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.limit && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()?.length ?? 0;
    }
  }
  text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** Run a program with an argument array; resolves for every outcome, never rejects. */
export function run(file: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const limit = options.maxCaptureBytes ?? 32 * 1024 * 1024;
  const stdout = new Capture(limit);
  const stderr = new Capture(limit);
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnError: RunResult['spawnError'];
    const tree = options.killTree === true;
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // A POSIX process group lets the whole tree be signalled at once.
      detached: tree && process.platform !== 'win32',
    });
    // A detached group does not receive the terminal's Ctrl-C, so pass it on:
    // stop the tree, then let the signal end this process as it would have.
    const stopTree = tree && child.pid !== undefined ? () => killProcessTree(child.pid ?? 0, 'SIGKILL') : undefined;
    const onSignal = (signal: NodeJS.Signals) => {
      stopTree?.();
      detachSignals();
      process.kill(process.pid, signal);
    };
    const detachSignals = () => {
      if (!stopTree) return;
      process.removeListener('exit', stopTree);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    };
    if (stopTree) {
      process.once('exit', stopTree);
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (signal: NodeJS.Signals) => {
      if (tree && child.pid !== undefined) killProcessTree(child.pid, signal);
      else child.kill(signal);
    };
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            stop('SIGTERM');
            killTimer = setTimeout(() => stop('SIGKILL'), KILL_GRACE_MS);
          }, timeoutMs)
        : undefined;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      detachSignals();
      // Anything the child left behind in its group goes too.
      if (tree && timedOut && child.pid !== undefined) killProcessTree(child.pid, 'SIGKILL');
      resolve({
        file,
        args,
        code,
        signal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut,
        durationMs: Date.now() - started,
        ...(spawnError ? { spawnError } : {}),
      });
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      options.onStdout?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      options.onStderr?.(chunk.toString('utf8'));
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = { code: error.code ?? 'UNKNOWN', message: error.message };
      // 'close' may not follow a failed spawn.
      if (child.pid === undefined) finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.on('error', () => {
      // The child may exit before reading its input; that is not our failure.
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** Signal a process and every process it started. Errors (already gone) are ignored. */
export function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return;
  if (process.platform === 'win32') {
    // taskkill is a real executable; /T takes the tree, /F forces it.
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

export interface ToolRunOptions extends RunOptions {
  /** Human name of the tool, used in errors (for example "FFmpeg"). */
  tool: string;
}

/**
 * Run a tool and require exit code 0. Throws TIMEOUT when it ran out of time
 * and TOOL_FAILED when it could not start or exited non-zero.
 */
export async function runTool(file: string, args: readonly string[], options: ToolRunOptions): Promise<RunResult> {
  const result = await run(file, args, options);
  if (result.timedOut) {
    throw new MfmError('TIMEOUT', { tool: options.tool, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }, {
      message: `${options.tool} did not finish in time and was stopped.`,
    });
  }
  if (result.spawnError || result.code !== 0) {
    throw new MfmError(
      'TOOL_FAILED',
      {
        tool: options.tool,
        code: result.code,
        signal: result.signal,
        ...(result.spawnError ? { spawnError: result.spawnError.code } : {}),
        stderrTail: result.stderr.slice(-2000),
      },
      { message: `${options.tool} failed${result.spawnError ? ` to start (${result.spawnError.code})` : ` with exit code ${result.code ?? result.signal}`}.` },
    );
  }
  return result;
}

const MAX_JSON_SCAN = 8 * 1024 * 1024;
const MAX_END_CANDIDATES = 64;

/**
 * The last complete JSON object or array in a tool's output, or undefined.
 * Log lines before or after it are ignored.
 */
export function lastJson(text: string): unknown {
  const source = text.length > MAX_JSON_SCAN ? text.slice(-MAX_JSON_SCAN) : text;
  let end = source.length;
  for (let tries = 0; tries < MAX_END_CANDIDATES; tries += 1) {
    const close = Math.max(source.lastIndexOf('}', end - 1), source.lastIndexOf(']', end - 1));
    if (close < 0) return undefined;
    const open = source[close] === '}' ? '{' : '[';
    for (let start = source.lastIndexOf(open, close); start >= 0; start = source.lastIndexOf(open, start - 1)) {
      try {
        return JSON.parse(source.slice(start, close + 1)) as unknown;
      } catch {
        // Not a complete value yet; widen to the previous opening bracket.
      }
      if (start === 0) break;
    }
    end = close;
  }
  return undefined;
}

/** Run a tool that prints JSON; throws TOOL_FAILED when its output holds no JSON value. */
export async function runJson(file: string, args: readonly string[], options: ToolRunOptions): Promise<{ result: RunResult; json: unknown }> {
  const result = await runTool(file, args, options);
  const json = lastJson(result.stdout);
  if (json === undefined) {
    throw new MfmError('TOOL_FAILED', { tool: options.tool, stdoutTail: result.stdout.slice(-2000) }, {
      message: `${options.tool} printed no JSON result.`,
    });
  }
  return { result, json };
}

export interface StreamRun {
  /** Raw stdout chunks with backpressure: the child waits while the consumer is busy. */
  chunks: AsyncIterable<Buffer>;
  /** Settles when the process ends; `stdout` is empty (it went to `chunks`). */
  result: Promise<RunResult>;
}

/**
 * Run a program and stream its binary stdout (for example raw video frames).
 * Same rules as `run`: argument array, no shell, time limit, stderr captured.
 */
export function runStream(file: string, args: readonly string[], options: Omit<RunOptions, 'onStdout' | 'input'> = {}): StreamRun {
  const started = Date.now();
  const stderr = new Capture(options.maxCaptureBytes ?? 4 * 1024 * 1024);
  let timedOut = false;
  let spawnError: RunResult['spawnError'];
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : undefined;
  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk);
    options.onStderr?.(chunk.toString('utf8'));
  });
  const result = new Promise<RunResult>((resolve) => {
    let settled = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        file,
        args,
        code,
        signal,
        stdout: '',
        stderr: stderr.text(),
        timedOut,
        durationMs: Date.now() - started,
        ...(spawnError ? { spawnError } : {}),
      });
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = { code: error.code ?? 'UNKNOWN', message: error.message };
      if (child.pid === undefined) finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
  async function* chunks(): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of child.stdout) yield chunk as Buffer;
    } finally {
      // The consumer stopped early: end the producer too.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
  return { chunks: chunks(), result };
}

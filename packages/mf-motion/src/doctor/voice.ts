// Local voice runtime (doctor --fix --voice): a private Python venv with the
// hash-locked Kokoro packages, and the engine's own pinned Kokoro files checked
// against our manifest. mf-motion ships no Python code or model; nothing here
// runs without --voice except the read-only checks of an existing install.
//
// Every interpreter call runs isolated (-I) with <cache>/voice as its working
// folder, so nothing in the user's folder can be imported.
import { createHash } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { type Engine, callEngine } from '../engine/adapter';
import { type VoiceOk, privateBelow, readVoiceOk, voiceAssets, voiceDir } from '../engine/env';
import { enginePins } from '../engine/pins';
import { withLock } from '../paths/index';
import { run } from '../proc/run';

export type VoiceStatus = 'ok' | 'missing' | 'optional' | 'warn';

export interface VoiceRow {
  id: 'voice';
  status: VoiceStatus;
  found: string | null;
  need: string;
  fix: string | null;
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  licence: string;
}

export interface VoiceManifest {
  engineVersion: string;
  files: ManifestFile[];
}

export interface LockTarget {
  id: string;
  python: string;
  sysPlatform: string;
  machine: string;
  packages?: Record<string, string>;
  unsupported?: string;
}

export interface PythonFound {
  /** Program and leading arguments, for example ['py', '-3.12']. */
  command: string[];
  version: string;
  sysPlatform: string;
  machine: string;
}

export const VOICE_NEED = 'local voice runtime: Python 3.11-3.13 venv with Kokoro (only for local voiceover)';
export const VOICE_FIX = 'mf-motion doctor --fix --voice --json';
const TTS_PROBE_TIMEOUT_MS = 30 * 60 * 1000;
const PIP_TIMEOUT_MS = 20 * 60 * 1000;

export function readManifest(file = voiceAssets().manifest): VoiceManifest {
  return JSON.parse(readFileSync(file, 'utf8')) as VoiceManifest;
}

export function readLockTargets(file = voiceAssets().lockJson): LockTarget[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { targets: LockTarget[] }).targets;
}

export function venvPythonPath(venv: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
}

/** Interpreters to probe, best first. */
export function pythonCandidates(platform: NodeJS.Platform = process.platform): string[][] {
  const names = [['python3.13'], ['python3.12'], ['python3.11'], ['python3'], ['python']];
  return platform === 'win32' ? [...names, ['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11']] : names;
}

const PROBE = 'import json, platform, sys; print(json.dumps([sys.version_info[0], sys.version_info[1], sys.version_info[2], sys.platform, platform.machine()]))';

/** The environment for our own interpreter and pip calls: an allow-list, PyPI only, no user configuration. */
export function pythonEnv(parent: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allow = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  for (const name of allow) if (parent[name] !== undefined) env[name] = parent[name];
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && /^(HTTPS?|NO|ALL)_PROXY$/i.test(name)) env[name] = value;
  }
  return {
    ...env,
    PIP_CONFIG_FILE: devNull,
    PIP_INDEX_URL: 'https://pypi.org/simple',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
    PYTHONNOUSERSITE: '1',
    ...extra,
  };
}

/** First interpreter on PATH that reports Python 3.11-3.13. */
export async function findPython(cwd: string, parent: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Promise<PythonFound | null> {
  for (const command of pythonCandidates(platform)) {
    const [program, ...lead] = command;
    if (!program) continue;
    const result = await run(program, [...lead, '-I', '-c', PROBE], { cwd, env: pythonEnv(parent), timeoutMs: 20_000 });
    if (result.spawnError || result.code !== 0) continue;
    try {
      const [major, minor, micro, sysPlatform, machine] = JSON.parse(result.stdout.trim().split(/\r?\n/).pop() ?? '') as [number, number, number, string, string];
      if (major === 3 && minor >= 11 && minor <= 13) return { command, version: `${major}.${minor}.${micro}`, sysPlatform, machine };
    } catch {
      // Not a Python we understand; try the next one.
    }
  }
  return null;
}

/** The lock target for an interpreter, or null when the lock does not cover it. */
export function lockTargetFor(found: PythonFound, targets = readLockTargets()): LockTarget | null {
  const minor = found.version.split('.').slice(0, 2).join('.');
  const machine = found.machine.toLowerCase();
  return targets.find((target) => target.python === minor && target.sysPlatform === found.sysPlatform && target.machine.toLowerCase() === machine) ?? null;
}

async function sha256Stream(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export type ModelCheck = { ok: true } | { ok: false; code: 'MODEL_HASH_MISMATCH' | 'MODEL_MISSING'; file: string };

/** The engine's Kokoro files against our manifest: size first, then sha256. */
export async function verifyModelFiles(engineDir: string, manifest = readManifest()): Promise<ModelCheck> {
  const root = path.join(engineDir, 'hf-cache', 'tts');
  for (const entry of manifest.files) {
    const file = path.join(root, ...entry.path.split('/'));
    if (!existsSync(file)) return { ok: false, code: 'MODEL_MISSING', file: entry.path };
    if (statSync(file).size !== entry.bytes || (await sha256Stream(file)) !== entry.sha256) return { ok: false, code: 'MODEL_HASH_MISMATCH', file: entry.path };
  }
  return { ok: true };
}

const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function tail(text: string, lines = 8): string {
  return text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(-lines).join(' | ');
}

export interface VoiceOptions {
  cacheRoot: string;
  engine: Engine | null;
  fix: boolean;
  offline: boolean;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** The fix line that installs Python on this OS. */
  pythonFix: string | null;
  /** Lock to install (tests use a deliberately broken one). */
  lockFile?: string;
  onProgress?: (message: string) => void;
}

/** The doctor row for the local voice runtime; with `fix`, install or repair it first. */
export async function voiceCheck(options: VoiceOptions): Promise<VoiceRow> {
  const row = (status: VoiceStatus, found: string | null, fix: string | null): VoiceRow => ({ id: 'voice', status, found, need: VOICE_NEED, fix });
  const state = readVoiceOk(options.cacheRoot);
  if (!options.fix) {
    if (!state.valid) {
      if (state.reason === 'absent') return row('optional', null, VOICE_FIX);
      return row('warn', `installed runtime is ${state.reason === 'not-private' ? 'writable by other accounts' : 'out of date'}`, VOICE_FIX);
    }
    if (!options.engine) return row('missing', 'engine missing', 'mf-motion doctor --fix --json');
    const models = await verifyModelFiles(options.engine.dir);
    if (!models.ok) return row('missing', `${models.code}: ${models.file}`, VOICE_FIX);
    return row('ok', `Kokoro via Python ${state.ok.pythonVersion} in ${path.dirname(path.dirname(state.ok.venvPython))}`, null);
  }
  try {
    return await installVoice(options, row);
  } catch (error) {
    const message = error instanceof MfmError ? `${error.code}: ${error.message}${error.details && 'pipTail' in (error.details as object) ? ` ${String((error.details as { pipTail?: string }).pipTail)}` : ''}` : String(error);
    return row('missing', message, VOICE_FIX);
  }
}

async function installVoice(options: VoiceOptions, row: (status: VoiceStatus, found: string | null, fix: string | null) => VoiceRow): Promise<VoiceRow> {
  const platform = options.platform ?? process.platform;
  const dir = voiceDir(options.cacheRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const found = await findPython(dir, options.env, platform);
  if (!found) return row('optional', 'no Python 3.11-3.13 on PATH', options.pythonFix);
  const target = lockTargetFor(found);
  if (!target || !target.packages) return row('optional', `unsupported-platform: Python ${found.version} on ${found.sysPlatform} ${found.machine}`, null);
  if (!options.engine) return row('missing', 'engine missing', 'mf-motion doctor --fix --json');
  const engine = options.engine;
  return withLock(
    path.join(dir, 'install.lock'),
    async () => {
      const current = readVoiceOk(options.cacheRoot);
      if (current.valid && options.lockFile === undefined && (await verifyModelFiles(engine.dir)).ok) {
        return row('ok', `Kokoro via Python ${current.ok.pythonVersion} in ${path.join(dir, 'venv')}`, null);
      }
      rmSync(path.join(dir, '.ok'), { force: true });
      const venv = path.join(dir, 'venv');
      const venvPython = venvPythonPath(venv, platform);
      const reuse = existsSync(venvPython) && privateBelow(venvPython, options.cacheRoot) && (await venvVersion(venvPython, dir, options.env)) === found.version;
      if (!reuse) {
        options.onProgress?.(`Creating the voice venv with Python ${found.version} in ${venv}`);
        rmSync(venv, { recursive: true, force: true });
        const [program, ...lead] = found.command;
        const made = await run(program ?? 'python3', [...lead, '-I', '-m', 'venv', venv], { cwd: dir, env: pythonEnv(options.env), timeoutMs: 5 * 60 * 1000 });
        if (made.code !== 0 || !existsSync(venvPython)) {
          throw new MfmError('TOOL_FAILED', { step: 'venv', pipTail: tail(made.stderr || made.stdout) }, { message: `Python ${found.version} could not create a venv.` });
        }
      }
      sealPrivate(venv, platform);
      const lock = options.lockFile ?? voiceAssets().lock;
      options.onProgress?.('Installing the hash-locked voice packages (about 150 MB)');
      const pipCache = options.env.PIP_CACHE_DIR || path.join(dir, 'pip-cache');
      const install = await run(
        venvPython,
        ['-I', '-m', 'pip', 'install', '--require-hashes', '--only-binary=:all:', '--no-deps', '--no-input', '-r', lock],
        { cwd: dir, env: pythonEnv(options.env, { PIP_CACHE_DIR: pipCache }), timeoutMs: PIP_TIMEOUT_MS, killTree: true },
      );
      if (install.code !== 0) {
        throw new MfmError('TOOL_FAILED', { step: 'pip install', pipTail: tail(install.stderr || install.stdout) }, { message: 'Installing the voice packages failed.' });
      }
      sealPrivate(venv, platform);
      const check = await run(venvPython, ['-I', '-m', 'pip', 'check'], { cwd: dir, env: pythonEnv(options.env), timeoutMs: 120_000 });
      if (check.code !== 0) {
        throw new MfmError('TOOL_FAILED', { step: 'pip check', pipTail: tail(check.stdout || check.stderr) }, { message: 'The installed voice packages are inconsistent.' });
      }
      options.onProgress?.('Fetching the engine’s pinned Kokoro files with a one-word speech probe (about 350 MB once)');
      await ttsProbe(engine, venvPython, dir);
      const models = await verifyModelFiles(engine.dir);
      if (!models.ok) throw new MfmError('MODEL_HASH_MISMATCH', { file: models.file, reason: models.code }, { message: `${models.file} does not match the voice manifest.` });
      const ok: VoiceOk = {
        pythonVersion: found.version,
        venvPython,
        lockSha256: sha256File(voiceAssets().lock),
        manifestSha256: sha256File(voiceAssets().manifest),
        engineVersion: enginePins().hyperframes,
      };
      if (options.lockFile !== undefined) return row('ok', `test lock installed with Python ${found.version}`, null);
      writeFileSync(path.join(dir, '.ok'), `${JSON.stringify(ok, null, 2)}\n`, { mode: 0o600 });
      return row('ok', `Kokoro via Python ${found.version} in ${venv}`, null);
    },
    { command: 'doctor --fix --voice' },
  );
}

/**
 * Remove group and other write from every folder and file below `dir`, so a
 * umask such as 002 cannot leave the venv writable by other accounts. POSIX only.
 */
export function sealPrivate(dir: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') return;
  const walk = (at: string) => {
    const stat = lstatSync(at);
    if (stat.isSymbolicLink()) return;
    if ((stat.mode & 0o022) !== 0) chmodSync(at, stat.mode & 0o7755);
    if (stat.isDirectory()) for (const name of readdirSync(at)) walk(path.join(at, name));
  };
  walk(dir);
}

async function venvVersion(python: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await run(python, ['-I', '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { cwd, env: pythonEnv(env), timeoutMs: 20_000 });
  return result.code === 0 ? result.stdout.trim() : null;
}

/** One word through the engine's tts with this venv; the engine fetches and verifies its own Kokoro files. */
export async function ttsProbe(engine: Engine, python: string, workDir: string, text = 'Ready.'): Promise<string> {
  const temp = mkdtempSync(path.join(workDir, 'probe-'));
  try {
    const textFile = path.join(temp, 'probe.txt');
    const out = path.join(temp, 'probe.wav');
    writeFileSync(textFile, `${text}\n`);
    await callEngine(engine, ['tts', '--text-file', textFile, '--voice', 'af_heart', '--output', out, '--json'], {
      timeoutMs: TTS_PROBE_TIMEOUT_MS,
      failure: 'RENDER_FAILED',
      cwd: temp,
      env: { python },
    });
    if (!existsSync(out)) throw new MfmError('RENDER_FAILED', { step: 'tts probe' }, { message: 'The speech probe wrote no audio.' });
    return out;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

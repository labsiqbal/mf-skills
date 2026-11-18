// The environment for every engine call: built from scratch, plus an
// allow-list of the parent environment. Cloud credentials never pass through
// unless one module adds exactly its own key for one call. The local voice
// runtime's Python joins only when its install record is current and private.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cache as cacheDir } from '../paths/places';
import { enginePins, packageRoot } from './pins';

/** Parent variables an engine call may see. */
export const PARENT_ALLOW_LIST = [
  'PATH',
  // Windows: how programs on PATH are found by extension.
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'LANG',
  'LC_ALL',
  'TZ',
  'HYPERFRAMES_CAPTURE_PROXY',
] as const;

/** Cloud credential variables; never inherited. */
export const CLOUD_CREDENTIALS = [
  'HEYGEN_API_KEY',
  'HYPERFRAMES_API_KEY',
  'HEYGEN_ACCESS_TOKEN',
  'ELEVENLABS_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'OPENAI_API_KEY',
] as const;

/** Extra parent variables for `npm ci` of the engine: npm config and proxies. */
const INSTALL_PATTERNS = [/^npm_config_/i, /^(HTTPS?|NO)_PROXY$/i, /^NODE_EXTRA_CA_CERTS$/];

export interface EngineEnvOptions {
  /** The installed engine folder; HYPERFRAMES_CACHE_DIR and the config folder live inside it. */
  engineDir: string;
  parent?: NodeJS.ProcessEnv;
  /** Recorded Chrome path once ensured. */
  browserPath?: string | null;
  /** Only for remove-background after `cutout enable`. */
  allowOptionalInstall?: boolean;
  /** Production lab only, with explicit --workers. */
  renderLockOff?: boolean;
  /** Exactly the credential(s) one cloud module call needs. */
  credentials?: Partial<Record<(typeof CLOUD_CREDENTIALS)[number], string>>;
  /** Also pass npm configuration and proxies (engine install only). */
  forInstall?: boolean;
  /**
   * Python for the engine's tts: a path pins it (doctor's probe before the
   * runtime is recorded), null leaves it out; by default the local voice
   * runtime's venv Python when its record is valid.
   */
  python?: string | null;
}

/** `<cache>/voice/.ok`, written last by `doctor --fix --voice`. */
export interface VoiceOk {
  pythonVersion: string;
  venvPython: string;
  lockSha256: string;
  manifestSha256: string;
  engineVersion: string;
}

const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The shipped voice lock and model manifest. */
export function voiceAssets(root = packageRoot()) {
  const dir = path.join(root, 'assets', 'voice');
  return { lock: path.join(dir, 'requirements.lock'), lockJson: path.join(dir, 'lock.json'), manifest: path.join(dir, 'manifest.json') };
}

export function voiceDir(cacheRoot: string): string {
  return path.join(cacheRoot, 'voice');
}

/** True when no folder from `file` up to `stopAt` (exclusive) is writable by other accounts or owned by one. POSIX only. */
export function privateBelow(file: string, stopAt: string): boolean {
  const uid = process.getuid?.();
  if (uid === undefined) return true;
  const top = path.resolve(stopAt);
  for (let at = path.resolve(file); at !== top && at.startsWith(`${top}${path.sep}`); at = path.dirname(at)) {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(at);
    } catch {
      return false;
    }
    if (stat.uid !== uid || (!stat.isSymbolicLink() && (stat.mode & 0o022) !== 0)) return false;
  }
  return true;
}

export type VoiceOkState = { valid: true; ok: VoiceOk } | { valid: false; reason: 'absent' | 'stale' | 'not-private' | 'unreadable'; ok: VoiceOk | null };

/** Read and check `<cache>/voice/.ok` against the shipped lock, manifest and engine pin. */
export function readVoiceOk(cacheRoot: string, root = packageRoot()): VoiceOkState {
  const file = path.join(voiceDir(cacheRoot), '.ok');
  if (!existsSync(file)) return { valid: false, reason: 'absent', ok: null };
  let ok: VoiceOk;
  try {
    ok = JSON.parse(readFileSync(file, 'utf8')) as VoiceOk;
  } catch {
    return { valid: false, reason: 'unreadable', ok: null };
  }
  const assets = voiceAssets(root);
  try {
    if (ok.lockSha256 !== sha256File(assets.lock) || ok.manifestSha256 !== sha256File(assets.manifest) || ok.engineVersion !== enginePins().hyperframes) {
      return { valid: false, reason: 'stale', ok };
    }
  } catch {
    return { valid: false, reason: 'stale', ok };
  }
  if (typeof ok.venvPython !== 'string' || !existsSync(ok.venvPython)) return { valid: false, reason: 'stale', ok };
  if (!privateBelow(ok.venvPython, cacheRoot) || !privateBelow(file, cacheRoot)) return { valid: false, reason: 'not-private', ok };
  return { valid: true, ok };
}

/**
 * The cache an engine folder lives in (`<cache>/engine/hf-<v>`), else the
 * cache resolver's answer for this environment.
 */
export function cacheOfEngine(engineDir: string, parent: NodeJS.ProcessEnv): string {
  const engines = path.dirname(path.resolve(engineDir));
  return path.basename(engines) === 'engine' ? path.dirname(engines) : cacheDir({ env: parent });
}

/** The venv Python the engine's tts may use, or null. */
export function voicePython(engineDir: string, parent: NodeJS.ProcessEnv): string | null {
  try {
    const state = readVoiceOk(cacheOfEngine(engineDir, parent));
    return state.valid ? state.ok.venvPython : null;
  } catch {
    return null;
  }
}

export function engineEnv(options: EngineEnvOptions): NodeJS.ProcessEnv {
  const parent = options.parent ?? process.env;
  const sep = /^[A-Za-z]:[\\/]/.test(options.engineDir) ? '\\' : '/';
  const env: NodeJS.ProcessEnv = {};
  for (const name of PARENT_ALLOW_LIST) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  if (options.forInstall) {
    for (const [name, value] of Object.entries(parent)) {
      if (value !== undefined && INSTALL_PATTERNS.some((pattern) => pattern.test(name))) env[name] = value;
    }
  }
  Object.assign(env, {
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_AGENT: '1',
    HYPERFRAMES_CACHE_DIR: `${options.engineDir}${sep}hf-cache`,
    // The engine otherwise keeps counters and state in the user's own home folder.
    HYPERFRAMES_CONFIG_DIR: `${options.engineDir}${sep}hf-config`,
  });
  if (!options.allowOptionalInstall) env.HYPERFRAMES_NO_OPTIONAL_INSTALL = '1';
  if (options.browserPath) env.HYPERFRAMES_BROWSER_PATH = options.browserPath;
  if (options.renderLockOff) env.HYPERFRAMES_RENDER_LOCK = 'off';
  const python = options.python === undefined ? (options.forInstall ? null : voicePython(options.engineDir, parent)) : options.python;
  if (python) env.HYPERFRAMES_PYTHON = python;
  for (const name of CLOUD_CREDENTIALS) delete env[name];
  for (const [name, value] of Object.entries(options.credentials ?? {})) {
    if (value !== undefined) env[name] = value;
  }
  return env;
}

// Install the pinned engine into <cache>/engine/hf-<version>/ with `npm ci`,
// writing .ok last. A folder without a valid .ok, or installed from another
// lockfile, is removed and reinstalled.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { cache as cacheDir, withLock } from '../paths/index';
import { npmCli } from '../proc/npmBin';
import { run } from '../proc/run';
import { engineEnv } from './env';
import { enginePinFiles, enginePins, lockSha256, packageRoot } from './pins';

export const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

export interface OkFile {
  installedAt: string;
  nodeVersion: string;
  lockSha256: string;
  /** Chrome path recorded by ensureBrowser. */
  browserPath?: string;
}

export interface EngineLocation {
  version: string;
  dir: string;
}

export function engineDirFor(cacheRoot: string, version: string): string {
  return path.join(cacheRoot, 'engine', `hf-${version}`);
}

export function okPath(dir: string): string {
  return path.join(dir, '.ok');
}

/** The parsed .ok of an engine folder, or null when it is missing or unreadable. */
export function readOk(dir: string): OkFile | null {
  try {
    const value = JSON.parse(readFileSync(okPath(dir), 'utf8')) as Partial<OkFile>;
    if (typeof value.installedAt === 'string' && typeof value.nodeVersion === 'string' && typeof value.lockSha256 === 'string') {
      return value as OkFile;
    }
  } catch {
    // Missing or corrupt: treated as not installed.
  }
  return null;
}

export function writeOk(dir: string, ok: OkFile): void {
  const temp = `${okPath(dir)}.tmp`;
  writeFileSync(temp, `${JSON.stringify(ok, null, 2)}\n`);
  renameSync(temp, okPath(dir));
}

/** True when the folder holds a complete install of the shipped lockfile. */
export function engineReady(dir: string, root = packageRoot()): boolean {
  const ok = readOk(dir);
  return ok !== null && ok.lockSha256 === lockSha256(root) && existsSync(path.join(dir, 'node_modules', 'hyperframes', 'package.json'));
}

/**
 * Folders the engine would refuse as its cache: it falls back to a cache in
 * the user's home when any folder on the path can be written by other
 * accounts (group or world write without the sticky bit, or another owner).
 * Returns the first such folder, or null. POSIX only.
 */
export function unsafeCacheAncestor(dir: string): string | null {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const top = path.resolve(dir);
  for (let at = top; ; at = path.dirname(at)) {
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(at);
    } catch {
      stat = undefined;
    }
    if (stat) {
      const foreignOwner = stat.uid !== uid && stat.uid !== 0;
      const groupOrWorldWrite = (stat.mode & 0o022) !== 0;
      const sticky = stat.isDirectory() && (stat.mode & 0o1000) !== 0;
      const insideTop = at === top || at.startsWith(`${top}${path.sep}`);
      if (foreignOwner || (!stat.isSymbolicLink() && groupOrWorldWrite && (insideTop || !sticky))) return at;
    }
    if (at === path.dirname(at)) return null;
  }
}

/** Refuse an engine call whose cache the engine would silently swap for one in the user's home. */
export function assertPrivateCache(engineDir: string): void {
  const cacheFolder = path.join(engineDir, 'hf-cache');
  const unsafe = unsafeCacheAncestor(cacheFolder);
  if (unsafe) {
    throw new MfmError('ENGINE_MISSING', { cache: cacheFolder, writableByOthers: unsafe }, {
      message: `The engine cache ${cacheFolder} is inside ${unsafe}, which other accounts can write, so the engine would not use it.`,
      hint: 'Set MF_MOTION_CACHE to a folder only you can write (for example one created with mode 700), then run `mf-motion doctor --fix --json`.',
    });
  }
}

export interface EnsureEngineOptions {
  cacheRoot?: string;
  env?: NodeJS.ProcessEnv;
  onProgress?: (message: string) => void;
  onStale?: (message: string) => void;
}

/** Install the pinned engine (or `version`, which must match the shipped pin) and return its folder. */
export async function ensureEngine(version?: string, options: EnsureEngineOptions = {}): Promise<EngineLocation> {
  const root = packageRoot();
  const pinned = enginePins().hyperframes;
  const wanted = version ?? pinned;
  if (wanted !== pinned) {
    throw new MfmError('ENGINE_MISSING', { version: wanted, pinned }, {
      message: `Engine ${wanted} is not the version this CLI pins (${pinned}).`,
      hint: `Use the mf-motion version that pins ${wanted}, or run \`mf-motion migrate --engine --project <dir> --json\` to re-pin the project.`,
    });
  }
  const parent = options.env ?? process.env;
  const cacheRoot = options.cacheRoot ?? cacheDir({ env: parent });
  const dir = engineDirFor(cacheRoot, wanted);
  if (engineReady(dir, root)) return { version: wanted, dir };
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  return withLock(
    `${dir}.lock`,
    async () => {
      if (engineReady(dir, root)) return { version: wanted, dir };
      options.onProgress?.(`Installing render engine hyperframes ${wanted} into ${dir}`);
      const staging = `${dir}.installing-${process.pid}`;
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      const pins = enginePinFiles(root);
      copyFileSync(pins.manifest, path.join(staging, 'package.json'));
      copyFileSync(pins.lock, path.join(staging, 'package-lock.json'));
      const env = engineEnv({ engineDir: dir, parent, forInstall: true });
      const result = await run(process.execPath, [npmCli(parent), 'ci', '--no-audit', '--no-fund', '--omit=dev'], {
        cwd: staging,
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
        killTree: true,
      });
      if (result.timedOut) {
        rmSync(staging, { recursive: true, force: true });
        throw new MfmError('TIMEOUT', { step: 'engine install' }, { message: 'Installing the render engine did not finish in time.' });
      }
      if (result.code !== 0) {
        rmSync(staging, { recursive: true, force: true });
        const offline = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(result.stderr);
        throw new MfmError(offline ? 'NETWORK_REQUIRED' : 'ENGINE_MISSING', { step: 'npm ci', code: result.code, stderrTail: result.stderr.slice(-2000) }, {
          message: offline ? 'Installing the render engine needs the network once.' : `npm ci for the render engine failed (exit ${result.code}).`,
        });
      }
      mkdirSync(path.join(staging, 'hf-cache'), { recursive: true, mode: 0o700 });
      mkdirSync(path.join(staging, 'hf-config'), { recursive: true, mode: 0o700 });
      // An existing config file stops the engine from seeding one from the user's home.
      writeFileSync(path.join(staging, 'hf-config', 'config.json'), '{}\n', { mode: 0o600 });
      rmSync(dir, { recursive: true, force: true });
      renameSync(staging, dir);
      writeOk(dir, { installedAt: new Date().toISOString(), nodeVersion: process.versions.node, lockSha256: lockSha256(root) });
      return { version: wanted, dir };
    },
    { command: 'engine install', ...(options.onStale ? { onStale: options.onStale } : {}) },
  );
}

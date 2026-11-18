// Doctor: checks every piece mf-motion needs, in a fixed order, and with --fix
// installs what lives in the cache (CLI copy, engine, Chrome, optional fonts).
// It never installs system packages; it prints one fix line for each.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMfmError, MfmError } from '../cli/errors';
import { CLI_VERSION } from '../cli/registry';
import {
  CLOUD_CREDENTIALS,
  type Engine,
  engineDirFor,
  engineEnv,
  engineReady,
  enginePins,
  ensureBrowser,
  ensureEngine,
  packageRoot,
  readOk,
  unsafeCacheAncestor,
} from '../engine/index';
import { FAMILY_SPECS, bundledFontsDir, families, fetchFonts } from '../fonts/index';
import { withPage } from '../media/chrome';
import { callWhisper, verifiedWhisperModel, WHISPER_DEFAULTS, WHISPER_FIX } from '../moves/transcribe';
import { cache as cacheDir, dataHome, withLock } from '../paths/index';
import { npmCli } from '../proc/npmBin';
import { run } from '../proc/run';
import { type FixOs, type OsRelease, detectFixOs, fixLine, readOsRelease } from './fixes';
import { voiceCheck } from './voice';

export type CheckStatus = 'ok' | 'missing' | 'optional' | 'warn';

export interface Check {
  id: string;
  status: CheckStatus;
  found: string | null;
  need: string;
  fix: string | null;
}

export interface DoctorData {
  ok: boolean;
  launcher: string[];
  checks: Check[];
  disk: { freeGb: number; path: string };
  engine: { version: string | null; path: string | null };
  chrome: { version: string | null; path: string | null };
}

export const REQUIRED_ENCODERS = ['libx264', 'libvpx-vp9', 'prores_ks'] as const;
export const REQUIRED_FILTERS = ['loudnorm', 'ebur128', 'overlay', 'scale', 'fps', 'alphamerge'] as const;

/** disk.doctorWarnGb and disk.doctorFailGb (safe-zones-and-numbers.md). */
export const DISK_WARN_GB = 5;
export const DISK_FAIL_GB = 2;

export interface DoctorOptions {
  fix?: boolean;
  fonts?: Array<'cjk' | 'emoji'>;
  transcribe?: boolean;
  /** With fix: install or repair the local voice runtime. */
  voice?: boolean;
  /** Tests: install this lock instead of assets/voice/requirements.lock. */
  voiceLockFile?: string;
  offline?: boolean;
  cliTarball?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  onProgress?: (message: string) => void;
  onWarn?: (message: string) => void;
  /** Injected for tests. */
  platform?: NodeJS.Platform;
  osRelease?: OsRelease | null;
}

const CHROME_LIBRARIES: Array<[RegExp, string]> = [
  [/libnss3\.so/, 'libnss3'],
  [/libgbm\.so/, 'libgbm1'],
  [/libasound\.so/, 'libasound2'],
  [/libatk-bridge-2\.0\.so/, 'libatk-bridge2.0-0'],
  [/libxkbcommon\.so/, 'libxkbcommon0'],
  [/libdrm\.so/, 'libdrm2'],
];

/** Encoder names from `ffmpeg -hide_banner -encoders`. */
export function parseEncoders(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
    if (match?.[1] && match[1] !== '=') names.add(match[1]);
  }
  return names;
}

/** Filter names from `ffmpeg -hide_banner -filters`. */
export function parseFilters(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[T.][S.][C.]?\s+(\S+)\s+\S+->\S+/);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

/** Shared libraries a failed Chrome launch could not load. */
export function missingLibraries(stderr: string): string[] {
  const missing: string[] = [];
  const names = [
    ...[...stderr.matchAll(/error while loading shared libraries: (\S+?):/g)].map((match) => match[1] ?? ''),
    // `ldd` output: "\tlibnss3.so => not found".
    ...[...stderr.matchAll(/^\s*(\S+\.so[.\d]*)\s+=>\s+not found/gm)].map((match) => match[1] ?? ''),
  ];
  for (const so of names) {
    const known = CHROME_LIBRARIES.find(([pattern]) => pattern.test(so));
    const name = known ? known[1] : so;
    if (!missing.includes(name)) missing.push(name);
  }
  return missing;
}

function inContainer(): boolean {
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return true;
  try {
    return /docker|containerd|kubepods|lxc|podman/.test(readFileSync('/proc/1/cgroup', 'utf8'));
  } catch {
    return false;
  }
}

// Sonames whose Debian package does not follow the generic rule of aptPackage().
const APT_PACKAGES: Array<[RegExp, string]> = [
  [/^lib(nss3|nssutil3|smime3|softokn3)\.so/, 'libnss3'],
  [/^lib(nspr4|plc4|plds4)\.so/, 'libnspr4'],
  [/^lib(glib|gobject|gio|gmodule|gthread)-2\.0\.so/, 'libglib2.0-0'],
  [/^libatk-1\.0\.so/, 'libatk1.0-0'],
  [/^libatk-bridge-2\.0\.so/, 'libatk-bridge2.0-0'],
  [/^libatspi\.so/, 'libatspi2.0-0'],
];

/**
 * The Debian package that ships a shared library: a known name, else the
 * soname lowercased with its major version appended (`libXdamage.so.1` is
 * `libxdamage1`, `libX11.so.6` is `libx11-6`).
 */
export function aptPackage(library: string): string {
  if (!library.includes('.so')) return library;
  const known = APT_PACKAGES.find(([pattern]) => pattern.test(library));
  if (known) return known[1];
  const match = library.match(/^(lib[^.]+(?:\.\d+)*?)\.so(?:\.(\d+))?/);
  if (!match?.[1]) return library;
  const base = match[1].toLowerCase();
  const major = match[2] ?? '';
  return /\d$/.test(base) && major ? `${base}-${major}` : `${base}${major}`;
}

/** The Debian Chrome-libraries line plus any further package the launch named. */
export function chromeAptLine(base: string, libraries: string[]): string {
  const have = new Set(base.split(/\s+/));
  if (have.has('libasound2t64')) have.add('libasound2');
  const extra = [...new Set(libraries.map(aptPackage))].filter((name) => !have.has(name));
  return extra.length > 0 ? `${base} ${extra.join(' ')}` : base;
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-count).join(' | ');
}

/**
 * After a failed launch on Linux: the shared libraries `ldd` cannot resolve,
 * then the stderr tail of one direct headless run (the driver hides it).
 */
async function linuxLaunchDiagnosis(browserPath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const ldd = await run('ldd', [browserPath], { env, timeoutMs: 30_000 });
  const notFound = `${ldd.stdout}\n${ldd.stderr}`.split(/\r?\n/).filter((line) => /=>\s+not found/.test(line));
  if (notFound.length > 0) return notFound.join('\n');
  const args = ['--headless', '--disable-gpu', '--dump-dom', 'about:blank'];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const direct = await run(browserPath, args, { env, timeoutMs: 30_000, killTree: true });
  return direct.code === 0 ? '' : `direct launch exit ${direct.code ?? direct.signal}: ${direct.stderr}`;
}

/** Free gigabytes on the volume holding `target` (or its nearest existing folder). */
export function freeGb(target: string): number {
  let at = path.resolve(target);
  while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const stats = statfsSync(at);
  return (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3;
}

async function toolVersion(tool: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ version: string | null; output: string }> {
  const result = await run(tool, args, { env, timeoutMs: 30_000 });
  if (result.spawnError || result.code !== 0) return { version: null, output: '' };
  const firstLine = result.stdout.split(/\r?\n/)[0]?.trim() ?? '';
  const version = firstLine.match(/version\s+(\S+)/i)?.[1] ?? firstLine;
  return { version, output: result.stdout };
}

export function cliCopyDir(cacheRoot: string, version = CLI_VERSION): string {
  return path.join(cacheRoot, 'cli', version);
}

export function cliCopyEntry(cacheRoot: string, version = CLI_VERSION): string {
  return path.join(cliCopyDir(cacheRoot, version), 'node_modules', 'mf-motion', 'dist', 'cli.mjs');
}

function cliCopyReady(cacheRoot: string): boolean {
  const manifest = path.join(cliCopyDir(cacheRoot), 'node_modules', 'mf-motion', 'package.json');
  if (!existsSync(manifest) || !existsSync(cliCopyEntry(cacheRoot))) return false;
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version === CLI_VERSION;
}

/** Install the pinned CLI into <cache>/cli/<version>/ from npm or a local tarball. */
async function installCliCopy(cacheRoot: string, options: DoctorOptions): Promise<void> {
  const dir = cliCopyDir(cacheRoot);
  mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  await withLock(
    `${dir}.lock`,
    async () => {
      if (cliCopyReady(cacheRoot)) return;
      const spec = options.cliTarball ? path.resolve(options.cwd ?? process.cwd(), options.cliTarball) : `mf-motion@${CLI_VERSION}`;
      if (options.cliTarball && !existsSync(spec)) {
        throw new MfmError('USAGE', { flag: '--cli-tarball', value: options.cliTarball }, { message: `No tarball at ${spec}.` });
      }
      options.onProgress?.(`Installing mf-motion ${CLI_VERSION} into ${dir}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'mf-motion-cli-copy', private: true }, null, 2)}\n`);
      const env = engineEnv({ engineDir: dir, parent: options.env ?? process.env, forInstall: true });
      const result = await run(process.execPath, [npmCli(options.env ?? process.env), 'install', '--prefix', dir, spec, '--no-audit', '--no-fund', '--omit=dev'], {
        cwd: dir,
        env,
        timeoutMs: 15 * 60 * 1000,
        killTree: true,
      });
      if (result.code !== 0 || !cliCopyReady(cacheRoot)) {
        throw new MfmError('TOOL_FAILED', { step: 'cli copy', code: result.code, stderrTail: result.stderr.slice(-2000) }, {
          message: `Installing mf-motion ${CLI_VERSION} into the cache failed.`,
        });
      }
    },
    { command: 'doctor --fix', ...(options.onWarn ? { onStale: options.onWarn } : {}) },
  );
}

async function chromeLaunch(engine: Engine, browserPath: string): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-doctor-'));
  try {
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>doctor</title>');
    const version = await withPage({ dir, width: 64, height: 64, composition: false, engine, browserPath }, async (page) => {
      const two = await page.evaluate(() => 1 + 1);
      if (two !== 2) throw new Error('evaluate returned an unexpected value');
      return page.evaluate(() => navigator.userAgent);
    });
    return { ok: true, version: version.match(/HeadlessChrome\/(\S+)/)?.[1] ?? version };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `${error.message}\n${String((error as { details?: unknown }).details ?? '')}` : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function whisperInstallEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'darwin') return env;
  // On macOS HyperFrames prefers brew when it is visible. Use its pinned
  // source build instead, retaining any build tools linked alongside brew.
  const hasBrew = (dir: string) => existsSync(path.join(dir, 'brew'));
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute);
  const safe = dirs.flatMap((dir) => {
    if (!hasBrew(dir)) return [dir];
    return ['git', 'cmake', 'cc', 'c++'].flatMap((tool) => {
      const bin = path.join(dir, tool);
      if (!existsSync(bin)) return [];
      const realDir = path.dirname(realpathSync(bin));
      return hasBrew(realDir) ? [] : [realDir];
    });
  });
  return { ...env, PATH: [...new Set(safe)].join(path.delimiter) };
}

export async function transcribeModelCheck(
  engine: Engine | null,
  options: { fix: boolean; env: NodeJS.ProcessEnv },
): Promise<Check> {
  const row = { id: 'transcribe-model', need: 'verified local Whisper models for English and multilingual transcription' };
  const repair = `${WHISPER_FIX} --json`;
  if (!engine) return { ...row, status: options.fix ? 'missing' : 'optional', found: null, fix: repair };
  const check = async (): Promise<Check> => {
    try {
      const missing: string[] = [];
      for (const model of WHISPER_DEFAULTS) {
        if (!(await verifiedWhisperModel(engine, model))) missing.push(model);
      }
      if (options.fix) {
        const dir = mkdtempSync(path.join(tmpdir(), 'mfm-whisper-probe-'));
        try {
          const clip = path.join(dir, 'probe.wav');
          const generated = await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '2', clip], {
            env: options.env, timeoutMs: 30_000, killTree: true,
          });
          if (generated.code !== 0) throw new MfmError('TOOL_FAILED', { tool: 'ffmpeg', stderrTail: generated.stderr.slice(-2000) }, { message: 'Could not generate the two-second Whisper probe.' });
          for (const model of missing.length > 0 ? missing : [WHISPER_DEFAULTS[0]]) {
            await callWhisper(engine, clip, { model, cwd: dir, parent: whisperInstallEnv(options.env), runtimeInstall: true });
          }
        } finally {
          rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        }
      } else if (missing.length > 0) {
        return { ...row, status: 'optional', found: null, fix: repair };
      }
      return { ...row, status: 'ok', found: WHISPER_DEFAULTS.join(', '), fix: null };
    } catch (error) {
      if (isMfmError(error) && error.code === 'MODEL_HASH_MISMATCH') {
        if (options.fix) throw error;
        return { ...row, status: 'missing', found: `${error.code}: ${String(error.details.model)}`, fix: repair };
      }
      throw error;
    }
  };
  return options.fix ? withLock(path.join(engine.dir, 'whisper-install.lock'), check, { command: WHISPER_FIX }) : check();
}

/** One line that makes the cache private: use the default cache, or remove group/other write from our own folder. */
function privateCacheFix(unsafe: string, env: NodeJS.ProcessEnv): string {
  const { MF_MOTION_CACHE: configured, ...rest } = env;
  const fallback = cacheDir({ env: rest });
  if (configured && unsafeCacheAncestor(path.join(fallback, 'engine')) === null) return `unset MF_MOTION_CACHE  # uses ${fallback}`;
  let owned = false;
  try {
    owned = statSync(unsafe).uid === process.getuid?.();
  } catch {
    owned = false;
  }
  return owned ? `chmod go-w '${unsafe.replace(/'/g, "'\\''")}'` : 'Set MF_MOTION_CACHE to a folder only you can write (mode 700 on every folder above it).';
}

/** Run the checks (and with `fix`, the cache installs) and return doctor's data. */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorData> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const release = options.osRelease === undefined ? (platform === 'linux' ? readOsRelease() : null) : options.osRelease;
  const os: FixOs = detectFixOs(platform, release);
  const fixFor = (need: Parameters<typeof fixLine>[0]) => fixLine(need, os, release);
  const cacheRoot = cacheDir({ env, ...(options.cwd ? { cwd: options.cwd } : {}) });
  const home = dataHome({ flag: options.home, env, ...(options.cwd ? { cwd: options.cwd } : {}) });
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);
  if (options.fix && options.offline) {
    throw new MfmError('USAGE', { flag: '--offline' }, { message: '--fix needs the network; --offline cannot be combined with it.', hint: 'Run `mf-motion doctor --fix --json` while online, then `mf-motion doctor --offline --json`.' });
  }

  // 1. Node and npm.
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add({ id: 'node', status: nodeMajor >= 22 ? 'ok' : 'missing', found: process.versions.node, need: 'Node.js 22 or newer (24 recommended)', fix: nodeMajor >= 22 ? null : fixFor('node') });
  let npmVersion: string | null = null;
  try {
    npmVersion = (await toolVersion(process.execPath, [npmCli(env), '--version'], env)).version;
  } catch {
    npmVersion = null;
  }
  add({ id: 'npm', status: npmVersion ? 'ok' : 'missing', found: npmVersion, need: 'npm (ships with Node.js)', fix: npmVersion ? null : fixFor('node') });

  // 2. FFmpeg and FFprobe, then their encoders and filters.
  const ffmpeg = await toolVersion('ffmpeg', ['-hide_banner', '-version'], env);
  const ffprobe = await toolVersion('ffprobe', ['-hide_banner', '-version'], env);
  add({ id: 'ffmpeg', status: ffmpeg.version ? 'ok' : 'missing', found: ffmpeg.version, need: 'FFmpeg on PATH', fix: ffmpeg.version ? null : fixFor('ffmpeg') });
  add({ id: 'ffprobe', status: ffprobe.version ? 'ok' : 'missing', found: ffprobe.version, need: 'FFprobe on PATH', fix: ffprobe.version ? null : fixFor('ffmpeg') });
  let encoders = new Set<string>();
  let filters = new Set<string>();
  if (ffmpeg.version) {
    encoders = parseEncoders((await run('ffmpeg', ['-hide_banner', '-encoders'], { env, timeoutMs: 30_000 })).stdout);
    filters = parseFilters((await run('ffmpeg', ['-hide_banner', '-filters'], { env, timeoutMs: 30_000 })).stdout);
  }
  for (const encoder of REQUIRED_ENCODERS) {
    const ok = encoders.has(encoder);
    add({ id: `ffmpeg-encoder:${encoder}`, status: ok ? 'ok' : 'missing', found: ok ? encoder : null, need: `FFmpeg encoder ${encoder}`, fix: ok ? null : fixFor('ffmpeg') });
  }
  for (const filter of REQUIRED_FILTERS) {
    const ok = filters.has(filter);
    add({ id: `ffmpeg-filter:${filter}`, status: ok ? 'ok' : 'missing', found: ok ? filter : null, need: `FFmpeg filter ${filter}`, fix: ok ? null : fixFor('ffmpeg') });
  }

  // 3. The pinned CLI copy the skill runs through.
  if (options.fix) {
    try {
      await installCliCopy(cacheRoot, options);
    } catch (error) {
      options.onWarn?.(error instanceof Error ? error.message : String(error));
    }
  }
  const cliReady = cliCopyReady(cacheRoot);
  add({ id: 'cli', status: cliReady ? 'ok' : 'missing', found: cliReady ? CLI_VERSION : null, need: `mf-motion ${CLI_VERSION} in ${cliCopyDir(cacheRoot)}`, fix: cliReady ? null : 'mf-motion doctor --fix --json' });

  // 4. Engine for the pinned version.
  const pins = enginePins();
  const unsafe = unsafeCacheAncestor(path.join(cacheRoot, 'engine'));
  let engine: Engine | null = null;
  if (options.fix) {
    try {
      engine = await ensureEngine(pins.hyperframes, { cacheRoot, env, ...(options.onProgress ? { onProgress: options.onProgress } : {}), ...(options.onWarn ? { onStale: options.onWarn } : {}) });
    } catch (error) {
      options.onWarn?.(error instanceof Error ? error.message : String(error));
    }
  }
  const engineDir = engineDirFor(cacheRoot, pins.hyperframes);
  if (!engine && engineReady(engineDir)) engine = { version: pins.hyperframes, dir: engineDir };
  add({
    id: 'engine',
    status: engine ? 'ok' : 'missing',
    found: engine ? pins.hyperframes : null,
    need: `hyperframes ${pins.hyperframes} (with gsap ${pins.gsap}, three ${pins.three}) in ${engineDir}`,
    fix: engine ? null : 'mf-motion doctor --fix --json',
  });

  // 5. Chrome via the engine, with one real headless launch.
  let browserPath: string | null = engine ? (readOk(engine.dir)?.browserPath ?? null) : null;
  if (options.fix && engine && unsafe === null) {
    try {
      browserPath = await ensureBrowser(engine);
    } catch (error) {
      options.onWarn?.(error instanceof Error ? error.message : String(error));
    }
  }
  let chromeVersion: string | null = null;
  if (unsafe !== null) {
    add({
      id: 'chrome',
      status: 'missing',
      found: null,
      need: `a private cache folder (the engine refuses ${unsafe}, which other accounts can write)`,
      fix: privateCacheFix(unsafe, env),
    });
  } else if (!engine || !browserPath || !existsSync(browserPath)) {
    add({ id: 'chrome', status: 'missing', found: null, need: 'Chrome headless shell from the engine', fix: 'mf-motion doctor --fix --json' });
  } else {
    const chromeFix = (libraries: string[]): string => {
      if (platform !== 'linux') return 'mf-motion doctor --fix --json';
      const line = fixFor('chrome-libs');
      if (!line) return 'mf-motion doctor --fix --json';
      return os === 'debian' ? chromeAptLine(line, libraries) : line;
    };
    const launch = await chromeLaunch(engine, browserPath);
    if (launch.ok) {
      chromeVersion = launch.version;
      const root = process.getuid?.() === 0;
      add({
        id: 'chrome',
        status: root && inContainer() ? 'warn' : 'ok',
        found: launch.version,
        need: 'Chrome headless shell that launches',
        fix: null,
      });
      if (root && inContainer()) options.onWarn?.('Chrome runs with --no-sandbox because doctor runs as root in a container.');
    } else {
      const diagnosis = platform === 'linux' ? await linuxLaunchDiagnosis(browserPath, env) : '';
      const libraries = missingLibraries(`${launch.error}\n${diagnosis}`);
      add({
        id: 'chrome',
        status: 'missing',
        found: libraries.length > 0 ? `missing libraries: ${libraries.join(', ')}` : [launch.error.split('\n')[0], lastLines(diagnosis, 6)].filter(Boolean).join(' | ') || null,
        need: 'Chrome headless shell that launches',
        fix: chromeFix(libraries),
      });
    }
  }

  // 6. Free disk on the data home's and the cache's volumes.
  const volumes = [home, cacheRoot].map((target) => ({ path: target, freeGb: freeGb(target) }));
  const tightest = volumes.reduce((a, b) => (b.freeGb < a.freeGb ? b : a));
  const diskStatus: CheckStatus = tightest.freeGb < DISK_FAIL_GB ? 'missing' : tightest.freeGb < DISK_WARN_GB ? 'warn' : 'ok';
  add({
    id: 'disk',
    status: diskStatus,
    found: `${tightest.freeGb.toFixed(1)} GB free at ${tightest.path}`,
    need: `at least ${DISK_FAIL_GB} GB free (${DISK_WARN_GB} GB recommended)`,
    fix: diskStatus === 'ok' ? null : 'mf-motion clean --cache all --dry-run --json',
  });

  // 7. Fonts: bundled set, then the optional CJK and emoji families.
  if (options.fix && options.fonts && options.fonts.length > 0) {
    try {
      await fetchFonts(options.fonts, { cacheDir: cacheRoot, env, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    } catch (error) {
      options.onWarn?.(error instanceof Error ? error.message : String(error));
    }
  }
  const known = families({ cacheDir: cacheRoot, env });
  const bundledMissing = known.filter((family) => family.source === 'bundled' && !family.installed).map((family) => family.id);
  add({
    id: 'fonts',
    status: bundledMissing.length === 0 ? 'ok' : 'missing',
    found: bundledMissing.length === 0 ? `${FAMILY_SPECS.filter((spec) => spec.source === 'bundled').length} families in ${bundledFontsDir()}` : `missing: ${bundledMissing.join(', ')}`,
    need: 'the bundled OFL fonts',
    fix: bundledMissing.length === 0 ? null : `npm install -g mf-motion@${CLI_VERSION}`,
  });
  for (const group of ['cjk', 'emoji'] as const) {
    const members = known.filter((family) => family.group === group);
    const installed = members.every((family) => family.installed);
    add({
      id: `fonts-${group}`,
      status: installed ? 'ok' : 'optional',
      found: installed ? members.map((family) => family.id).join(', ') : null,
      need: group === 'cjk' ? 'CJK fonts (Chinese, Japanese, Korean copy)' : 'colour emoji font',
      fix: installed ? null : `mf-motion doctor --fix --fonts ${group} --json`,
    });
  }

  // 8. Optional yt-dlp and transcription model.
  const ytdlp = await toolVersion('yt-dlp', ['--version'], env);
  add({ id: 'yt-dlp', status: ytdlp.version ? 'ok' : 'optional', found: ytdlp.version, need: 'yt-dlp for reference links (local files work without it)', fix: ytdlp.version ? null : fixFor('yt-dlp') });
  add(await transcribeModelCheck(unsafe === null ? engine : null, {
    fix: options.fix === true && options.transcribe === true,
    env,
  }));

  // 9. Local voice runtime: optional until installed; `missing` only when an install or its files fail.
  add(
    await voiceCheck({
      cacheRoot,
      engine: unsafe === null ? engine : null,
      fix: options.fix === true && options.voice === true,
      offline: options.offline === true,
      env,
      platform,
      pythonFix: fixFor('python'),
      ...(options.voiceLockFile !== undefined ? { lockFile: options.voiceLockFile } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    }),
  );

  // 10. Cloud keys: present keys never reach engine calls unless a module is enabled.
  const present = CLOUD_CREDENTIALS.filter((name) => (env[name] ?? '') !== '');
  add({
    id: 'cloud-keys',
    status: present.length > 0 ? 'warn' : 'ok',
    found: present.length > 0 ? `${present.join(', ')} present, stripped from engine calls unless a module is enabled` : null,
    need: 'no cloud keys needed; cloud modules are off by default',
    fix: null,
  });

  const ok = checks.every((check) => check.status !== 'missing');
  const launcher = cliReady ? [process.execPath, cliCopyEntry(cacheRoot)] : ['npx', '--prefer-offline', '-y', `mf-motion@${CLI_VERSION}`];
  return {
    ok,
    launcher,
    checks,
    disk: { freeGb: Math.round(tightest.freeGb * 10) / 10, path: tightest.path },
    engine: { version: engine ? pins.hyperframes : null, path: engine ? engine.dir : null },
    chrome: { version: chromeVersion, path: browserPath },
  };
}

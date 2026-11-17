// The real engine for tests: installed once into MF_MOTION_CACHE (or the
// repository's git-ignored .cache/mf-motion) and reused by every test run.
// The engine refuses a cache folder that other accounts can write (it would
// switch to a cache in the user's home); when the configured folder sits under
// such a folder, tests use a private folder in the OS temp directory instead.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Engine, ensureBrowser, ensureEngine, packageRoot, readOk, unsafeCacheAncestor } from '../../src/engine/index';

function configuredCacheRoot(): string {
  const fromEnv = process.env.MF_MOTION_CACHE;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(packageRoot(), '..', '..', '.cache', 'mf-motion');
}

/** Cache root for test engine installs; never the user's own cache. */
export function testCacheRoot(): string {
  const configured = configuredCacheRoot();
  if (unsafeCacheAncestor(path.join(configured, 'engine')) === null) return configured;
  const uid = process.getuid?.() ?? 'user';
  const fallback = path.join(tmpdir(), `mf-motion-test-cache-${uid}`);
  mkdirSync(fallback, { recursive: true, mode: 0o700 });
  return fallback;
}

let pending: Promise<Engine> | undefined;

/** Install (first call) or reuse the pinned engine. */
export function testEngine(): Promise<Engine> {
  pending ??= ensureEngine(undefined, { cacheRoot: testCacheRoot(), env: process.env });
  return pending;
}

let pendingBrowser: Promise<string> | undefined;

/** The pinned engine with its Chrome ensured (downloads Chrome once per cache). */
export function testBrowser(): Promise<{ engine: Engine; browserPath: string }> {
  pendingBrowser ??= testEngine().then(async (engine) => readOk(engine.dir)?.browserPath ?? ensureBrowser(engine));
  return pendingBrowser.then(async (browserPath) => ({ engine: await testEngine(), browserPath }));
}

/** Help text normalised for comparison: no colour codes, no trailing spaces, no blank tail. */
export function normalizeHelp(text: string): string {
  return `${text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()}\n`;
}

/** Engine commands whose help is recorded, as argument lists. */
export const HELP_COMMANDS: Record<string, string[]> = {
  check: ['check'],
  snapshot: ['snapshot'],
  render: ['render'],
  capture: ['capture'],
  audio: ['audio'],
  tts: ['tts'],
  transcribe: ['transcribe'],
  'remove-background': ['remove-background'],
  browser: ['browser'],
};

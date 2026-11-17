// The real engine for tests: installed once into MF_MOTION_CACHE (or the
// repository's git-ignored .cache/mf-motion) and reused by every test run.
import path from 'node:path';
import { type Engine, ensureEngine, packageRoot } from '../../src/engine/index';

/** Cache root for test engine installs; never the user's own cache. */
export function testCacheRoot(): string {
  const fromEnv = process.env.MF_MOTION_CACHE;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(packageRoot(), '..', '..', '.cache', 'mf-motion');
}

let pending: Promise<Engine> | undefined;

/** Install (first call) or reuse the pinned engine. */
export function testEngine(): Promise<Engine> {
  pending ??= ensureEngine(undefined, { cacheRoot: testCacheRoot(), env: process.env });
  return pending;
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

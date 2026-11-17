// The real pinned engine, installed into the test cache once per run.
// Set MFM_RECORD_ENGINE_HELP=1 to (re)record the help fixtures after a pin change.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Engine, engineCommand, engineHelp, engineVersion, enginePins, ensureEngine, packageRoot, readOk } from '../../../src/engine/index';
import { HELP_COMMANDS, normalizeHelp, testCacheRoot, testEngine } from '../../helpers/engine';

let engine: Engine;
const fixtures = path.join(packageRoot(), 'src', 'engine', 'fixtures', `help-${enginePins().hyperframes}`);

beforeAll(async () => {
  engine = await testEngine();
}, 600_000);

describe('installed engine', () => {
  it('lives in the per-version cache folder with a valid .ok', () => {
    expect(engine.dir).toBe(path.join(testCacheRoot(), 'engine', `hf-${enginePins().hyperframes}`));
    const ok = readOk(engine.dir);
    expect(ok).toMatchObject({ nodeVersion: expect.any(String), lockSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    for (const name of ['hyperframes', 'gsap', 'three', 'puppeteer-core']) {
      expect(existsSync(path.join(engine.dir, 'node_modules', name, 'package.json')), name).toBe(true);
    }
  });

  it('runs --version through node and the bin entry, without a shell', async () => {
    const [node, entry] = engineCommand(engine, ['--version']);
    expect(node).toBe(process.execPath);
    expect(entry?.endsWith(path.join('hyperframes', 'bin', 'hyperframes.mjs'))).toBe(true);
    expect(await engineVersion(engine)).toBe(enginePins().hyperframes);
  });

  it('prints the help recorded in the fixtures', async () => {
    const record = process.env.MFM_RECORD_ENGINE_HELP === '1';
    if (record) mkdirSync(fixtures, { recursive: true });
    for (const [name, command] of Object.entries(HELP_COMMANDS)) {
      const live = normalizeHelp(await engineHelp(engine, command));
      const file = path.join(fixtures, `${name}.txt`);
      if (record) writeFileSync(file, live);
      expect(live, name).toBe(readFileSync(file, 'utf8'));
    }
  });
});

describe('ensureEngine', () => {
  it('reinstalls when .ok is corrupted', async () => {
    const cacheRoot = path.join(testCacheRoot(), 'reinstall-test');
    const first = await ensureEngine(undefined, { cacheRoot, env: process.env });
    const marker = path.join(first.dir, 'node_modules', 'hyperframes', 'reinstall-marker.txt');
    writeFileSync(marker, 'from the first install');
    const again = await ensureEngine(undefined, { cacheRoot, env: process.env });
    expect(existsSync(marker)).toBe(true);
    expect(again.dir).toBe(first.dir);
    writeFileSync(path.join(first.dir, '.ok'), '{ corrupted');
    const before = statSync(path.join(first.dir, 'node_modules', 'hyperframes', 'package.json')).mtimeMs;
    const reinstalled = await ensureEngine(undefined, { cacheRoot, env: process.env });
    expect(reinstalled.dir).toBe(first.dir);
    expect(existsSync(marker)).toBe(false);
    expect(readOk(reinstalled.dir)).not.toBeNull();
    expect(statSync(path.join(first.dir, 'node_modules', 'hyperframes', 'package.json')).mtimeMs).toBeGreaterThanOrEqual(before);
    rmSync(cacheRoot, { recursive: true, force: true });
  }, 600_000);

  it('refuses an engine version this CLI does not pin', async () => {
    await expect(ensureEngine('0.0.1', { cacheRoot: path.join(testCacheRoot(), 'never'), env: process.env })).rejects.toMatchObject({
      code: 'ENGINE_MISSING',
    });
  });
});

// Local voice runtime: the lock covers every matrix target, the model manifest
// equals the installed engine's own pins, engine calls get the venv Python only
// from a valid private install record, and the row is optional without Python.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { VOICE_FIX, lockTargetFor, pythonCandidates, readManifest, sealPrivate, venvPythonPath, voiceCheck } from '../../../src/doctor/voice';
import { engineEnv, enginePins, packageRoot, voiceAssets } from '../../../src/engine/index';
import { testEngine } from '../../helpers/engine';

interface LockScript {
  TOP_LEVEL: Record<string, string>;
  PYTHONS: string[];
  TARGETS: Array<{ id: string; python: string; sysPlatform: string; machine: string }>;
}

interface LockJson {
  lockSha256: string;
  topLevel: Record<string, string>;
  targets: Array<{ id: string; python: string; sysPlatform: string; machine: string; packages?: Record<string, string>; unsupported?: string }>;
  packages: Record<string, Record<string, { hashes: string[] }>>;
}

interface LockEntry {
  name: string;
  version: string;
  marker: string | null;
  hashes: string[];
}

const assets = voiceAssets();
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
let script: LockScript;

beforeAll(async () => {
  script = (await import(pathToFileURL(path.join(packageRoot(), 'scripts', 'voice-lock.mjs')).href)) as LockScript;
});

/** requirements.lock as entries: one per `name==version`, continuation lines joined. */
function parseLock(text: string): LockEntry[] {
  const logical = text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return logical.map((line) => {
    const match = line.match(/^([a-z0-9-]+)==(\S+)(?:\s*;\s*(.*?))?\s+((?:--hash=sha256:[0-9a-f]{64}\s*)+)$/);
    if (!match) throw new Error(`Unexpected lock line: ${line}`);
    return {
      name: match[1] ?? '',
      version: match[2] ?? '',
      marker: match[3] ?? null,
      hashes: [...(match[4] ?? '').matchAll(/--hash=sha256:([0-9a-f]{64})/g)].map((hash) => hash[1] ?? ''),
    };
  });
}

/** The marker forms voice-lock.mjs writes: none, or an `or` of target clauses. */
function markerMatches(marker: string | null, target: { python: string; sysPlatform: string; machine: string }): boolean {
  if (marker === null) return true;
  return marker.split(' or ').some((clause) => {
    const terms = clause.replace(/^\(|\)$/g, '').split(' and ');
    const values: Record<string, string> = {};
    for (const term of terms) {
      const match = term.match(/^(python_version|sys_platform|platform_machine) == "([^"]+)"$/);
      if (!match) throw new Error(`Unexpected marker term: ${term}`);
      values[match[1] ?? ''] = match[2] ?? '';
    }
    return values.python_version === target.python && values.sys_platform === target.sysPlatform && values.platform_machine === target.machine;
  });
}

describe('voice lock', () => {
  const lockText = readFileSync(assets.lock, 'utf8');
  const lockJson = JSON.parse(readFileSync(assets.lockJson, 'utf8')) as LockJson;
  const entries = parseLock(lockText);

  it('records every matrix target: CPython 3.11-3.13 on Linux, macOS and Windows', () => {
    expect(script.PYTHONS).toEqual(['3.11', '3.12', '3.13']);
    expect(lockJson.targets.map((target) => target.id)).toEqual(script.TARGETS.map((target) => target.id));
    expect(new Set(script.TARGETS.map((target) => `${target.sysPlatform}-${target.machine}`))).toEqual(
      new Set(['linux-x86_64', 'linux-aarch64', 'darwin-arm64', 'darwin-x86_64', 'win32-AMD64']),
    );
    expect(lockJson.topLevel).toEqual(script.TOP_LEVEL);
    expect(lockJson.lockSha256).toBe(sha256(lockText));
  });

  it('gives each supported target exactly its resolved set, with the top-level pins, one version per package', () => {
    const supported = lockJson.targets.filter((target) => target.packages);
    expect(supported.length).toBeGreaterThan(0);
    for (const target of lockJson.targets.filter((t) => !t.packages)) expect(target.unsupported, target.id).toBeTruthy();
    for (const target of supported) {
      const picked = entries.filter((entry) => markerMatches(entry.marker, target));
      expect(new Set(picked.map((entry) => entry.name)).size, target.id).toBe(picked.length);
      expect(Object.fromEntries(picked.map((entry) => [entry.name, entry.version]).sort()), target.id).toEqual(target.packages);
      for (const [name, version] of Object.entries(script.TOP_LEVEL)) expect(target.packages?.[name], `${target.id} ${name}`).toBe(version);
    }
  });

  it('hashes every wheel of every pinned version and uses every entry', () => {
    const supported = lockJson.targets.filter((target) => target.packages);
    for (const entry of entries) {
      expect(entry.hashes.length, entry.name).toBeGreaterThan(0);
      expect(entry.hashes, `${entry.name} ${entry.version}`).toEqual(lockJson.packages[entry.name]?.[entry.version]?.hashes);
      expect(supported.some((target) => markerMatches(entry.marker, target)), `${entry.name} ${entry.version}`).toBe(true);
    }
  });
});

describe('voice manifest', () => {
  it('equals the Kokoro file pins of the installed engine', async () => {
    const engine = await testEngine();
    const dist = path.join(engine.dir, 'node_modules', 'hyperframes', 'dist');
    const source = readdirSync(dist)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(path.join(dist, name), 'utf8'))
      .find((text) => text.includes('var MODEL_PINS') && text.includes('var VOICES_PIN'));
    expect(source, 'engine TTS pins').toBeDefined();
    const model = source?.match(/"kokoro-v1\.0":\s*\{\s*name:\s*"([^"]+)",\s*bytes:\s*(\d+),\s*sha256:\s*"([0-9a-f]{64})"/);
    const voices = source?.match(/var VOICES_PIN = \{\s*name:\s*"([^"]+)",\s*bytes:\s*(\d+),\s*sha256:\s*"([0-9a-f]{64})"/);
    expect(source).toMatch(/join\(CACHE_DIR, "models"\)/);
    expect(source).toMatch(/join\(CACHE_DIR, "voices"\)/);
    const manifest = readManifest();
    expect(manifest.engineVersion).toBe(enginePins().hyperframes);
    expect(manifest.files.map(({ path: file, bytes, sha256: hash }) => ({ file, bytes, hash }))).toEqual([
      { file: `models/${model?.[1]}`, bytes: Number(model?.[2]), hash: model?.[3] },
      { file: `voices/${voices?.[1]}`, bytes: Number(voices?.[2]), hash: voices?.[3] },
    ]);
  }, 600_000);
});

describe('engine environment', () => {
  /** A cache with an engine folder name and a recorded runtime whose venv Python is a plain file. */
  function fakeInstall() {
    const cacheRoot = mkdtempSync(path.join(tmpdir(), 'mfm-voice-env-'));
    const engineDir = path.join(cacheRoot, 'engine', `hf-${enginePins().hyperframes}`);
    const venv = path.join(cacheRoot, 'voice', 'venv');
    const python = venvPythonPath(venv);
    mkdirSync(path.dirname(python), { recursive: true, mode: 0o700 });
    writeFileSync(python, '', { mode: 0o700 });
    const ok = {
      pythonVersion: '3.12.3',
      venvPython: python,
      lockSha256: sha256(readFileSync(assets.lock)),
      manifestSha256: sha256(readFileSync(assets.manifest)),
      engineVersion: enginePins().hyperframes,
    };
    const write = (value: object) => writeFileSync(path.join(cacheRoot, 'voice', '.ok'), JSON.stringify(value), { mode: 0o600 });
    write(ok);
    return { cacheRoot, engineDir, venv, python, ok, write };
  }

  it('adds HYPERFRAMES_PYTHON only from a valid install record', () => {
    const install = fakeInstall();
    expect(engineEnv({ engineDir: install.engineDir, parent: {} }).HYPERFRAMES_PYTHON).toBe(install.python);
    expect(engineEnv({ engineDir: install.engineDir, parent: {}, python: null }).HYPERFRAMES_PYTHON).toBeUndefined();
    expect(engineEnv({ engineDir: install.engineDir, parent: {}, forInstall: true }).HYPERFRAMES_PYTHON).toBeUndefined();
    expect(engineEnv({ engineDir: install.engineDir, parent: {}, python: '/probe/python' }).HYPERFRAMES_PYTHON).toBe('/probe/python');
    install.write({ ...install.ok, lockSha256: '0'.repeat(64) });
    expect(engineEnv({ engineDir: install.engineDir, parent: {} }).HYPERFRAMES_PYTHON).toBeUndefined();
    install.write({ ...install.ok, engineVersion: '0.0.1' });
    expect(engineEnv({ engineDir: install.engineDir, parent: {} }).HYPERFRAMES_PYTHON).toBeUndefined();
    const other = mkdtempSync(path.join(tmpdir(), 'mfm-voice-none-'));
    expect(engineEnv({ engineDir: path.join(other, 'engine', 'hf-1'), parent: {} }).HYPERFRAMES_PYTHON).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('refuses a venv that other accounts can write, until it is sealed', () => {
    const install = fakeInstall();
    chmodSync(install.venv, 0o775);
    expect(engineEnv({ engineDir: install.engineDir, parent: {} }).HYPERFRAMES_PYTHON).toBeUndefined();
    sealPrivate(path.join(install.cacheRoot, 'voice'));
    expect(statSync(install.venv).mode & 0o777).toBe(0o755);
    expect(engineEnv({ engineDir: install.engineDir, parent: {} }).HYPERFRAMES_PYTHON).toBe(install.python);
  });
});

describe('voice row', () => {
  const base = { engine: null, offline: false, pythonFix: 'sudo apt-get install -y python3 python3-venv' };

  it('is optional with the --fix --voice line when nothing is installed, and warns about a stale install', async () => {
    const cacheRoot = mkdtempSync(path.join(tmpdir(), 'mfm-voice-row-'));
    expect(await voiceCheck({ ...base, cacheRoot, fix: false, env: process.env })).toMatchObject({ id: 'voice', status: 'optional', found: null, fix: VOICE_FIX });
    mkdirSync(path.join(cacheRoot, 'voice'), { mode: 0o700 });
    writeFileSync(path.join(cacheRoot, 'voice', '.ok'), JSON.stringify({ lockSha256: 'old' }), { mode: 0o600 });
    expect(await voiceCheck({ ...base, cacheRoot, fix: false, env: process.env })).toMatchObject({ status: 'warn', fix: VOICE_FIX });
  });

  it('is optional with the OS Python line when no Python 3.11-3.13 is on PATH', async () => {
    const cacheRoot = mkdtempSync(path.join(tmpdir(), 'mfm-voice-row-'));
    const emptyPath = mkdtempSync(path.join(tmpdir(), 'mfm-empty-path-'));
    const row = await voiceCheck({ ...base, cacheRoot, fix: true, env: { PATH: emptyPath, SystemRoot: process.env.SystemRoot } });
    expect(row).toMatchObject({ status: 'optional', found: 'no Python 3.11-3.13 on PATH', fix: base.pythonFix });
  });

  it.skipIf(process.platform === 'win32')('is optional with unsupported-platform for a Python the lock does not cover', async () => {
    const cacheRoot = mkdtempSync(path.join(tmpdir(), 'mfm-voice-row-'));
    const bin = mkdtempSync(path.join(tmpdir(), 'mfm-fake-python-'));
    writeFileSync(path.join(bin, 'python3.13'), '#!/bin/sh\necho \'[3, 13, 1, "sunos5", "sparc"]\'\n', { mode: 0o755 });
    const row = await voiceCheck({ ...base, cacheRoot, fix: true, env: { PATH: bin } });
    expect(row.status).toBe('optional');
    expect(row.found).toMatch(/^unsupported-platform: Python 3\.13\.1 on sunos5 sparc$/);
  });

  it('matches interpreters to lock targets and probes the Windows launcher too', () => {
    expect(lockTargetFor({ command: ['python3'], version: '3.12.3', sysPlatform: 'linux', machine: 'x86_64' })?.id).toBe('cp312-linux-x86_64');
    expect(lockTargetFor({ command: ['py', '-3.13'], version: '3.13.0', sysPlatform: 'win32', machine: 'AMD64' })?.id).toBe('cp313-windows-amd64');
    expect(lockTargetFor({ command: ['python3'], version: '3.10.12', sysPlatform: 'linux', machine: 'x86_64' })).toBeNull();
    expect(pythonCandidates('win32').slice(-3)).toEqual([['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11']]);
    expect(pythonCandidates('linux')[0]).toEqual(['python3.13']);
  });
});

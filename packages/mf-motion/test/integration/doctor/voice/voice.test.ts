// The local voice runtime end to end: doctor --fix --voice installs it (a
// second run is a no-op), the engine's tts speaks through it, doctor --offline
// verifies it, a tampered model is caught, a wrong lock hash surfaces pip's
// error, and nothing planted in the user's folder is ever imported.
//
// Needs Python 3.11-3.13 and, on the first run, the network (about 500 MB).
// Without such a Python the suite is skipped, unless MFM_VOICE_REQUIRED=1 (CI).
import { spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { findPython, voiceCheck } from '../../../../src/doctor/voice';
import { npmCli } from '../../../../src/proc/npmBin';
import { tts, voiceDir } from '../../../../src/engine/index';
import { probe } from '../../../../src/media/probe';
import { testBrowser, testCacheRoot, testEngine } from '../../../helpers/engine';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let cli = '';
const cacheRoot = testCacheRoot();
const scratch = mkdtempSync(path.join(tmpdir(), 'mfm-voice-probe-'));
const python = await findPython(scratch, process.env);
const required = process.env.MFM_VOICE_REQUIRED === '1';
let tarball = '';

/** doctor through the built CLI; --fix installs the CLI copy from a local pack, not the registry. */
function doctor(...args: string[]) {
  const fix = args.includes('--fix') ? ['--cli-tarball', tarball] : [];
  const result = spawnSync(process.execPath, [cli, 'doctor', ...args, ...fix, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, MF_MOTION_CACHE: cacheRoot, NO_COLOR: '1' },
    timeout: 3_600_000,
  });
  const json = JSON.parse(result.stdout) as { data: { ok: boolean; checks: Array<{ id: string; status: string; found: string | null; fix: string | null }> } };
  return { code: result.status, data: json.data, voice: json.data.checks.find((check) => check.id === 'voice'), stderr: result.stderr };
}

describe.skipIf(!python && !required)('local voice runtime', () => {
  beforeAll(async () => {
    expect(python, 'Python 3.11-3.13 on PATH (MFM_VOICE_REQUIRED=1)').not.toBeNull();
    const packDir = mkdtempSync(path.join(tmpdir(), 'mfm-doctor-package-'));
    const dist = path.join(packDir, 'dist');
    // The scratch CLI and tarball use the same package layout as the installed CLI.
    const { files } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { files: string[] };
    for (const entry of ['package.json', ...files]) {
      const source = path.join(packageRoot, entry);
      if (entry !== 'dist' && existsSync(source)) cpSync(source, path.join(packDir, entry), { recursive: true });
    }
    const build = spawnSync(process.execPath, ['esbuild.config.mjs', '--outdir', dist], { cwd: packageRoot, encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);
    cli = path.join(dist, 'cli.mjs');
    const pack = spawnSync(process.execPath, [npmCli(), 'pack', '--ignore-scripts'], { cwd: packDir, encoding: 'utf8' });
    expect(pack.status, pack.stderr).toBe(0);
    tarball = path.join(packDir, readdirSync(packDir).find((name) => name.endsWith('.tgz')) ?? '');
    await testBrowser();
  }, 1_800_000);

  it('doctor --fix --voice installs it with voice ok; a second run changes nothing', () => {
    const first = doctor('--fix', '--voice');
    expect(first.voice, first.stderr).toMatchObject({ status: 'ok', fix: null });
    expect(first.code, JSON.stringify(first.data.checks.filter((check) => check.status === 'missing'))).toBe(0);
    const record = path.join(voiceDir(cacheRoot), '.ok');
    const before = statSync(record).mtimeMs;
    const second = doctor('--fix', '--voice');
    expect(second.voice?.status).toBe('ok');
    expect(second.stderr).not.toMatch(/Installing the hash-locked voice packages|Creating the voice venv/);
    expect(statSync(record).mtimeMs).toBe(before);
  }, 3_600_000);

  it('the engine tts speaks a two-line script through it', async () => {
    const engine = await testEngine();
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-voice-tts-'));
    const script = path.join(dir, 'script.txt');
    writeFileSync(script, 'Traces, evals and cost for every run.\nSee every step your agents take.\n');
    const out = path.join(dir, 'voice.wav');
    await tts(engine, script, 'af_heart', out);
    const info = await probe(out);
    expect(info.audio?.codec).toMatch(/^pcm_/);
    expect(info.durationSec).toBeGreaterThan(1.5);
  }, 600_000);

  it('doctor --offline reports voice ok; a tampered model is MODEL_HASH_MISMATCH', async () => {
    const offline = doctor('--offline');
    expect(offline.voice).toMatchObject({ status: 'ok' });
    expect(offline.code).toBe(0);
    const engine = await testEngine();
    const model = path.join(engine.dir, 'hf-cache', 'tts', 'models', 'kokoro-v1.0.onnx');
    const fd = openSync(model, 'r+');
    const byte = Buffer.alloc(1);
    readSync(fd, byte, 0, 1, 4096);
    const original = byte[0] ?? 0;
    try {
      writeSync(fd, Buffer.from([original ^ 0xff]), 0, 1, 4096);
      const tampered = doctor('--offline');
      expect(tampered.voice).toMatchObject({ status: 'missing', found: 'MODEL_HASH_MISMATCH: models/kokoro-v1.0.onnx', fix: 'mf-motion doctor --fix --voice --json' });
      expect(tampered.code).toBe(1);
    } finally {
      writeSync(fd, Buffer.from([original]), 0, 1, 4096);
      closeSync(fd);
    }
    expect(doctor('--offline').voice?.status).toBe('ok');
  }, 600_000);

  it('a wrong lock hash fails with pip’s error, and nothing planted in the working folders is imported', async () => {
    const isolated = mkdtempSync(path.join(tmpdir(), 'mfm-voice-iso-'));
    const markers = path.join(isolated, 'markers');
    mkdirSync(markers);
    const plant = (dir: string) => {
      mkdirSync(path.join(dir, 'pip'), { recursive: true });
      const planted: Array<[string, string]> = [['venv.py', 'venv'], ['json.py', 'json'], ['platform.py', 'platform'], [path.join('pip', '__init__.py'), 'pip']];
      for (const [file, name] of planted) {
        writeFileSync(path.join(dir, file), `open(${JSON.stringify(path.join(markers, `${path.basename(dir)}-${name}`))}, "w").write("imported")\n`);
      }
    };
    const userFolder = path.join(isolated, 'user');
    const cache = path.join(isolated, 'cache');
    mkdirSync(path.join(cache, 'voice'), { recursive: true, mode: 0o700 });
    plant(userFolder);
    plant(path.join(cache, 'voice'));
    const badLock = path.join(isolated, 'bad.lock');
    writeFileSync(badLock, `typing-extensions==4.16.0 \\\n    --hash=sha256:${'0'.repeat(64)}\n`);
    const cwd = process.cwd();
    process.chdir(userFolder);
    let row: Awaited<ReturnType<typeof voiceCheck>>;
    try {
      row = await voiceCheck({ cacheRoot: cache, engine: await testEngine(), fix: true, offline: false, env: process.env, pythonFix: null, lockFile: badLock });
    } finally {
      process.chdir(cwd);
    }
    expect(row.status).toBe('missing');
    expect(row.found).toMatch(/Installing the voice packages failed\..*DO NOT MATCH THE HASHES.*Expected sha256 0{64}/s);
    expect(existsSync(path.join(cache, 'voice', '.ok'))).toBe(false);
    expect(readdirSync(markers)).toEqual([]);
  }, 600_000);
});

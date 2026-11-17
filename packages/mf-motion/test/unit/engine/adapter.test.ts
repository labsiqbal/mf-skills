import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import { CLOUD_CREDENTIALS, callEngine, check, engineCommand } from '../../../src/engine/index';
import { fakeEngine } from './fake-engine';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  for (const name of CLOUD_CREDENTIALS) delete process.env[name];
});

describe('engine calls', () => {
  it('spawn node with the bin entry, never a shim or shell', () => {
    const engine = fakeEngine();
    const [node, entry] = engineCommand(engine, ['--version']);
    expect(node).toBe(process.execPath);
    expect(entry).toBe(path.join(engine.dir, 'node_modules', 'hyperframes', 'bin', 'hyperframes.cjs'));
  });

  it('hand the engine the built environment, with parent credentials stripped', async () => {
    const engine = fakeEngine();
    engine.setMode('env');
    for (const name of CLOUD_CREDENTIALS) process.env[name] = `sentinel-${name}`;
    const { json } = await callEngine(engine, ['info'], { timeoutMs: 10_000, failure: 'RENDER_FAILED' });
    const env = (json as { env: Record<string, string> }).env;
    expect(env.HYPERFRAMES_NO_TELEMETRY).toBe('1');
    expect(env.HYPERFRAMES_NO_UPDATE_CHECK).toBe('1');
    expect(env.HYPERFRAMES_SKIP_SKILLS).toBe('1');
    expect(env.HYPERFRAMES_NO_OPTIONAL_INSTALL).toBe('1');
    expect(env.HYPERFRAMES_CACHE_DIR).toBe(path.join(engine.dir, 'hf-cache'));
    for (const name of CLOUD_CREDENTIALS) expect(env[name], name).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('sentinel-');
  });

  it('map an engine error envelope to RENDER_FAILED or CHECK_FAILED with details.engineCode', async () => {
    const engine = fakeEngine();
    engine.setMode('fail');
    const render = await callEngine(engine, ['render'], { timeoutMs: 10_000, failure: 'RENDER_FAILED' }).catch((error: unknown) => error);
    expect(render).toBeInstanceOf(MfmError);
    expect(render).toMatchObject({ code: 'RENDER_FAILED', details: { engineCode: 'runtime_error', engineHint: 'add index.html' } });
    expect((render as MfmError).exitCode).toBe(5);
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    await expect(check(engine, build)).rejects.toMatchObject({ code: 'CHECK_FAILED', details: { engineCode: 'runtime_error' } });
  });

  it('return a check report with error findings (exit 1, ok false, no error envelope) instead of failing', async () => {
    const engine = fakeEngine();
    engine.setMode('findings');
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    const result = await check(engine, build);
    expect(result).toMatchObject({ errors: 1, warnings: 1, snapshots: ['.hyperframes/artifacts/snapshots/a/frame-00-at-0.2s.png'], findingFiles: ['/abs/finding-00-text_box_overflow.png'] });
    expect(result.findings.map((finding) => finding.code)).toEqual(['text_box_overflow', 'canvas_overflow']);
  });

  it('report output without JSON as ENGINE_OUTPUT_UNPARSEABLE', async () => {
    const engine = fakeEngine();
    engine.setMode('garbage');
    await expect(callEngine(engine, ['check'], { timeoutMs: 10_000, failure: 'CHECK_FAILED' })).rejects.toMatchObject({
      code: 'ENGINE_OUTPUT_UNPARSEABLE',
    });
  });

  it('delete a stray .env in the build folder before the call', async () => {
    const engine = fakeEngine();
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    writeFileSync(path.join(build, '.env'), 'OPENAI_API_KEY=leak\n');
    await callEngine(engine, ['check'], { timeoutMs: 10_000, failure: 'CHECK_FAILED', buildDir: build });
    expect(existsSync(path.join(build, '.env'))).toBe(false);
  });

  it('a 1-second timeout returns TIMEOUT (exit 5) and leaves no process behind', async () => {
    const engine = fakeEngine();
    engine.setMode('sleep');
    const started = Date.now();
    const error = await callEngine(engine, ['render'], { timeoutMs: 1000, failure: 'RENDER_FAILED' }).catch((caught: unknown) => caught);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(error).toBeInstanceOf(MfmError);
    expect((error as MfmError).code).toBe('TIMEOUT');
    expect((error as MfmError).exitCode).toBe(5);
    const pids = JSON.parse(readFileSync(engine.pidsFile, 'utf8')) as { child: number; grandchild: number };
    for (let i = 0; i < 50 && (alive(pids.child) || alive(pids.grandchild)); i += 1) await sleep(100);
    expect(alive(pids.child)).toBe(false);
    expect(alive(pids.grandchild)).toBe(false);
  });
});

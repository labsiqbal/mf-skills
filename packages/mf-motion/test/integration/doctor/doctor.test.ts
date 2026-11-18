// doctor through the built CLI: report, --fix from a local tarball, then --offline.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { npmCli } from '../../../src/proc/npmBin';
import { testBrowser, testCacheRoot } from '../../helpers/engine';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let cli = '';
let tarball = '';

function doctor(env: NodeJS.ProcessEnv, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, 'doctor', ...args, '--json'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env }, timeout: 900_000 });
  return { code: result.status, json: JSON.parse(result.stdout) as { ok: boolean; data: any; next: string[] }, stderr: result.stderr };
}

beforeAll(async () => {
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
}, 900_000);

describe('doctor', () => {
  it('exits 1 with missing rows and a --fix next step on an empty cache', () => {
    const result = doctor({ MF_MOTION_CACHE: mkdtempSync(path.join(tmpdir(), 'mfm-empty-cache-')) });
    expect(result.code).toBe(1);
    expect(result.json.ok).toBe(true);
    expect(result.json.data.ok).toBe(false);
    expect(result.json.next).toEqual(['mf-motion doctor --fix --json']);
    const missing = result.json.data.checks.filter((check: { status: string }) => check.status === 'missing').map((check: { id: string }) => check.id);
    expect(missing).toEqual(expect.arrayContaining(['cli', 'engine', 'chrome']));
  });

  it('--fix --cli-tarball installs the CLI copy and Chrome, exits 0, and --offline then reports ok with a working launcher', () => {
    const env = { MF_MOTION_CACHE: testCacheRoot() };
    const fixed = doctor(env, '--fix', '--cli-tarball', tarball);
    expect(fixed.stderr).not.toContain('error');
    expect(fixed.json.data.checks.filter((check: { status: string }) => check.status === 'missing')).toEqual([]);
    expect(fixed.code).toBe(0);
    expect(fixed.json.data.launcher[1]).toBe(path.join(testCacheRoot(), 'cli', '1.0.0', 'node_modules', 'mf-motion', 'dist', 'cli.mjs'));
    expect(fixed.json.data.chrome.version).toMatch(/^\d+\./);
    const offline = doctor(env, '--offline');
    expect(offline.code).toBe(0);
    expect(offline.json.data.ok).toBe(true);
    const [node, entry] = offline.json.data.launcher as string[];
    expect(existsSync(entry ?? '')).toBe(true);
    const version = spawnSync(node ?? process.execPath, [entry ?? '', 'version', '--json'], { encoding: 'utf8' });
    expect(version.status).toBe(0);
    expect(JSON.parse(version.stdout).data.cli).toBe('1.0.0');
  }, 900_000);
});

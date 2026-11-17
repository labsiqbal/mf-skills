// Spawns a fresh build of the CLI bundle, exactly as users run it.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
const outdir = mkdtempSync(join(tmpdir(), 'mfm-cli-'));
const cli = join(outdir, 'cli.mjs');

function mfm(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function oneJson(stdout: string) {
  expect(stdout.endsWith('\n')).toBe(true);
  expect(stdout.trimEnd().split('\n')).toHaveLength(1);
  return JSON.parse(stdout) as Record<string, any>;
}

beforeAll(() => {
  const build = spawnSync(process.execPath, ['esbuild.config.mjs', '--outdir', outdir], { cwd: packageRoot, encoding: 'utf8' });
  expect(build.stderr).toBe('');
  expect(build.status).toBe(0);
});

describe('mf-motion CLI', () => {
  it('version --json prints one envelope with the version data', () => {
    const result = mfm('version', '--json');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(oneJson(result.stdout)).toEqual({
      ok: true,
      command: 'version',
      cli: pkg.version,
      schemaVersion: 1,
      data: {
        cli: pkg.version,
        engine: { hyperframes: '0.9.61', gsap: '3.15.0', three: '0.187.0' },
        schemas: expect.objectContaining({ profile: 1, project: 1, brand: 1, brief: 1, events: 1 }),
      },
      warnings: [],
      next: [],
    });
  });

  it('--version prints the same facts, as text or JSON', () => {
    const text = mfm('--version');
    expect(text.code).toBe(0);
    expect(text.stdout.split('\n')[0]).toBe(`mf-motion ${pkg.version}`);
    expect(oneJson(mfm('--json', '--version').stdout).data.cli).toBe(pkg.version);
  });

  it('keeps stdout to one JSON document while progress goes to stderr', () => {
    const result = mfm('version', '--json', '--verbose');
    expect(result.code).toBe(0);
    oneJson(result.stdout);
    expect(result.stderr).toContain(`mf-motion ${pkg.version} on Node.js`);
  });

  it('an unknown flag exits 2 with USAGE and a hint naming the flag', () => {
    const json = mfm('version', '--json', '--colour');
    expect(json.code).toBe(2);
    const envelope = oneJson(json.stdout);
    expect(envelope).toMatchObject({ ok: false, command: 'version', error: { code: 'USAGE', details: { flag: '--colour' } } });
    expect(envelope.error.hint).toContain('--colour');
    const text = mfm('version', '--colour');
    expect(text.code).toBe(2);
    expect(text.stdout).toBe('');
    expect(text.stderr).toContain('error USAGE');
    expect(text.stderr).toContain('--colour');
  });

  it('an unknown command exits 2 with USAGE', () => {
    const result = mfm('render-everything', '--json');
    expect(result.code).toBe(2);
    expect(oneJson(result.stdout).error.code).toBe('USAGE');
  });

  it('--help and --json --help describe commands and flags', () => {
    const top = mfm('--help');
    expect(top.code).toBe(0);
    expect(top.stdout).toContain('Usage: mf-motion <command>');
    expect(top.stdout).toContain('version');
    const topJson = oneJson(mfm('--json', '--help').stdout);
    expect(topJson.data.commands.map((c: { name: string }) => c.name)).toContain('version');
    const schema = oneJson(mfm('version', '--json', '--help').stdout);
    expect(schema.ok).toBe(true);
    expect(schema.data.flags).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false });
    expect(Object.keys(schema.data.globalFlags.properties)).toEqual(
      expect.arrayContaining(['json', 'project', 'home', 'quiet', 'verbose', 'no-color', 'help', 'version']),
    );
    expect(schema.data.data.required).toEqual(['cli', 'engine', 'schemas']);
  });

  it('no command is a usage error', () => {
    const result = mfm('--json');
    expect(result.code).toBe(2);
    expect(oneJson(result.stdout).error.code).toBe('USAGE');
  });
});

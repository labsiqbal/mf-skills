import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  type: string;
  bin: Record<string, string>;
  engines: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function node(args: string[], cwd = packageRoot) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: process.env });
}

describe('package contract', () => {
  it('declares the published shape', () => {
    expect(pkg.name).toBe('mf-motion');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ 'mf-motion': 'dist/cli.mjs' });
    expect(pkg.engines.node).toBe('>=22');
    expect(pkg.files).toEqual(['dist', 'assets', 'engine', 'LICENSE', 'THIRD_PARTY.md', 'README.md']);
    for (const script of ['build', 'typecheck', 'test', 'test:unit', 'test:render', 'pack:check', 'licence:check']) {
      expect(pkg.scripts[script], script).toBeTruthy();
    }
  });

  it('pins every dependency to an exact version', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.devDependencies).toMatchObject({ typescript: '7.0.2', esbuild: '0.28.2', vitest: '5.1.0' });
    expect(pkg.devDependencies?.['@types/node']).toMatch(/^24\./);
  });

  it('type-checks strictly', () => {
    const tsconfig = JSON.parse(readFileSync(join(packageRoot, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
    });
  });
});

describe('build', () => {
  const outdir = mkdtempSync(join(tmpdir(), 'mfm-build-'));
  beforeAll(() => {
    const result = node(['esbuild.config.mjs', '--outdir', outdir]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('writes one ESM CLI entry that prints the package version', () => {
    const result = node([join(outdir, 'cli.mjs'), '--json', '--version']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.cli).toBe(pkg.version);
    expect(readFileSync(join(outdir, 'cli.mjs'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});

describe('pack check', () => {
  it('passes for this package', () => {
    const result = node(['scripts/pack-check.mjs']);
    expect(result.stderr).not.toContain('pack-check:');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pack-check: PASS mf-motion@');
  });

  it('fails when a lab/ file or a GSAP file would be packed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mfm-pack-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'pack-fixture', version: '0.0.0', files: ['dist', 'lab'] }),
    );
    mkdirSync(join(dir, 'lab'));
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'lab', 'harness.js'), 'export {};\n');
    writeFileSync(join(dir, 'dist', 'gsap.min.js'), '/* fixture */\n');
    const result = node([join(packageRoot, 'scripts', 'pack-check.mjs'), '--dir', dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lab file packed: lab/harness.js');
    expect(result.stderr).toContain('GSAP file packed: dist/gsap.min.js');
  });
});

describe('licence denylist', () => {
  it('passes for this package', () => {
    const result = node(['scripts/licence-denylist.mjs']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails on a lockfile naming essentia.js', () => {
    const fixture = join(packageRoot, 'test', 'unit', 'scaffold', 'fixtures', 'denied-package-lock.json');
    const result = node(['scripts/licence-denylist.mjs', '--lock', fixture, '--src', join(packageRoot, 'src')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('essentia.js');
  });

  it('fails on source that names a rejected model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mfm-licence-'));
    writeFileSync(join(dir, 'model.ts'), "export const MODEL = 'briaai/RMBG-1.4';\n");
    const result = node([
      'scripts/licence-denylist.mjs',
      '--lock', join(packageRoot, 'package-lock.json'),
      '--src', dir,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('RMBG-1.4');
  });
});

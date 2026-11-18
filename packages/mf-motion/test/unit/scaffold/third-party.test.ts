// THIRD_PARTY.md lists every package esbuild bundles into dist/ and every
// runtime dependency, at the installed version (MFM-096).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
const notice = readFileSync(join(packageRoot, 'THIRD_PARTY.md'), 'utf8');

/** Package name to version from the "Bundled into `dist/`" table. */
function bundledRows(text: string): Map<string, string> {
  const section = text.split(/^## /m).find((part) => part.startsWith('Bundled into `dist/`')) ?? '';
  const rows = new Map<string, string>();
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 4 || cells[1] === 'Package' || /^-+$/.test(cells[1] ?? '')) continue;
    if (cells[1] && cells[2]) rows.set(cells[1], cells[2]);
  }
  return rows;
}

/** Every problem with the notice: a bundled package or dependency missing or at another version. */
function noticeProblems(text: string, bundled: Map<string, string>, dependencies: Record<string, string>): string[] {
  const rows = bundledRows(text);
  const problems: string[] = [];
  for (const [name, version] of [...bundled, ...Object.entries(dependencies)]) {
    const listed = rows.get(name);
    if (listed === undefined) problems.push(`${name} ${version} is missing from THIRD_PARTY.md`);
    else if (listed !== version) problems.push(`${name} is ${version}, THIRD_PARTY.md says ${listed}`);
  }
  return [...new Set(problems)];
}

/** Packages in the bundle (both builds of esbuild.config.mjs), with their installed versions. */
async function bundledPackages(): Promise<Map<string, string>> {
  const common = { absWorkingDir: packageRoot, bundle: true, write: false, metafile: true, logLevel: 'silent' as const };
  const results = await Promise.all([
    build({ ...common, entryPoints: { cli: 'src/cli/main.ts' }, outdir: join(packageRoot, 'dist-metafile'), splitting: true, format: 'esm', platform: 'node', target: 'node22', outExtension: { '.js': '.mjs' } }),
    build({ ...common, entryPoints: ['src/kit/runtime/index.ts'], outfile: join(packageRoot, 'dist-metafile', 'mf-runtime.js'), format: 'iife', platform: 'browser', target: 'chrome120' }),
  ]);
  const found = new Map<string, string>();
  for (const result of results) {
    for (const input of Object.keys(result.metafile?.inputs ?? {})) {
      const dirs = input.match(/node_modules\/(?:@[^/]+\/)?[^/]+/g);
      const last = dirs?.[dirs.length - 1];
      if (!last) continue;
      const name = last.replace(/^node_modules\//, '');
      const manifest = join(packageRoot, input.slice(0, input.lastIndexOf(last) + last.length), 'package.json');
      found.set(name, (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version);
    }
  }
  return found;
}

describe('THIRD_PARTY.md', () => {
  let bundled = new Map<string, string>();
  beforeAll(async () => {
    bundled = await bundledPackages();
  }, 120_000);

  it('lists every bundled package and every runtime dependency at its installed version', () => {
    expect([...bundled.keys()]).toEqual(expect.arrayContaining(['meyda', 'music-tempo', 'wavefile', 'valibot']));
    expect(noticeProblems(notice, bundled, pkg.dependencies ?? {})).toEqual([]);
  });

  it('fails for a copy without the meyda row, or with another meyda version', () => {
    const withoutMeyda = notice.replace(/^\| meyda \|.*\n/m, '');
    expect(withoutMeyda).not.toBe(notice);
    expect(noticeProblems(withoutMeyda, bundled, pkg.dependencies ?? {})).toEqual([`meyda ${bundled.get('meyda')} is missing from THIRD_PARTY.md`]);
    const otherVersion = notice.replace(/^\| meyda \| [^|]+ \|/m, '| meyda | 5.6.3 |');
    expect(noticeProblems(otherVersion, bundled, pkg.dependencies ?? {})).toEqual([`meyda is ${bundled.get('meyda')}, THIRD_PARTY.md says 5.6.3`]);
  });
});

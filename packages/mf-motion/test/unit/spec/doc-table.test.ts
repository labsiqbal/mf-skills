import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const script = join(packageRoot, 'scripts', 'doc-table.mjs');
const fixture = join(packageRoot, 'test', 'unit', 'spec', 'fixtures', 'tables.md');

function docTable(args: string[]) {
  const out = join(mkdtempSync(join(tmpdir(), 'mfm-doc-table-')), 'out.json');
  const result = spawnSync(process.execPath, [script, ...args, '--out', out], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr, json: result.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null };
}

describe('doc-table.mjs', () => {
  it('extracts the first table of a section as rows keyed by header', () => {
    const { status, json } = docTable(['--doc', fixture, '--section', 'Packages (runtime)']);
    expect(status).toBe(0);
    expect(json).toEqual({
      doc: 'tables.md',
      section: 'Packages (runtime)',
      mode: 'table',
      data: [
        { Package: 'alpha', Version: '1.0.0', Use: 'parsing' },
        { Package: 'beta, beta-walk', Version: '2.0.0, 2.1.0', Use: 'escaped | pipe' },
        { Package: 'gamma', Version: '3.0.0', Use: 'code with a|b inside' },
      ],
    });
  });

  it('matches a section by heading prefix when the prefix is unique', () => {
    const { status, json } = docTable(['--doc', fixture, '--section', 'packages']);
    expect(status).toBe(0);
    expect(json.data).toHaveLength(3);
  });

  it('extracts unique inline-code tokens of a section, skipping fenced blocks', () => {
    const { json } = docTable(['--doc', fixture, '--section', 'Packages (runtime)', '--codes']);
    expect(json.mode).toBe('codes');
    expect(json.data).toEqual(['inline-code', 'beta', 'beta-walk', 'a|b', 'ONE', 'TWO', 'one-lower']);
  });

  it('filters codes with --pattern and records the pattern and code binding', () => {
    const { json } = docTable([
      '--doc', fixture, '--section', 'Packages (runtime)', '--codes',
      '--pattern', '^[A-Z]+$', '--code', 'src/example.ts#CODES',
    ]);
    expect(json).toMatchObject({ pattern: '^[A-Z]+$', code: 'src/example.ts#CODES', data: ['ONE', 'TWO'] });
  });

  it('fails with a message for a missing section or a section without a table', () => {
    const missing = docTable(['--doc', fixture, '--section', 'Nope']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('section "Nope" not found');
    const noTable = docTable(['--doc', fixture, '--section', 'Nested heading inside the section']);
    expect(noTable.status).toBe(1);
    expect(noTable.stderr).toContain('has no table');
  });

  const docs = process.env.MFM_SPEC_DOCS;
  it.runIf(docs)('extracts the dependency table of repository-layout.md, one row per package entry', () => {
    const { status, json } = docTable([
      '--doc', join(docs ?? '', 'repository-layout.md'),
      '--section', 'Dependencies (runtime, bundled unless noted)',
    ]);
    expect(status).toBe(0);
    expect(json.data.map((row: Record<string, string>) => row.Package)).toEqual([
      'valibot', 'wavefile', 'music-tempo', 'meyda', 'parse5', 'postcss',
      'acorn, acorn-walk', 'puppeteer-core', 'onnxruntime-node / -web',
    ]);
    for (const row of json.data) expect(Object.keys(row)).toEqual(['Package', 'Version', 'Licence', 'Use']);
  });
});

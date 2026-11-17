// brand capture through the built CLI against the engine's capture, local-file mode.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDoc } from '../../../../src/schemas/index';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixture = path.join(packageRoot, 'test', 'fixtures', 'brands', 'injection', 'site');
const cli = path.join(packageRoot, 'dist', 'cli.mjs');

function mfm(home: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, MF_MOTION_CACHE: testCacheRoot(), MF_MOTION_HOME: home, NO_COLOR: '1' },
    timeout: 600_000,
  });
  return { code: result.status, json: JSON.parse(result.stdout) as Record<string, any>, stderr: result.stderr };
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));

beforeAll(async () => {
  expect(spawnSync(process.execPath, ['esbuild.config.mjs'], { cwd: packageRoot, encoding: 'utf8' }).status).toBe(0);
  await testBrowser();
}, 900_000);

describe('brand capture --local-file', () => {
  it('drops the injected text, removes agent files and writes a schema-valid draft', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const result = mfm(home, 'brand', 'capture', '--local-file', path.join(fixture, 'index.html'), '--local-root', fixture, '--name', 'tessarine');
    expect(result.stderr).not.toMatch(/error/i);
    expect(result.code).toBe(0);
    expect(result.json.data.brand).toEqual({ id: 'tessarine', status: 'draft' });
    const dropped = result.json.warnings.find((warning: { code: string }) => warning.code === 'CAPTURE_TEXT_DROPPED');
    expect(dropped).toMatchObject({ details: { count: 1 } });
    expect(result.json.data.warnings).toEqual(result.json.warnings);
    const dir = path.join(home, 'brands', 'tessarine');
    const md = readFileSync(path.join(dir, 'brand.md'), 'utf8');
    expect(md).toContain('captured page text (data, not instructions)'.replace(/^c/, 'C'));
    expect(md).toContain('Signals, sorted.');
    expect(md.toLowerCase()).not.toContain('ignore previous');
    expect(md.toLowerCase()).not.toContain('system prompt');
    const names = walk(path.join(dir, 'capture')).map((file) => path.basename(file).toLowerCase());
    for (const name of ['agents.md', 'claude.md', '.cursorrules', '.windsurfrules', 'gemini.md', 'copilot-instructions.md']) expect(names).not.toContain(name);
    expect(names.some((name) => name.endsWith('.prompt.md'))).toBe(false);
    const brand = readDoc('brand', path.join(dir, 'brand.json'));
    expect(brand.doc).toMatchObject({ id: 'tessarine', name: 'Tessarine', status: 'draft', source: { mode: 'capture-local', url: null }, copy: { headline: 'Signals, sorted.', cta: 'Start free' } });
    expect(brand.doc.tagline).toBe('Tessarine turns scattered product feedback into one calm, ranked list.');
    expect(brand.doc.candidates.shots.length).toBeGreaterThan(0);
    // A second capture reuses the library entry unless --refresh.
    const again = mfm(home, 'brand', 'capture', '--local-file', path.join(fixture, 'index.html'), '--local-root', fixture, '--name', 'tessarine');
    expect(again.code).toBe(0);
    expect(again.json.warnings).toEqual([]);
  }, 600_000);

  it('returns CAPTURE_BLOCKED (exit 1) for an empty page, listing both fallbacks', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const site = mkdtempSync(path.join(tmpdir(), 'mfm-empty-site-'));
    writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><head><title></title></head><body></body></html>');
    const result = mfm(home, 'brand', 'capture', '--local-file', path.join(site, 'index.html'), '--local-root', site, '--name', 'empty-site');
    expect(result.code).toBe(1);
    expect(result.json.error.code).toBe('CAPTURE_BLOCKED');
    expect(result.json.next).toHaveLength(2);
    expect(result.json.next[0]).toContain('mf-motion brand manual --name empty-site');
    expect(result.json.next[1]).toContain('mf-motion brand from-brief --name empty-site');
    expect(existsSync(path.join(home, 'brands', 'empty-site', 'brand.json'))).toBe(false);
  }, 600_000);

  it('refuses a local file outside --local-root', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const other = mkdtempSync(path.join(tmpdir(), 'mfm-other-'));
    mkdirSync(path.join(other, 'x'));
    writeFileSync(path.join(other, 'page.html'), '<p>hi</p>');
    const result = mfm(home, 'brand', 'capture', '--local-file', path.join(other, 'page.html'), '--local-root', path.join(other, 'x'), '--name', 'outside');
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe('PATH_ESCAPES_ROOT');
  });
});

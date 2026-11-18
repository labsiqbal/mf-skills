// The brand library: reuse, refresh, show, list, use and rm under per-brand locks.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { captureBrand } from '../../../../src/brand/capture';
import { briefBrand } from '../../../../src/brand/fromBrief';
import { manualBrand } from '../../../../src/brand/manual';
import { COMMANDS } from '../../../../src/cli/commands/index';
import type { Engine } from '../../../../src/engine/index';
import { readDoc, writeDoc } from '../../../../src/schemas/index';
import { testBrowser } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const site = path.join(packageRoot, 'test', 'fixtures', 'brands', 'injection', 'site');
const candidatesFixture = path.join(packageRoot, 'test', 'fixtures', 'brands', 'candidates', 'site');

// The CLI reports canonical paths (macOS /private/var, Windows long names).
const temp = (prefix: string) => realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));

async function mfm(home: string, ...args: string[]) {
  const result = await runIn([...args, '--home', home, '--json'], COMMANDS);
  return { code: result.code, json: JSON.parse(result.stdout) as Record<string, any> };
}

function svgFiles(): { logo: string; shots: string[] } {
  const dir = temp('mfm-svgs-');
  const write = (name: string, fill: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${fill}"/></svg>\n`);
    return file;
  };
  return { logo: write('logo.svg', '#F2AA4C'), shots: [write('a.svg', '#111111'), write('b.svg', '#222222'), write('c.svg', '#333333')] };
}

/** A picked brand made with brand manual (SVG files only, so no FFmpeg). */
async function pickedBrand(home: string, id: string) {
  const files = svgFiles();
  return manualBrand({ home, id, logo: files.logo, colors: ['#FFFFFF', '#101820', '#F2AA4C'], shots: files.shots });
}

async function newProject(home: string): Promise<string> {
  const dir = path.join(temp('mfm-projects-'), 'launch');
  const result = await mfm(home, 'new', 'Launch', '--type', 'film', '--dir', dir);
  expect(result.code, JSON.stringify(result.json)).toBe(0);
  return dir;
}

describe('brand list and show', () => {
  it('lists by updatedAt, newest first, and shows one brand', async () => {
    const home = temp('mfm-home-');
    for (const id of ['alpha', 'bravo', 'charlie']) await briefBrand({ home, id, moods: ['calm'] });
    const touch = (id: string, iso: string) => utimesSync(path.join(home, 'brands', id, 'brand.json'), new Date(iso), new Date(iso));
    touch('alpha', '2026-11-10T10:00:00.000Z');
    touch('bravo', '2026-11-12T10:00:00.000Z');
    touch('charlie', '2026-11-11T10:00:00.000Z');
    const list = await mfm(home, 'brand', 'list');
    expect(list.code).toBe(0);
    expect(list.json.data.brands.map((brand: { id: string }) => brand.id)).toEqual(['bravo', 'charlie', 'alpha']);
    expect(list.json.data.brands[0]).toEqual({
      id: 'bravo',
      name: 'Bravo',
      status: 'draft',
      source: { mode: 'from-brief', url: null, capturedAt: null, engine: null },
      updatedAt: '2026-11-12T10:00:00.000Z',
    });

    writeFileSync(path.join(home, 'brands', 'alpha', 'brand.json'), '{"kind":"brand"}');
    const damaged = await mfm(home, 'brand', 'list');
    expect(damaged.json.data.brands).toHaveLength(2);
    expect(damaged.json.warnings[0].code).toBe('SCHEMA_INVALID');

    const show = await mfm(home, 'brand', 'show', 'bravo');
    expect(show.code).toBe(0);
    expect(show.json.data.brand).toMatchObject({ id: 'bravo', status: 'draft', dir: path.join(home, 'brands', 'bravo') });
    const missing = await mfm(home, 'brand', 'show', 'nobody');
    expect(missing.code).toBe(2);
    expect(missing.json.error.code).toBe('BRAND_NOT_FOUND');
    expect((await mfm(temp('mfm-empty-'), 'brand', 'list')).json.data.brands).toEqual([]);
  });
});

describe('brand use', () => {
  it('copies the brand into the project, never links, and sets project.json brand', async () => {
    const home = temp('mfm-home-');
    await pickedBrand(home, 'acme');
    const library = path.join(home, 'brands', 'acme');
    writeFileSync(path.join(library, 'brand.prev.json'), '{}');
    const project = await newProject(home);
    const result = await mfm(home, 'brand', 'use', 'acme', '--project', project);
    expect(result.code, JSON.stringify(result.json)).toBe(0);
    expect(result.json.data).toMatchObject({ project, brand: { id: 'acme', status: 'picked', dir: path.join(project, 'brand') } });
    expect(readDoc('project', path.join(project, 'project.json')).doc.brand).toBe('acme');
    const copy = path.join(project, 'brand');
    expect(readdirSync(copy).sort()).toEqual(['brand.json', 'brand.md', 'fonts', 'logo.svg', 'shots']);
    expect(readdirSync(path.join(copy, 'shots')).sort()).toEqual(['shot-1.svg', 'shot-2.svg', 'shot-3.svg']);
    for (const file of ['logo.svg', 'brand.json', 'shots/shot-1.svg']) expect(lstatSync(path.join(copy, file)).isSymbolicLink()).toBe(false);

    // Editing the library copy leaves the project copy alone.
    const before = readFileSync(path.join(copy, 'logo.svg'), 'utf8');
    writeFileSync(path.join(library, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(readFileSync(path.join(copy, 'logo.svg'), 'utf8')).toBe(before);

    // A second use replaces the copy.
    const again = await mfm(home, 'brand', 'use', 'acme', '--project', project);
    expect(again.code).toBe(0);
    expect(readFileSync(path.join(copy, 'logo.svg'), 'utf8')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('also copies files brand.json points at outside the synced names, such as captured fonts', async () => {
    const home = temp('mfm-home-');
    await pickedBrand(home, 'captured-fonts');
    const library = path.join(home, 'brands', 'captured-fonts');
    const file = path.join(library, 'brand.json');
    const { doc } = readDoc('brand', file);
    mkdirSync(path.join(library, 'capture', 'assets', 'fonts'), { recursive: true });
    writeFileSync(path.join(library, 'capture', 'assets', 'fonts', 'Brand.woff2'), 'font bytes');
    writeFileSync(path.join(library, 'capture', 'page.html'), '<p>not synced</p>');
    const display = doc.type.display;
    if (!display) throw new Error('manual brand has a display role');
    const files = [{ ...display.files[0], path: 'capture/assets/fonts/Brand.woff2', source: 'captured' as const }];
    writeDoc('brand', file, { ...doc, type: { ...doc.type, display: { ...display, files } } });
    const project = await newProject(home);
    expect((await mfm(home, 'brand', 'use', 'captured-fonts', '--project', project)).code).toBe(0);
    expect(readFileSync(path.join(project, 'brand', 'capture', 'assets', 'fonts', 'Brand.woff2'), 'utf8')).toBe('font bytes');
    expect(existsSync(path.join(project, 'brand', 'capture', 'page.html'))).toBe(false);
  });

  it('needs a project and a known brand', async () => {
    const home = temp('mfm-home-');
    await briefBrand({ home, id: 'draft-one', moods: ['bold'] });
    const nowhere = await runIn(['brand', 'use', 'draft-one', '--home', home, '--project', temp('mfm-not-a-project-'), '--json'], COMMANDS);
    expect(JSON.parse(nowhere.stdout).error.code).toBe('PROJECT_NOT_FOUND');
    const project = await newProject(home);
    expect((await mfm(home, 'brand', 'use', 'nobody', '--project', project)).json.error.code).toBe('BRAND_NOT_FOUND');
    const draft = await mfm(home, 'brand', 'use', 'draft-one', '--project', project);
    expect(draft.code).toBe(0);
    expect(draft.json.warnings.map((warning: { message: string }) => warning.message).join(' ')).toContain('draft');
  });
});

describe('brand rm', () => {
  it('needs --yes, refuses with LOCKED while the brand lock is held, then removes the folder', async () => {
    const home = temp('mfm-home-');
    await pickedBrand(home, 'acme');
    const dir = path.join(home, 'brands', 'acme');
    const unconfirmed = await mfm(home, 'brand', 'rm', 'acme');
    expect(unconfirmed.code).toBe(2);
    expect(unconfirmed.json.error.code).toBe('USAGE');

    // A live holder: this test process, as a project command would hold it.
    writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: process.pid, host: hostname(), command: 'film round', startedAt: new Date().toISOString() }));
    const locked = await mfm(home, 'brand', 'rm', 'acme', '--yes');
    expect(locked.code).toBe(4);
    expect(locked.json.error.code).toBe('LOCKED');
    expect(existsSync(path.join(dir, 'brand.json'))).toBe(true);

    writeFileSync(path.join(dir, '.lock'), '');
    utimesSync(path.join(dir, '.lock'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    const removed = await mfm(home, 'brand', 'rm', 'acme', '--yes');
    expect(removed.code, JSON.stringify(removed.json)).toBe(0);
    expect(removed.json.data.removed.id).toBe('acme');
    expect(removed.json.data.removed.bytes).toBeGreaterThan(1000);
    expect(existsSync(dir)).toBe(false);
    expect(readdirSync(path.join(home, 'brands'))).toEqual([]);
    expect((await mfm(home, 'brand', 'rm', 'acme', '--yes')).json.error.code).toBe('BRAND_NOT_FOUND');
  });
});

describe('capture reuse and refresh', () => {
  let engine: Engine;
  let browserPath: string;
  /** The candidates fixture with its images, which yields enough shot candidates to pick from. */
  let shotSite = '';
  beforeAll(async () => {
    ({ engine, browserPath } = await testBrowser());
    shotSite = temp('mfm-library-site-');
    cpSync(candidatesFixture, shotSite, { recursive: true });
    mkdirSync(path.join(shotSite, 'img'));
    const ffmpeg = (args: string[]) => expect(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }).status).toBe(0);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1600x900', '-frames:v', '1', path.join(shotSite, 'img', 'hero-a.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=s=1600x900', '-frames:v', '1', path.join(shotSite, 'img', 'hero-b.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=#8B6DFF:s=400x200', '-frames:v', '1', path.join(shotSite, 'img', 'og-logo.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720', '-frames:v', '1', path.join(shotSite, 'img', 'og-photo.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=#8B6DFF:s=64x64', '-frames:v', '1', path.join(shotSite, 'img', 'favicon.png')]);
  }, 900_000);

  it('a second capture without --refresh returns the existing picked brand without the engine', async () => {
    const home = temp('mfm-home-');
    await pickedBrand(home, 'tessarine');
    const emptyCache = temp('mfm-empty-cache-');
    const result = await runIn(
      ['brand', 'capture', '--local-file', path.join(site, 'index.html'), '--local-root', site, '--name', 'tessarine', '--home', home, '--json'],
      COMMANDS,
      { MF_MOTION_CACHE: emptyCache },
    );
    expect(result.code, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).data.brand).toEqual({ id: 'tessarine', status: 'picked' });
    expect(readdirSync(emptyCache)).toEqual([]);
    expect(existsSync(path.join(home, 'brands', 'tessarine', 'capture'))).toBe(false);
  });

  it('--refresh keeps the previous pick in brand.prev.json until the new pick', async () => {
    const home = temp('mfm-home-');
    await pickedBrand(home, 'tessarine');
    const dir = path.join(home, 'brands', 'tessarine');
    const picked = readFileSync(path.join(dir, 'brand.json'), 'utf8');
    const request = { home, cwd: shotSite, localFile: path.join(shotSite, 'index.html'), localRoot: shotSite, name: 'tessarine', refresh: true, engine, browserPath };
    const first = await captureBrand(request);
    expect(first.brand.status).toBe('draft');
    expect(readFileSync(path.join(dir, 'brand.prev.json'), 'utf8')).toBe(picked);
    expect(readDoc('brand', path.join(dir, 'brand.json')).doc.source.mode).toBe('capture-local');

    // A second refresh before any pick still keeps the picked brand, not the draft.
    await captureBrand(request);
    expect(readFileSync(path.join(dir, 'brand.prev.json'), 'utf8')).toBe(picked);

    const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
    expect(doc.candidates.shots.length).toBeGreaterThanOrEqual(3);
    expect(doc.candidates.logos.length).toBeGreaterThanOrEqual(1);
    const pick = await mfm(home, 'brand', 'pick', 'tessarine', '--logo', 'l1', '--shots', 's1,s2,s3');
    expect(pick.code, JSON.stringify(pick.json)).toBe(0);
    expect(existsSync(path.join(dir, 'brand.prev.json'))).toBe(false);

    // The reused draft-or-picked entry also returns its sheets.
    const reuse = await captureBrand({ ...request, refresh: false });
    expect(reuse.reused).toBe(true);
    expect(reuse.candidatesSheet).toBe(path.join(dir, 'candidates-sheet.png'));
  }, 600_000);
});

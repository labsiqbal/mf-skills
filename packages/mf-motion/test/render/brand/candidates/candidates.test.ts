// Logo and shot candidates, their sheets, and brand pick, through the built CLI.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { averageHash, hashDistance, isLogoShaped } from '../../../../src/brand/index';
import { probe } from '../../../../src/media/probe';
import { readEvents } from '../../../../src/paths/index';
import { readDoc } from '../../../../src/schemas/index';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixture = path.join(packageRoot, 'test', 'fixtures', 'brands', 'candidates', 'site');
const cli = path.join(packageRoot, 'dist', 'cli.mjs');
let site = '';

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function mfm(home: string, cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, MF_MOTION_CACHE: testCacheRoot(), MF_MOTION_HOME: home, NO_COLOR: '1' },
    timeout: 600_000,
  });
  return { code: result.status, json: JSON.parse(result.stdout) as Record<string, any>, stderr: result.stderr };
}

beforeAll(async () => {
  expect(spawnSync(process.execPath, ['esbuild.config.mjs'], { cwd: packageRoot, encoding: 'utf8' }).status).toBe(0);
  await testBrowser();
  site = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-cand-site-')));
  cpSync(fixture, site, { recursive: true });
  mkdirSync(path.join(site, 'img'));
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1600x900', '-frames:v', '1', path.join(site, 'img', 'hero-a.png')]);
  cpSync(path.join(site, 'img', 'hero-a.png'), path.join(site, 'img', 'hero-b.png'));
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=#8B6DFF:s=400x200', '-vf', 'drawbox=x=120:y=70:w=160:h=60:color=white:t=fill', '-frames:v', '1', path.join(site, 'img', 'og-logo.png')]);
  // A photo-like 16:9 image: thousands of colours.
  ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720', '-frames:v', '1', path.join(site, 'img', 'og-photo.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=#8B6DFF:s=64x64', '-frames:v', '1', path.join(site, 'img', 'favicon.png')]);
}, 900_000);

describe('candidates', () => {
  it('a 2:1 flat logo og:image is logo-shaped; a 16:9 photo is not', async () => {
    expect(await isLogoShaped(path.join(site, 'img', 'og-logo.png'))).toBe(true);
    expect(await isLogoShaped(path.join(site, 'img', 'og-photo.png'))).toBe(false);
  });

  let home = '';
  it('capture writes both sheets and keeps one of two identical hero images', async () => {
    home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-home-')));
    const result = mfm(home, site, 'brand', 'capture', '--local-file', path.join(site, 'index.html'), '--local-root', site, '--name', 'tessarine');
    expect(result.code, result.stderr).toBe(0);
    const dir = path.join(home, 'brands', 'tessarine');
    expect(result.json.data.candidatesSheet).toBe(path.join(dir, 'candidates-sheet.png'));
    expect(result.json.data.logoSheet).toBe(path.join(dir, 'logo-sheet.png'));
    for (const sheet of ['candidates-sheet.png', 'logo-sheet.png']) expect((await probe(path.join(dir, sheet))).video?.width).toBeGreaterThan(0);
    const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
    expect(doc.candidates.sheet).toBe('candidates-sheet.png');
    expect(doc.candidates.logos.length).toBeGreaterThanOrEqual(3);
    expect(doc.candidates.logos.every((file: string, i: number) => file.startsWith(`candidates/l${i + 1}.`))).toBe(true);
    const hero = await averageHash(path.join(site, 'img', 'hero-a.png'));
    const heroLike = [];
    for (const shot of doc.candidates.shots) {
      const hash = await averageHash(path.join(dir, shot));
      if (hero && hash && hashDistance(hero, hash) < 6) heroLike.push(shot);
    }
    expect(heroLike).toHaveLength(1);
    expect(result.json.next).toContain('mf-motion brand pick tessarine --logo <l> --shots <s1,s2,s3> --json');
  }, 600_000);

  it('brand pick with 2 shots exits 2', () => {
    const result = mfm(home, site, 'brand', 'pick', 'tessarine', '--logo', 'l1', '--shots', 's1,s2');
    expect(result.code).toBe(2);
    expect(result.json.error.code).toBe('USAGE');
  });

  it('a valid pick writes stable names, validates and appends brand.picked', () => {
    const { doc: before } = readDoc('brand', path.join(home, 'brands', 'tessarine', 'brand.json'));
    const shots = before.candidates.shots.map((_: string, i: number) => `s${i + 1}`);
    while (shots.length < 3) shots.push(shots[0] ?? 's1');
    const project = path.join(realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-work-'))), 'film');
    expect(mfm(home, site, 'new', 'Pick Test', '--type', 'film', '--dir', project).code).toBe(0);
    const result = mfm(home, project, 'brand', 'pick', 'tessarine', '--logo', 'l1', '--mark', 'l2', '--shots', shots.slice(0, 3).join(','));
    expect(result.code, JSON.stringify(result.json.error)).toBe(0);
    const brand = result.json.data.brand;
    expect(brand).toMatchObject({ id: 'tessarine', status: 'picked' });
    expect(brand.logo.path).toMatch(/^logo\.(svg|png|jpg)$/);
    expect(brand.mark.path).toMatch(/^mark\.(svg|png|jpg)$/);
    expect(brand.shots.map((shot: { path: string }) => shot.path.replace(/\.(png|jpg)$/, ''))).toEqual(['shots/shot-1', 'shots/shot-2', 'shots/shot-3']);
    const dir = path.join(home, 'brands', 'tessarine');
    for (const file of [brand.logo.path, brand.mark.path, ...brand.shots.map((shot: { path: string }) => shot.path)]) expect(existsSync(path.join(dir, file)), file).toBe(true);
    const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
    expect(doc.status).toBe('picked');
    expect(doc.colors).toEqual(before.colors);
    expect(doc.type).toEqual(before.type);
    expect(doc.shots[0]?.from).toMatch(/^candidates\/s\d+\./);
    const events = readEvents(project).map((event) => event.type);
    expect(events).toContain('brand.picked');
    expect(JSON.parse(readFileSync(path.join(dir, 'brand.json'), 'utf8')).logo.w).toBeGreaterThan(0);
  }, 300_000);
});

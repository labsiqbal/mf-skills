// Demo brand Mossmallow: the fixture site follows the fixture contract, its
// local-file capture equals expected.json, and a re-capture reproduces the
// committed assets/demo-brands/mossmallow/ byte for byte on Linux (by roles
// elsewhere).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { referencedFiles } from '../../../../src/brand/library';
import { readFont } from '../../../../src/fonts/index';
import { probe } from '../../../../src/media/probe';
import { readDoc } from '../../../../src/schemas/index';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';

const ID = 'mossmallow';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixture = path.join(packageRoot, 'test', 'fixtures', 'brands', ID);
const site = path.join(fixture, 'site');
const demo = path.join(packageRoot, 'assets', 'demo-brands', ID);
const cli = path.join(packageRoot, 'dist', 'cli.mjs');
const expected = JSON.parse(readFileSync(path.join(fixture, 'expected.json'), 'utf8'));
const SEED_MOVES = ['message-cascade', 'follower-milestone', 'prompt-to-result', 'terminal-run', 'task-checkoff', 'revenue-step', 'ranked-bars', 'ink-underline', 'title-lockup', 'three-step-flow'];
const SCREENS = ['checkup', 'shelf', 'streak', 'watering'];

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)).map((rel) => `${name}/${rel}`) : [name]));
}

const hashes = (dir: string) => Object.fromEntries(walk(dir).map((rel) => [rel, createHash('sha256').update(readFileSync(path.join(dir, rel))).digest('hex')]));

/** The parts of a font role expected.json pins. */
const roleShape = (role: { family: string; weight: number; files: Array<{ path: string; licenceHint: string }> } | null) =>
  role && { family: role.family, weight: role.weight, files: role.files.map((file) => ({ path: file.path, licenceHint: file.licenceHint })) };

beforeAll(async () => {
  expect(spawnSync(process.execPath, ['esbuild.config.mjs'], { cwd: packageRoot, encoding: 'utf8' }).status).toBe(0);
  await testBrowser();
}, 900_000);

describe('Mossmallow fixture site', () => {
  it('is static HTML and CSS with local files only', () => {
    const pages = walk(fixture).filter((rel) => rel.endsWith('.html'));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const rel of pages) {
      const html = readFileSync(path.join(fixture, rel), 'utf8');
      expect(html, rel).not.toMatch(/<script/i);
      expect(html, rel).not.toMatch(/(src|href)="(https?:)?\/\//i);
    }
    for (const file of ['logo.svg', 'mark.svg', 'logo-mono.svg', 'mark-mono.svg', 'fonts/OFL.txt']) expect(existsSync(path.join(site, 'assets', file)), file).toBe(true);
    expect(readFont(readFileSync(path.join(site, 'assets', 'fonts', 'NotoSans.woff2')))).toMatchObject({ typographicFamily: 'Noto Sans' });
    expect(Object.keys(JSON.parse(readFileSync(path.join(fixture, 'examples.json'), 'utf8'))).sort()).toEqual([...SEED_MOVES].sort());
  });

  it('has 4 screens at 1440x900 and 390x844, each under 300 KB', async () => {
    const screens = path.join(site, 'assets', 'screens');
    expect(readdirSync(screens).sort()).toEqual(SCREENS.flatMap((name) => [`${name}-desktop.png`, `${name}-phone.png`]));
    for (const name of readdirSync(screens)) {
      expect(statSync(path.join(screens, name)).size, name).toBeLessThan(300 * 1024);
      const info = await probe(path.join(screens, name));
      expect([info.video?.width, info.video?.height], name).toEqual(name.endsWith('-desktop.png') ? [1440, 900] : [390, 844]);
    }
  });
});

describe('Mossmallow capture', () => {
  it('local-file capture yields the expected colour roles, font roles, candidate counts and copy', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const result = spawnSync(process.execPath, [cli, 'brand', 'capture', '--local-file', path.join(site, 'index.html'), '--local-root', site, '--name', ID, '--json'], {
      cwd: site,
      encoding: 'utf8',
      env: { ...process.env, MF_MOTION_CACHE: testCacheRoot(), MF_MOTION_HOME: home, NO_COLOR: '1' },
      timeout: 600_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.warnings).toEqual([]);
    const { doc } = readDoc('brand', path.join(home, 'brands', ID, 'brand.json'));
    const { ground, surface, ink, muted, accent, accent2 } = doc.colors;
    expect({ ground, surface, ink, muted, accent, accent2 }).toEqual(expected.colors);
    expect({
      display: roleShape(doc.type.display),
      heading: roleShape(doc.type.heading),
      body: roleShape(doc.type.body),
      mono: roleShape(doc.type.mono),
    }).toEqual(expected.type);
    expect({ logos: doc.candidates.logos.length, shots: doc.candidates.shots.length }).toEqual(expected.candidates);
    expect({ headline: doc.copy.headline, tagline: doc.tagline, cta: doc.copy.cta }).toEqual(expected.copy);
  }, 600_000);

  it('the committed demo brand is picked, schema-valid and complete', () => {
    const { doc } = readDoc('brand', path.join(demo, 'brand.json'));
    expect(doc).toMatchObject({ id: ID, status: 'picked', source: { mode: 'capture-local', capturedAt: null }, rights: { noticeShownAt: null } });
    expect(doc.shots).toHaveLength(4);
    expect(walk(demo).sort()).toEqual(['brand.json', 'brand.md', ...referencedFiles(doc)].sort());
    expect(readFileSync(path.join(demo, 'logo.svg'))).toEqual(readFileSync(path.join(site, 'assets', 'logo.svg')));
  });

  it('fixtures:brands re-captures to the same files as assets/demo-brands/mossmallow', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'mfm-demo-out-'));
    const result = spawnSync(process.execPath, ['scripts/fixtures-brands.mjs', '--only', ID, '--out', out], { cwd: packageRoot, encoding: 'utf8', timeout: 600_000 });
    expect(result.status, result.stderr).toBe(0);
    const fresh = hashes(path.join(out, ID));
    const committed = hashes(demo);
    if (process.platform === 'linux') {
      expect(fresh).toEqual(committed);
      return;
    }
    // Generated on Linux: elsewhere font rasterisation moves the pixel
    // evidence in brand.json and brand.md, so those compare by their roles.
    const measured = new Set(['brand.json', 'brand.md']);
    const files = (all: Record<string, string>) => Object.fromEntries(Object.entries(all).filter(([rel]) => !measured.has(rel)));
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(committed).sort());
    expect(files(fresh)).toEqual(files(committed));
    const roles = (dir: string) => {
      const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
      const { ground, surface, ink, muted, accent, accent2 } = doc.colors;
      return { colors: { ground, surface, ink, muted, accent, accent2 }, type: doc.type, logo: doc.logo, mark: doc.mark, shots: doc.shots, copy: doc.copy, status: doc.status };
    };
    expect(roles(path.join(out, ID))).toEqual(roles(demo));
  }, 600_000);
});

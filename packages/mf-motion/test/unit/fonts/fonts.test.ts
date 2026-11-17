import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageRoot } from '../../../src/engine/pins';
import {
  FAMILY_SPECS,
  assertCover,
  bundledFontsDir,
  coverFor,
  faceCss,
  families,
  fetchFonts,
  fetchManifest,
  nearestOfl,
  readFont,
  verifyFetched,
} from '../../../src/fonts/index';
import { buildFont } from './synthetic-font';

const fonts = bundledFontsDir();
const emptyCache = () => mkdtempSync(path.join(tmpdir(), 'mfm-fonts-cache-'));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('bundled fonts', () => {
  it('every bundled file re-hashes to its FONTS.md entry', () => {
    const table = readFileSync(path.join(fonts, 'FONTS.md'), 'utf8');
    const rows = [...table.matchAll(/^\| `([a-z-]+)` \| `([^`]+)` \| [^|]+ \| `ofl\/[^`]+` \| (\d+) \| `([0-9a-f]{64})` \|$/gm)];
    const bundled = FAMILY_SPECS.filter((spec) => spec.source === 'bundled').flatMap((spec) => spec.files.map((file) => `${spec.id}/${file}`));
    expect(rows.map((row) => row[2]).sort()).toEqual([...bundled].sort());
    for (const [, , file = '', bytes, hash] of rows) {
      const data = readFileSync(path.join(fonts, file));
      expect(data.length, file).toBe(Number(bytes));
      expect(sha256(data), file).toBe(hash);
    }
    expect(table).toMatch(/commit `[0-9a-f]{40}`/);
  });

  it('ships the OFL text with every family and a manifest pinned to the same commit', () => {
    const ofl = readFileSync(path.join(fonts, 'OFL.txt'), 'utf8');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    for (const spec of FAMILY_SPECS) expect(ofl, spec.id).toContain(`${spec.id} (google/fonts`);
    const commit = /commit `([0-9a-f]{40})`/.exec(readFileSync(path.join(fonts, 'FONTS.md'), 'utf8'))?.[1];
    const manifest = fetchManifest();
    expect(manifest.map((entry) => entry.id).sort()).toEqual(['noto-color-emoji', 'noto-sans-jp', 'noto-sans-kr', 'noto-sans-sc', 'noto-sans-tc']);
    for (const entry of manifest) {
      expect(Object.keys(entry)).toEqual(['id', 'url', 'sha256', 'bytes']);
      expect(entry.url).toContain(`/google/fonts/${commit}/ofl/`);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('reads variable axes from fvar', () => {
    const inter = readFont(readFileSync(path.join(fonts, 'inter', 'Inter[opsz,wght].ttf')));
    expect(inter.typographicFamily).toBe('Inter');
    expect(inter.axes).toEqual([
      { tag: 'opsz', min: 14, default: 14, max: 32 },
      { tag: 'wght', min: 100, default: 400, max: 900 },
    ]);
  });
});

describe('coverFor', () => {
  it('covers mixed Latin, Arabic and Devanagari with bundled families', () => {
    const coverage = coverFor('Launch day: مرحبا بالعالم and नमस्ते!', { cacheDir: emptyCache() });
    expect(coverage.scripts).toEqual(['Latin', 'Arabic', 'Devanagari']);
    expect(coverage.stack).toEqual(['inter', 'noto-sans-arabic', 'noto-sans-devanagari']);
    expect(coverage.missing).toEqual([]);
  });

  it('reports CJK as missing until fetched, with the doctor hint', () => {
    const cacheDir = emptyCache();
    const coverage = coverFor('Hello 你好', { cacheDir });
    expect(coverage.missing).toEqual(['Han']);
    expect(coverage.fetch).toEqual(['cjk']);
    expect(() => assertCover('Hello 你好', { cacheDir })).toThrow(expect.objectContaining({ code: 'FONT_SCRIPT_MISSING', exitCode: 3 }));
    const hintFor = (text: string) => {
      try {
        assertCover(text, { cacheDir });
      } catch (error) {
        return (error as { hint: string }).hint;
      }
      return 'no error';
    };
    expect(hintFor('你好')).toBe('Run `mf-motion doctor --fix --fonts cjk` to add the fallback fonts.');
    expect(hintFor('こんにちは 😀')).toBe('Run `mf-motion doctor --fix --fonts cjk,emoji` to add the fallback fonts.');
    // A fetched family (size checked against the manifest) closes the gap.
    const sc = fetchManifest().find((entry) => entry.id === 'noto-sans-sc');
    const file = path.join(cacheDir, 'fonts', 'noto-sans-sc', 'NotoSansSC[wght].ttf');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
    truncateSync(file, sc?.bytes ?? 0);
    expect(families({ cacheDir }).find((family) => family.id === 'noto-sans-sc')?.installed).toBe(true);
    expect(coverFor('Hello 你好', { cacheDir })).toMatchObject({ stack: ['inter', 'noto-sans-sc'], missing: [] });
    expect(coverFor('Shalom שלום', { cacheDir }).missing).toEqual(['Hebrew']);
  });
});

describe('faceCss', () => {
  it('copies faces into the build and emits font-display block with fvar axis ranges', () => {
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    const result = faceCss('body', null, build, { text: 'Hello مرحبا', cacheDir: emptyCache() });
    expect(result.fontFamily).toBe("'mf-inter', 'mf-noto-sans-arabic', sans-serif");
    expect(result.css).toContain('font-display: block;');
    expect(result.css).toContain('font-weight: 100 900;');
    expect(result.css).toContain('font-stretch: 62.5% 100%;');
    expect(result.css).toContain('font-style: italic;');
    for (const file of result.files) expect(existsSync(path.join(build, file)), file).toBe(true);
  });

  it('puts the brand face first and its bundled fallback after it', () => {
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    const brandDir = mkdtempSync(path.join(tmpdir(), 'mfm-brand-'));
    mkdirSync(path.join(brandDir, 'fonts'));
    writeFileSync(path.join(brandDir, 'fonts', 'brand.ttf'), buildFont({ family: 'Brand Display', xHeight: 520, axes: [{ tag: 'wght', min: 300, default: 400, max: 800 }] }));
    const result = faceCss(
      'heading',
      { family: 'Brand Display', weight: 700, files: [{ path: 'fonts/brand.ttf', weight: '300 800', style: 'normal', axes: 'wght' }], fallback: 'noto-serif' },
      build,
      { brandDir, text: 'Title', cacheDir: emptyCache() },
    );
    expect(result.fontFamily).toBe("'mf-heading', 'mf-noto-serif', serif");
    expect(result.css).toMatch(/font-family: 'mf-heading';\n {2}src: url\('assets\/fonts\/heading-0\.ttf'\);\n {2}font-weight: 300 800;/);
  });
});

describe('nearestOfl', () => {
  const fixture = (name: string, spec: Parameters<typeof buildFont>[0]) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-font-')), name);
    writeFileSync(file, buildFont(spec));
    return file;
  };

  it('maps a serif to noto-serif, a monospace to noto-sans-mono and a sans with x-height 0.55 to inter', () => {
    expect(nearestOfl(fixture('serif.ttf', { family: 'Fixture Serif Text', panose: [2, 2, 6, 3, 5, 4, 5, 2, 3, 4], xHeight: 450 })).id).toBe('noto-serif');
    expect(nearestOfl(fixture('mono.ttf', { family: 'Fixture Grotesk', fixedPitch: true, xHeight: 530 })).id).toBe('noto-sans-mono');
    const sans = nearestOfl(fixture('sans.ttf', { family: 'Fixture Grotesk', panose: [2, 11, 5, 2, 2, 2, 4, 2, 2, 4], xHeight: 550 }));
    expect(sans).toMatchObject({ id: 'inter', inputs: { xHeightRatio: 0.55, serif: false, monospace: false } });
  });

  it('maps a sans with a small x-height to noto-sans, and uses name tokens when PANOSE is empty', () => {
    expect(nearestOfl(fixture('low.ttf', { family: 'Fixture Humanist', panose: [2, 11, 5, 2, 2, 2, 4, 2, 2, 4], xHeight: 480 })).id).toBe('noto-sans');
    expect(nearestOfl(fixture('named.ttf', { family: 'Fixture Garamond', xHeight: 400 })).id).toBe('noto-serif');
    expect(nearestOfl(fixture('named-mono.ttf', { family: 'Fixture Code', xHeight: 500 })).id).toBe('noto-sans-mono');
  });

  it('classifies the bundled families themselves', () => {
    expect(nearestOfl(path.join(fonts, 'noto-serif', 'NotoSerif[wdth,wght].ttf')).id).toBe('noto-serif');
    expect(nearestOfl(path.join(fonts, 'noto-sans-mono', 'NotoSansMono[wdth,wght].ttf')).id).toBe('noto-sans-mono');
    expect(nearestOfl(path.join(fonts, 'inter', 'Inter[opsz,wght].ttf')).id).toBe('inter');
  });
});

describe('fetchFonts', () => {
  const good = new Uint8Array(4096).map((_, i) => i % 251);
  let served: Uint8Array = good;
  let base = '';
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.writeHead(200, { 'content-type': 'font/ttf' });
    response.end(Buffer.from(served));
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const manifest = () => [{ id: 'noto-sans-sc', url: `${base}/NotoSansSC%5Bwght%5D.ttf`, sha256: sha256(good), bytes: good.length }];

  it('downloads into <cache>/fonts and skips a verified file the second time', async () => {
    const cacheDir = emptyCache();
    served = good;
    const [first] = await fetchFonts(['cjk'], { cacheDir, manifest: manifest() });
    expect(first).toMatchObject({ id: 'noto-sans-sc', downloaded: true, path: path.join(cacheDir, 'fonts', 'noto-sans-sc', 'NotoSansSC[wght].ttf') });
    hits = 0;
    const [second] = await fetchFonts(['cjk'], { cacheDir, manifest: manifest() });
    expect(second?.downloaded).toBe(false);
    expect(hits).toBe(0);
    expect(await fetchFonts(['emoji'], { cacheDir, manifest: manifest() })).toEqual([]);
  });

  it('deletes a tampered download and fails MODEL_HASH_MISMATCH', async () => {
    const cacheDir = emptyCache();
    served = new Uint8Array(good).map((value, i) => (i === 100 ? value ^ 1 : value));
    await expect(fetchFonts(['cjk'], { cacheDir, manifest: manifest() })).rejects.toMatchObject({ code: 'MODEL_HASH_MISMATCH', exitCode: 5 });
    expect(existsSync(path.join(cacheDir, 'fonts', 'noto-sans-sc', 'NotoSansSC[wght].ttf'))).toBe(false);
  });

  it('deletes a fetched file tampered in the cache and fails MODEL_HASH_MISMATCH', async () => {
    const cacheDir = emptyCache();
    served = good;
    const [fetched] = await fetchFonts(['cjk'], { cacheDir, manifest: manifest() });
    writeFileSync(fetched?.path ?? '', 'tampered');
    await expect(verifyFetched({ cacheDir, manifest: manifest() })).rejects.toMatchObject({ code: 'MODEL_HASH_MISMATCH' });
    expect(existsSync(fetched?.path ?? '')).toBe(false);
  });
});

describe('pack check', () => {
  it('fails when assets/fonts/OFL.txt would not be packed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-pack-'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-ofl', version: '0.0.0', files: ['assets'] }));
    mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
    writeFileSync(path.join(dir, 'assets', 'fonts', 'Font.ttf'), 'x');
    const result = spawnSync(process.execPath, [path.join(packageRoot(), 'scripts', 'pack-check.mjs'), '--dir', dir], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('assets/fonts/OFL.txt');
  });
});

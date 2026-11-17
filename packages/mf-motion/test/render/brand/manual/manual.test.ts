// brand manual with real image files, and brand from-brief end to end through
// the built CLI, with its wordmark drawn by Chrome in the brand font.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseColor } from '../../../../src/brand/colors';
import { rgbToOklch } from '../../../../src/brand/moods';
import type { Engine } from '../../../../src/engine/index';
import { evaluate, screenshot, withPage } from '../../../../src/media/chrome';
import { frameAt, inkFraction } from '../../../../src/media/pixels';
import { probe } from '../../../../src/media/probe';
import { readDoc } from '../../../../src/schemas/index';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const cli = path.join(packageRoot, 'dist', 'cli.mjs');
let engine: Engine;
let browserPath: string;
let files = '';

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function mfm(home: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd: files,
    encoding: 'utf8',
    env: { ...process.env, MF_MOTION_CACHE: testCacheRoot(), MF_MOTION_HOME: home, NO_COLOR: '1' },
    timeout: 300_000,
  });
  return { code: result.status, json: JSON.parse(result.stdout) as Record<string, any>, stderr: result.stderr };
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const file = path.join(at, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (name !== '.lock') out[path.relative(dir, file)] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

beforeAll(async () => {
  expect(spawnSync(process.execPath, ['esbuild.config.mjs'], { cwd: packageRoot, encoding: 'utf8' }).status).toBe(0);
  ({ engine, browserPath } = await testBrowser());
  files = mkdtempSync(path.join(tmpdir(), 'mfm-manual-files-'));
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=#F2AA4C:s=480x160', '-vf', 'drawbox=x=40:y=40:w=400:h=80:color=#101820:t=fill', '-frames:v', '1', path.join(files, 'logo.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720', '-frames:v', '1', path.join(files, 'shot-a.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720', '-frames:v', '1', path.join(files, 'shot-b.jpg')]);
  ffmpeg(['-f', 'lavfi', '-i', 'smptebars=s=960x540', '-frames:v', '1', path.join(files, 'shot-c.bmp')]);
}, 900_000);

describe('brand manual', () => {
  it('3 colours and 3 shots give a picked, schema-valid brand with a luminance-extreme ground', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const result = mfm(home, 'brand', 'manual', '--name', 'acme-coffee', '--logo', 'logo.png', '--colors', '#F2AA4C,#101820,#FFFFFF', '--shots', 'shot-a.png,shot-b.jpg,shot-c.bmp', '--tagline', 'Roasted daily');
    expect(result.code, result.stderr).toBe(0);
    const dir = path.join(home, 'brands', 'acme-coffee');
    const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
    expect(doc.status).toBe('picked');
    expect(doc.source.mode).toBe('manual');
    const lightness = ['#F2AA4C', '#101820', '#FFFFFF'].map((hex) => rgbToOklch(parseColor(hex) as number[]).l);
    const extremes = [Math.min(...lightness), Math.max(...lightness)];
    expect(extremes).toContain(rgbToOklch(parseColor(doc.colors.ground) as number[]).l);
    expect(doc.logo).toEqual({ path: 'logo.png', kind: 'png', w: 480, h: 160 });
    expect(doc.shots.map((shot) => [shot.path, shot.kind, shot.w, shot.h, shot.from])).toEqual([
      ['shots/shot-1.png', 'png', 1280, 720, 'shot-a.png'],
      ['shots/shot-2.jpg', 'jpg', 1280, 720, 'shot-b.jpg'],
      ['shots/shot-3.png', 'png', 960, 540, 'shot-c.bmp'],
    ]);
    expect((await probe(path.join(dir, 'shots', 'shot-3.png'))).video?.width).toBe(960);
    expect(result.json.data.brand.status).toBe('picked');
  });

  it('without shots the brand is a draft', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const result = mfm(home, 'brand', 'manual', '--name', 'acme-coffee', '--logo', 'logo.png', '--colors', '#F2AA4C,#101820,#FFFFFF');
    expect(result.code, result.stderr).toBe(0);
    expect(readDoc('brand', path.join(home, 'brands', 'acme-coffee', 'brand.json')).doc.status).toBe('draft');
  });
});

describe('brand from-brief', () => {
  it('is deterministic and its wordmark draws in the brand font, inside its box', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const args = ['brand', 'from-brief', '--name', 'quiet-labs', '--mood', 'calm,technical,minimal', '--seed', '2'];
    const first = mfm(home, ...args);
    expect(first.code, first.stderr).toBe(0);
    const dir = path.join(home, 'brands', 'quiet-labs');
    const before = tree(dir);
    const second = mfm(home, ...args);
    expect(second.code, second.stderr).toBe(0);
    expect(tree(dir)).toEqual(before);
    for (const pair of first.json.data.pairs) expect(pair.contrast).toBeGreaterThanOrEqual(4.5);

    const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
    const logo = doc.logo;
    expect(logo?.kind).toBe('svg');
    if (!logo) return;
    const page = path.join(dir, 'wordmark-check.html');
    writeFileSync(page, `<!doctype html><html><body style="margin:0;background:${doc.colors.ground}">${readFileSync(path.join(dir, 'logo.svg'), 'utf8')}</body></html>`);
    const { png, fontLoaded } = await withPage({ dir, entry: 'wordmark-check.html', width: logo.w, height: logo.h, composition: false, engine, browserPath }, async (driver) => {
      const loaded = await evaluate(driver, async () => {
        await document.fonts.ready;
        return document.fonts.check('700 96px mf-wordmark');
      }, null);
      return { png: await screenshot(driver), fontLoaded: loaded };
    });
    expect(fontLoaded).toBe(true);
    const out = path.join(dir, 'wordmark-check.png');
    writeFileSync(out, png);
    const frame = await frameAt(out, 0, { format: 'rgba' });
    expect(inkFraction(frame)).toBeGreaterThan(0.05);
    // The outer columns stay ground: the name fits its box.
    const ink = parseColor(doc.colors.ink) as number[];
    let edgeInk = 0;
    for (let y = 0; y < frame.height; y += 1) {
      for (const x of [0, 1, 2, frame.width - 3, frame.width - 2, frame.width - 1]) {
        const i = (y * frame.width + x) * 4;
        if (Math.abs((frame.data[i] ?? 0) - (ink[0] ?? 0)) < 40 && Math.abs((frame.data[i + 1] ?? 0) - (ink[1] ?? 0)) < 40 && Math.abs((frame.data[i + 2] ?? 0) - (ink[2] ?? 0)) < 40) edgeInk += 1;
      }
    }
    expect(edgeInk).toBe(0);
  }, 300_000);
});

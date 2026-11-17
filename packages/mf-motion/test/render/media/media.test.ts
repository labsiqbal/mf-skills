// Page driver, sheet renderer and pixel reader against the real engine Chrome
// and FFmpeg. Clips are generated with FFmpeg's lavfi sources, not committed.
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Engine, copyVendor } from '../../../src/engine/index';
import { screenshot, seek, withPage } from '../../../src/media/chrome';
import {
  type Frame,
  alphaCoverage,
  changedFraction,
  colorClusters,
  contrastRatio,
  frameAt,
  framePng,
  frames,
  inkFraction,
  regionLuminance,
  relativeLuminance,
} from '../../../src/media/pixels';
import { probe } from '../../../src/media/probe';
import { renderSheet } from '../../../src/media/sheet';
import { run } from '../../../src/proc/run';
import { testBrowser } from '../../helpers/engine';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/media');
let engine: Engine;
let browserPath: string;
const work = () => mkdtempSync(path.join(tmpdir(), 'mfm-media-'));

async function ffmpeg(args: string[]) {
  const result = await run('ffmpeg', ['-v', 'error', '-y', ...args], { timeoutMs: 120_000 });
  expect(result.stderr).toBe('');
  expect(result.code).toBe(0);
}

beforeAll(async () => {
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

describe('page driver', () => {
  it('seeks a composition to 1.5 s and the screenshot shows the element', async () => {
    const dir = work();
    cpSync(path.join(fixtures, 'seek'), dir, { recursive: true });
    copyVendor(dir, { engineDir: engine.dir });
    const shots = await withPage({ dir, width: 320, height: 180, engine, browserPath }, async (page, session) => {
      await seek(page, 0.5);
      const before = await screenshot(page);
      await seek(page, 1.5);
      const after = await screenshot(page);
      return { before, after, session };
    });
    expect(shots.session.aborted).toEqual([]);
    expect(shots.session.errors).toEqual([]);
    const centre = async (png: Buffer) => {
      const file = path.join(dir, `shot-${Math.random().toString(36).slice(2)}.png`);
      writeFileSync(file, png);
      const frame = await frameAt(file, 0, { format: 'rgba' });
      const at = (160 + 90 * frame.width) * 4;
      return [...frame.data.subarray(at, at + 3)];
    };
    expect(await centre(shots.after)).toEqual([255, 0, 0]);
    expect(await centre(shots.before)).toEqual([0, 0, 0]);
  }, 120_000);

  it('aborts and reports a network request without making it', async () => {
    const dir = work();
    cpSync(path.join(fixtures, 'network'), dir, { recursive: true });
    const session = await withPage({ dir, width: 200, height: 100, composition: false, engine, browserPath }, async (_page, s) => s);
    expect(session.aborted).toEqual([{ url: 'https://example.com/x.png', reason: 'network' }]);
  }, 120_000);

  it('aborts a file outside the inspected folder', async () => {
    const base = work();
    const dir = path.join(base, 'site');
    mkdirSync(dir);
    writeFileSync(path.join(base, 'secret.png'), 'not really a png');
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><img src="../secret.png">');
    const session = await withPage({ dir, width: 100, height: 100, composition: false, engine, browserPath }, async (_page, s) => s);
    expect(session.aborted).toHaveLength(1);
    expect(session.aborted[0]?.reason).toBe('outside-folder');
  }, 120_000);

  it('fails with TIMEOUT when a composition never registers its timeline', async () => {
    const dir = work();
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div data-composition-id="main"></div><script>throw new Error("broken page")</script>');
    await expect(
      withPage({ dir, width: 100, height: 100, engine, browserPath, registrationTimeoutMs: 1500 }, async () => 'never'),
    ).rejects.toMatchObject({ code: 'TIMEOUT', details: { errors: expect.arrayContaining([expect.stringContaining('broken page')]) } });
  }, 120_000);
});

describe('sheets', () => {
  it('a dense sheet of a generated 4 s clip has 16 labelled frames', async () => {
    const dir = work();
    const clip = path.join(dir, 'clip.mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-pix_fmt', 'yuv420p', clip]);
    const items = [];
    for (let i = 0; i < 16; i += 1) {
      const t = i * 0.25;
      const png = await framePng(clip, t, path.join(dir, `f${i}.png`), { width: 320 });
      items.push({ image: png, label: `${t.toFixed(2)} s` });
    }
    const out = path.join(dir, 'sheet-dense.png');
    const result = await renderSheet('dense', items, out, { title: 'clip.mp4 every 0.25 s', engine, browserPath });
    expect(result.files).toEqual([out]);
    expect(result.cells).toHaveLength(16);
    expect(result.cells.map((cell) => cell.label)).toEqual(items.map((item) => item.label));
    const info = await probe(out);
    expect(info.video?.width).toBeGreaterThan(0);
    expect(Math.max(info.video?.width ?? 0, info.video?.height ?? 0)).toBeLessThanOrEqual(4096);
  }, 180_000);

  it('starts a numbered sheet when the cells pass the size limit', async () => {
    const dir = work();
    const png = path.join(dir, 'tile.png');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=#3366CC:s=160x90:d=0.1', '-frames:v', '1', png]);
    const items = Array.from({ length: 70 }, (_, i) => ({ image: png, label: `#${i + 1}` }));
    const out = path.join(dir, 'strip.png');
    const result = await renderSheet('board', items, out, { engine, browserPath });
    expect(result.files.length).toBeGreaterThan(1);
    expect(result.files[1]).toBe(path.join(dir, 'strip-2.png'));
    for (const file of result.files) {
      expect(existsSync(file)).toBe(true);
      const info = await probe(file);
      expect(Math.max(info.video?.width ?? 0, info.video?.height ?? 0)).toBeLessThanOrEqual(4096);
    }
    expect(result.cells).toHaveLength(70);
  }, 180_000);

  it('draws a brand card with swatches and a specimen', async () => {
    const dir = work();
    const out = path.join(dir, 'brand-card.png');
    const result = await renderSheet(
      'brand-card',
      [
        { role: 'swatch', color: '#0E0F1A', label: 'ground' },
        { role: 'swatch', color: '#8B6DFF', label: 'accent' },
        { role: 'specimen', text: 'Signals, sorted.', sublabel: 'Inter' },
      ],
      out,
      { title: 'Tessarine', engine, browserPath },
    );
    expect(result.files).toEqual([out]);
    expect((await probe(out)).video?.width).toBe(1200);
  }, 120_000);
});

describe('pixel reader and probe', () => {
  it('returns the expected changed fraction for a two-colour flip clip', async () => {
    const dir = work();
    const clip = path.join(dir, 'flip.mp4');
    // Black 64x64 for 2 s; the left half turns white at 1 s.
    await ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=2',
      '-f', 'lavfi', '-i', 'color=c=white:s=32x64:r=10:d=2',
      '-filter_complex', "[0][1]overlay=x=0:y=0:enable='gte(t,1)'",
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-qp', '0', clip,
    ]);
    const changes: number[] = [];
    let previous: Frame | undefined;
    let count = 0;
    for await (const frame of frames(clip, { fps: 10, width: 64, format: 'gray' })) {
      count += 1;
      expect(frame.data.length).toBe(64 * 64);
      if (previous) changes.push(changedFraction(previous, frame));
      previous = frame;
    }
    expect(count).toBe(20);
    const flips = changes.filter((fraction) => fraction > 0.01);
    expect(flips).toHaveLength(1);
    expect(flips[0]).toBeCloseTo(0.5, 2);
  }, 120_000);

  it('probe returns 30/1 and hasAlpha for a generated RGBA clip, and none for an opaque one', async () => {
    const dir = work();
    const rgba = path.join(dir, 'alpha.mov');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=64x64:r=30:d=1,format=rgba', '-c:v', 'qtrle', rgba]);
    const info = await probe(rgba);
    expect(info.video?.fps.text).toBe('30/1');
    expect(info.hasAlpha).toBe(true);
    expect(info.hasAudio).toBe(false);
    expect(info.durationSec).toBeCloseTo(1, 1);
    const frame = await frameAt(rgba, 0.5, { format: 'rgba' });
    expect(alphaCoverage(frame)).toBe(1);
    const opaque = path.join(dir, 'opaque.mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=25:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-pix_fmt', 'yuv420p', opaque]);
    const plain = await probe(opaque, { frames: true });
    expect(plain.video?.fps.text).toBe('25/1');
    expect(plain.hasAlpha).toBe(false);
    expect(plain.hasAudio).toBe(true);
    expect(plain.frameTimes?.length).toBe(25);
  }, 120_000);

  it('measures ink, luminance, contrast and colour clusters', () => {
    const width = 100;
    const height = 50;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const accent = x >= 40 && x < 60 && y >= 20 && y < 30;
        data.set(accent ? [139, 109, 255, 255] : [14, 15, 26, 255], i);
      }
    }
    const frame: Frame = { data, width, height, format: 'rgba' };
    expect(inkFraction(frame)).toBeCloseTo(200 / 5000, 5);
    const ground = regionLuminance(frame, { x: 0, y: 0, width: 10, height: 10 });
    const accent = regionLuminance(frame, { x: 40, y: 20, width: 20, height: 10 });
    expect(ground).toBeCloseTo(relativeLuminance(14, 15, 26), 6);
    expect(contrastRatio(accent, ground)).toBeGreaterThan(4.5);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6);
    const clusters = colorClusters(frame, { seed: 1 });
    expect(clusters.map((cluster) => cluster.hex)).toEqual(['#0E0F1A', '#8B6DFF']);
    expect(clusters[0]?.share).toBeCloseTo(0.96, 2);
    expect(colorClusters(frame, { seed: 1 })).toEqual(clusters);
  });
});

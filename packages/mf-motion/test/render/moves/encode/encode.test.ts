// The RGBA master and its encodes (render-and-encode.md): the fixture move in
// alpha mode yields a ProRes 4444 .mov with alpha, a VP9 .webm with alpha, a
// -key.mp4 whose background passes key purity and a -preview.mp4 over the brand
// ground, each with the exact frame count and the standalone file names; a
// short render fails RENDER_FAILED; the disk estimate refuses DISK_LOW; --gate
// builds the round and runs the gate.
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { isMfmError } from '../../../../src/cli/errors';
import { type Engine, packageRoot } from '../../../../src/engine/index';
import { NUMBERS } from '../../../../src/kit/numbers';
import { parseHex } from '../../../../src/kit/oklch';
import { registerMoves } from '../../../../src/library/registry';
import { frameAt } from '../../../../src/media/pixels';
import { probe } from '../../../../src/media/probe';
import { buildMove } from '../../../../src/moves/build';
import { growMask, outputName, placementBase, standaloneBase } from '../../../../src/moves/encode';
import { checkDisk, estimateBytes, expectedFrames, masterFrame, renderMaster } from '../../../../src/moves/render';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';
import * as fixtureCard from '../../../fixtures/moves/fixture-card/index';

let engine: Engine;
const temp = (name: string) => realpathSync.native(mkdtempSync(path.join(tmpdir(), `mfm-encode-${name}-`)));
const home = temp('home');
const env = () => ({ MF_MOTION_CACHE: testCacheRoot(), MF_MOTION_HOME: home });
const FRAMES = expectedFrames(fixtureCard.meta.durationSec.default, '30');

beforeAll(async () => {
  registerMoves([{ meta: fixtureCard.meta, source: 'user', dir: null, load: async () => fixtureCard }]);
  ({ engine } = await testBrowser());
}, 900_000);

afterAll(() => registerMoves([]));

type Data = {
  master: string | null;
  outputs: Array<{ format: string; path: string; bytes: number; keyColor?: string; keyPurity?: { pass: boolean; impurePixels: number; checkedPixels: number } }>;
  keyColor: string | null;
  verdict: string | null;
  build: string;
  gate: { round: string; packet: { dir: string; hash: string }; level: string | null } | null;
};

async function moveRender(args: string[]): Promise<{ code: number; data: Data; next: string[]; stdout: string }> {
  const result = await runIn(['move', 'render', 'fixture-card', ...args, '--json'], COMMANDS, env());
  const envelope = JSON.parse(result.stdout);
  return { code: result.code, data: envelope.data, next: envelope.next ?? [], stdout: result.stdout };
}

const streamOf = (raw: unknown) => (raw as { streams: Array<Record<string, unknown>> }).streams.find((stream) => stream.codec_type === 'video') as Record<string, unknown>;

describe('move render: alpha mode', () => {
  let out = '';
  let data: Data;

  beforeAll(async () => {
    out = temp('alpha');
    const result = await moveRender(['--brand', 'demo:tessarine', '--aspect', '9:16', '--mode', 'alpha', '--formats', 'mov,webm,key-mp4,mp4', '--out', out]);
    expect(result.code, result.stdout).toBe(0);
    data = result.data;
  }, 600_000);

  it('writes the four files under the standalone names, removes the master and keeps the build', () => {
    const base = 'fixture-card_1080x1920_alpha';
    expect(standaloneBase('fixture-card', { width: 1080, height: 1920 }, 'alpha')).toBe(base);
    expect(data.outputs.map((output) => [output.format, path.basename(output.path)])).toEqual([
      ['mov', `${base}.mov`],
      ['webm', `${base}.webm`],
      ['key-mp4', `${base}-key.mp4`],
      ['mp4', `${base}-preview.mp4`],
    ]);
    for (const output of data.outputs) expect(output.bytes).toBeGreaterThan(0);
    expect(data.master).toBeNull();
    expect(existsSync(path.join(out, 'master'))).toBe(false);
    expect(existsSync(path.join(data.build, 'index.html'))).toBe(true);
    expect(data.verdict).toBeNull();
    expect(data.gate).toBeNull();
  });

  it('every file holds exactly round(duration x fps) frames at 1080x1920', async () => {
    for (const output of data.outputs) {
      const info = await probe(output.path, { frames: true });
      expect(info.frameTimes?.length, output.format).toBe(FRAMES);
      expect([info.video?.width, info.video?.height]).toEqual([1080, 1920]);
    }
  }, 120_000);

  it('the .mov is ProRes 4444 with alpha and the .webm is VP9 with alpha', async () => {
    const mov = await probe(data.outputs[0]?.path as string);
    const movStream = streamOf(mov.raw);
    expect(movStream.codec_name).toBe('prores');
    expect(movStream.profile).toBe('4444');
    expect(movStream.codec_tag_string).toBe('ap4h');
    // Encoded as yuva444p10le; FFmpeg's ProRes decoder reports 4444 streams at 12 bits.
    expect(mov.video?.pixFmt).toMatch(/^yuva444p1[02]le$/);
    expect(mov.hasAlpha).toBe(true);
    const webm = await probe(data.outputs[1]?.path as string);
    expect(webm.video?.codec).toBe('vp9');
    expect(webm.hasAlpha).toBe(true);
    // The first frame of an overlay is empty: fully transparent in both alpha files.
    for (const file of [data.outputs[0]?.path, data.outputs[1]?.path] as string[]) {
      const first = await frameAt(file, 0, { format: 'rgba', width: 270 });
      let opaque = 0;
      for (let i = 3; i < first.data.length; i += 4) if ((first.data[i] ?? 0) > 8) opaque += 1;
      expect(opaque, file).toBe(0);
    }
  }, 120_000);

  it('the -key.mp4 sits on the key colour and its background passes key purity', async () => {
    const key = data.outputs[2];
    expect(data.keyColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(key?.keyColor).toBe(data.keyColor);
    expect(key?.keyPurity).toMatchObject({ pass: true, impurePixels: 0 });
    expect(key?.keyPurity?.checkedPixels).toBeGreaterThan(1080 * 1920);
    const corner = await frameAt(key?.path as string, 1.7, { format: 'rgba' });
    const rgb = parseHex(data.keyColor as string);
    for (let c = 0; c < 3; c += 1) expect(Math.abs((corner.data[c] ?? 0) - (rgb[c] ?? 0))).toBeLessThanOrEqual(NUMBERS['key.purityLevels']);
  }, 120_000);

  it('the -preview.mp4 shows the move over the brand ground', async () => {
    const preview = await frameAt(data.outputs[3]?.path as string, 1.7, { format: 'rgba' });
    // The corner is the brand ground; the card covers the top of the copy box.
    const brand = JSON.parse(readFileSync(path.join(packageRoot(), 'assets', 'demo-brands', 'tessarine', 'brand.json'), 'utf8')) as { colors: { ground: string } };
    const rgb = parseHex(brand.colors.ground);
    for (let c = 0; c < 3; c += 1) expect(Math.abs((preview.data[c] ?? 0) - (rgb[c] ?? 0))).toBeLessThanOrEqual(2);
    const cardPixel = (300 * preview.width + 300) * 4;
    expect(Math.abs((preview.data[cardPixel] ?? 0) - (rgb[0] ?? 0)) + Math.abs((preview.data[cardPixel + 2] ?? 0) - (rgb[2] ?? 0))).toBeGreaterThan(6);
  }, 120_000);
});

describe('move render: other modes and formats', () => {
  it('full mode writes <id>_<WxH>_full.mp4 by default; png keeps the master as frame-%05d.png', async () => {
    const out = temp('full');
    const result = await moveRender(['--brand', 'demo:mossmallow', '--aspect', '16:9', '--mode', 'full', '--formats', 'mp4,png', '--out', out]);
    expect(result.code, result.stdout).toBe(0);
    expect(result.data.outputs.map((output) => [output.format, path.basename(output.path)])).toEqual([
      ['mp4', 'fixture-card_1920x1080_full.mp4'],
      ['png', 'master'],
    ]);
    expect(result.data.master).toBe(path.join(out, 'master'));
    const frames = readdirSync(path.join(out, 'master')).sort();
    expect(frames.length).toBe(FRAMES);
    expect(frames[0]).toBe(masterFrame(1));
    expect(frames.at(-1)).toBe(masterFrame(FRAMES));
    expect(result.data.keyColor).toBeNull();
  }, 600_000);

  it('key mode writes -key.mp4 by default and its background passes key purity', async () => {
    const out = temp('key');
    const result = await moveRender(['--brand', 'demo:quillfen', '--aspect', '16:9', '--mode', 'key', '--keep-master', '--out', out]);
    expect(result.code, result.stdout).toBe(0);
    expect(result.data.outputs.map((output) => path.basename(output.path))).toEqual(['fixture-card_1920x1080_key-key.mp4']);
    expect(result.data.outputs[0]?.keyPurity).toMatchObject({ pass: true, impurePixels: 0 });
    expect(result.data.master).toBe(path.join(out, 'master'));
    expect(existsSync(path.join(out, 'master', masterFrame(1)))).toBe(true);
  }, 600_000);

  it('a render shorter than round(duration x fps) fails RENDER_FAILED with expected and got', async () => {
    const out = temp('short');
    const built = await buildMove({ id: 'fixture-card', brand: 'demo:tessarine', aspect: '16:9', mode: 'alpha', out, home, engine });
    // The composition lasts its default length; the master is asked for half a second more.
    const longer = fixtureCard.meta.durationSec.default + 0.5;
    const error = await renderMaster(built.build, { fps: '30', durationSec: longer, work: out, engine, width: 1920, height: 1080 }).catch((caught: unknown) => caught);
    expect(isMfmError(error) && error.code).toBe('RENDER_FAILED');
    expect((error as { details: Record<string, unknown> }).details).toMatchObject({ expected: FRAMES + 15, got: FRAMES });
  }, 600_000);
});

describe('move render: names, disk and gate', () => {
  it('names placement files <MM>m<SS>s<FF>f_<move-id>[_<mode>] on the footage clock', () => {
    expect(placementBase(83.4, '30', 'message-cascade', 'alpha')).toBe('01m23s12f_message-cascade_alpha');
    expect(placementBase(0, '25', 'stat-count')).toBe('00m00s00f_stat-count');
    expect(placementBase(59.99, '30000/1001', 'stat-count', 'key')).toBe('00m59s29f_stat-count_key');
    expect(outputName('mp4', 'x', 'full')).toBe('x.mp4');
    expect(outputName('mp4', 'x', 'key')).toBe('x.mp4');
  });

  it('refuses DISK_LOW when the estimate would leave less than disk.doctorFailGb free', () => {
    const bytes = estimateBytes(['mov', 'webm', 'mp4'], { width: 1080, height: 1920, fps: '30', durationSec: 6 });
    // ProRes 4444 dominates: about 40 MB/s plus the master at 1080p30.
    expect(bytes).toBeGreaterThan(6 * 40e6);
    const floor = NUMBERS['disk.doctorFailGb'];
    expect(() => checkDisk('/any', bytes, () => floor + 10)).not.toThrow();
    let caught: unknown;
    try {
      checkDisk('/any', bytes, () => floor + bytes / 1024 ** 3 / 2);
    } catch (error) {
      caught = error;
    }
    expect(isMfmError(caught) && caught.code).toBe('DISK_LOW');
    expect((caught as { details: Record<string, unknown> }).details).toMatchObject({ minimumGb: floor });
  });

  it('grows a content mask by the edge band', () => {
    const mask = new Uint8Array(11 * 11);
    mask[5 * 11 + 5] = 1;
    const grown = growMask(mask, 11, 11, 2);
    expect([...grown].filter(Boolean).length).toBe(25);
    expect(grown[3 * 11 + 3]).toBe(1);
    expect(grown[2 * 11 + 5]).toBe(0);
  });

  it('--gate builds the round; without scores the verdict waits for the judge, with --no-vision the gate decides', async () => {
    const out = temp('gate');
    const waiting = await moveRender(['--brand', 'demo:tessarine', '--aspect', '16:9', '--mode', 'alpha', '--formats', 'webm', '--gate', '--out', out]);
    expect(waiting.code, waiting.stdout).toBe(0);
    expect(waiting.data.verdict).toBeNull();
    expect(waiting.data.gate?.level).toBeNull();
    const round = path.join(out, 'round');
    expect(waiting.data.gate?.round).toBe(round);
    for (const file of ['lint.json', 'audit.json', 'metrics.json', 'packet/packet.json']) expect(existsSync(path.join(round, file)), file).toBe(true);
    expect(waiting.next[0]).toContain('scores.json');
    const measured = await moveRender(['--brand', 'demo:tessarine', '--aspect', '16:9', '--mode', 'alpha', '--formats', 'webm', '--gate', '--no-vision', '--out', out]);
    // The fixture shows ink by 0.3 s, ends empty and holds its lines: no hard failure, no cap.
    expect(measured.data.verdict, measured.stdout).toBe('PASS-MEASURED');
    expect(measured.code).toBe(0);
    expect(measured.data.gate?.packet.hash).toBe(waiting.data.gate?.packet.hash);
    const verdict = JSON.parse(readFileSync(path.join(round, 'verdict.json'), 'utf8'));
    expect(verdict.hardFailures).toEqual([]);
    const metrics = JSON.parse(readFileSync(path.join(round, 'metrics.json'), 'utf8'));
    expect(metrics.caps).toEqual([]);
  }, 900_000);
});

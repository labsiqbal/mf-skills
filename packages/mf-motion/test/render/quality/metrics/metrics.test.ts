// measure on seeded-defect videos: a freeze, a black frame 0, an overlay that
// never empties, key bleed, a one-frame clip, and a clean file that passes.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { measure } from '../../../../src/quality/metrics';
import { readDoc } from '../../../../src/schemas/index';
import { runIn } from '../../../unit/cli/harness';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let dir = '';

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

const video = (name: string) => path.join(dir, name);
const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', '30'];
const hard = (metrics: Record<string, any>, check: string) => (metrics.hard as Array<{ check: string; pass: boolean }>).find((entry) => entry.check === check);

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mfm-metrics-'));
  const src = 'testsrc2=size=640x360:rate=30';
  ffmpeg(['-f', 'lavfi', '-i', `${src}:duration=4`, ...h264, video('clean-broll.mp4')]);
  // 1.5 s moving, 3 s frozen on one frame, 1.5 s moving.
  ffmpeg(['-f', 'lavfi', '-i', `${src}:duration=6`, '-vf', "select='lt(t,1.5)+gte(t,4.5)+eq(n,45)',setpts=N/30/TB", ...h264, video('pieces.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', `${src}:duration=1.5`, '-f', 'lavfi', '-i', `${src}:duration=6`, '-filter_complex',
    "[0:v]setpts=PTS-STARTPTS[a];[1:v]trim=start=1.5:end=1.5333,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2.9667[b];[1:v]trim=start=4.5:end=6,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0",
    ...h264, video('freeze.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=30:duration=0.0334', '-f', 'lavfi', '-i', `${src}:duration=3`, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', ...h264, video('black-frame0.mp4')]);
  // RGBA overlays: an opaque white box (alpha set explicitly) on a transparent frame.
  const rgba = ['-c:v', 'qtrle', '-pix_fmt', 'argb', '-r', '30'];
  const box = (when: string) => `geq=r='255':g='255':b='255':a='if(between(X,200,439)*between(Y,120,239)*(${when}),255,0)'`;
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:size=640x360:rate=30:duration=3,format=rgba', '-vf', box('1'), ...rgba, video('overlay-full.mov')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:size=640x360:rate=30:duration=3,format=rgba', '-vf', box('between(T,0.2,2.5)'), ...rgba, video('overlay-clean.mov')]);
  const key = ['-c:v', 'libx264rgb', '-crf', '0', '-preset', 'veryfast', '-r', '30'];
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x00FF00:size=640x360:rate=30:duration=2', '-vf', "geq=r='if(lt(hypot(X-320,Y-180),90),255,0)':g='if(lt(hypot(X-320,Y-180),90),255,255)':b='if(lt(hypot(X-320,Y-180),90),255,0)'", ...key, video('key-clean.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x00FF00:size=640x360:rate=30:duration=2', '-vf', "geq=r='if(lt(hypot(X-320,Y-180),90),255,0)':g='255':b='if(lt(hypot(X-320,Y-180),90),255,0)',gblur=sigma=3", ...key, video('key-bleed.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', `${src}:duration=0.0334`, '-frames:v', '1', ...h264, video('one-frame.mp4')]);
}, 300_000);

describe('measure', () => {
  it('a clean fixture passes every hard check', async () => {
    const metrics = await measure(video('clean-broll.mp4'), { profile: 'broll', expectedSec: 4 });
    expect(metrics).toMatchObject({ durationSec: 4, frames: 120, fps: '30', mode: 'full', aspect: '16:9', key: null, audio: null, overlayCoverage: null });
    expect((metrics.hard as Array<{ pass: boolean }>).every((entry) => entry.pass)).toBe(true);
    expect(metrics.caps).toEqual([]);
    expect(metrics.frame0Ink).toBeGreaterThan(0.03);
  }, 120_000);

  it('a 3 s freeze is a 3.0 s still stretch and caps rhythm at 6', async () => {
    const metrics = await measure(video('freeze.mp4'), { profile: 'broll', expectedSec: 6 });
    const longest = metrics.longestStillSec as number;
    expect(longest).toBeCloseTo(3.0, 6);
    expect(metrics.caps).toEqual([expect.objectContaining({ axis: 'rhythm', cap: 6 })]);
  }, 120_000);

  it('a black frame 0 in broll is under 3% ink and caps hook at 5', async () => {
    const metrics = await measure(video('black-frame0.mp4'), { profile: 'broll' });
    expect(metrics.frame0Ink).toBeLessThan(0.03);
    expect(metrics.caps).toEqual(expect.arrayContaining([expect.objectContaining({ axis: 'hook', cap: 5 })]));
  }, 120_000);

  it('an overlay that never empties fails overlay-empty; a clean one passes', async () => {
    const full = await measure(video('overlay-full.mov'), { profile: 'overlay-alpha', expectedSec: 3 });
    expect(hard(full, 'overlay-empty')).toMatchObject({ pass: false });
    expect(full.overlayCoverage).toMatchObject({ first: 0.125, last: 0.125, firstInkSec: 0 });
    expect(full.frame0Ink).toBeNull();
    const clean = await measure(video('overlay-clean.mov'), { profile: 'overlay-alpha', expectedSec: 3 });
    expect(hard(clean, 'overlay-empty')).toMatchObject({ pass: true });
    expect(clean.overlayCoverage).toMatchObject({ first: 0, last: 0, firstInkSec: 0.2 });
  }, 120_000);

  it('a key colour bleeding into anti-aliased edges fails key-purity', async () => {
    const clean = await measure(video('key-clean.mp4'), { profile: 'overlay-key', keyColor: '#00FF00' });
    expect(hard(clean, 'key-purity')).toMatchObject({ pass: true });
    const bleed = await measure(video('key-bleed.mp4'), { profile: 'overlay-key', keyColor: '#00FF00' });
    expect(hard(bleed, 'key-purity')).toMatchObject({ pass: false });
    expect((bleed.key as { impurePixels: number }).impurePixels).toBeGreaterThan(100);
  }, 120_000);

  it('a clip one frame long fails duration', async () => {
    const metrics = await measure(video('one-frame.mp4'), { profile: 'broll', expectedSec: 2 });
    expect(hard(metrics, 'duration')).toMatchObject({ pass: false, value: '0.033 s', limit: '2 s +-1 frame' });
  }, 120_000);

  it('measures contrast per line from an audit report', async () => {
    copyFileSync(path.join(packageRoot, 'test', 'fixtures', 'metrics', 'audit-lines.json'), video('audit.json'));
    const metrics = await measure(video('clean-broll.mp4'), { profile: 'broll', expectedSec: 4 });
    expect(metrics.contrast).toEqual([expect.objectContaining({ elementId: 'headline', atSec: 2, plate: null, ratio: expect.any(Number) })]);
    expect(metrics.lines).toEqual([{ elementId: 'headline', inSec: 0.5, outSec: 3.5, holdSec: 2.6, words: 3, ok: true }]);
  }, 120_000);
});

describe('measure command', () => {
  it('writes a schema-valid metrics.json beside the video', async () => {
    // Its own folder: no audit.json from another case beside it.
    const own = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-measure-')), 'freeze.mp4');
    copyFileSync(video('freeze.mp4'), own);
    const result = await runIn(['measure', own, '--profile', 'broll', '--expected', '6', '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data.metrics).toBe(path.join(path.dirname(own), 'metrics.json'));
    const { doc } = readDoc('metrics', data.metrics);
    expect(doc.caps).toEqual([expect.objectContaining({ axis: 'rhythm', cap: 6 })]);
    const bad = await runIn(['measure', video('freeze.mp4'), '--profile', 'cinema', '--json'], COMMANDS, {});
    expect(bad.code).toBe(2);
  }, 120_000);
});

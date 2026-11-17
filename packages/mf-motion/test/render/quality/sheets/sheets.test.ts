// Sheets for a generated 4 s move (dense every 0.25 s, move phone at 360 px),
// an alpha overlay (plates) and a two-scene film build (engine beats, seams
// and phone sheets, check.json with finding crops).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { type Engine, copyVendor } from '../../../../src/engine/index';
import { frameAt } from '../../../../src/media/pixels';
import { probe } from '../../../../src/media/probe';
import { readCheck, runCheck } from '../../../../src/quality/check';
import { PHONE_WIDTH, makeSheets } from '../../../../src/quality/sheets';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

let dir = '';
let engine: Engine;
let browserPath = '';

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

/** A two-scene film build with one text overflow and one low-contrast caption in the first scene. */
function filmBuild(): string {
  const build = path.join(dir, 'film-build');
  mkdirSync(build);
  copyVendor(build, { engineDir: engine.dir });
  writeFileSync(path.join(build, 'hyperframes.json'), JSON.stringify({ name: 'sheets-fixture' }));
  writeFileSync(
    path.join(build, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #000; }
#main { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #123; }
.scene { position: absolute; inset: 0; }
h1 { position: absolute; left: 100px; top: 300px; margin: 0; color: #FFF; font: 700 72px sans-serif; }
#low { position: absolute; left: 100px; top: 500px; margin: 0; color: #2A4A6A; font: 400 28px sans-serif; }
#off { left: 1100px; top: 100px; }
</style></head><body>
<div id="main" data-composition-id="main" data-width="1280" data-height="720" data-duration="4" data-fps="30">
<div id="s1" class="scene clip" data-start="0" data-duration="2" data-track-index="0" style="background:#246"><h1 id="t1">First scene</h1><p id="low">Low contrast caption</p><h1 id="off">Overflowing title</h1></div>
<div id="s2" class="scene clip" data-start="2" data-duration="2" data-track-index="0" style="background:#642"><h1 id="t2">Second scene</h1></div>
</div>
<script src="vendor/gsap/gsap.min.js"></script>
<script>
const tl = gsap.timeline({ paused: true });
tl.from('#t1', { opacity: 0, y: 40, duration: 0.5 }, 0.2);
tl.from('#t2', { opacity: 0, y: 40, duration: 0.5 }, 2.2);
tl.set({}, {}, 4);
window.__timelines = window.__timelines || {};
window.__timelines.main = tl;
</script>
</body></html>
`,
  );
  return build;
}

const env = () => ({ MF_MOTION_CACHE: testCacheRoot() });

beforeAll(async () => {
  ({ engine, browserPath } = await testBrowser());
  dir = mkdtempSync(path.join(tmpdir(), 'mfm-sheets-test-'));
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'move.mp4')]);
  const box = "geq=r='255':g='255':b='255':a='if(between(X,200,439)*between(Y,120,239)*between(T,0.2,2.5),255,0)'";
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:size=640x360:rate=30:duration=3,format=rgba', '-vf', box, '-c:v', 'qtrle', '-pix_fmt', 'argb', '-r', '30', path.join(dir, 'overlay.mov')]);
}, 900_000);

describe('sheets', () => {
  it('a 4 s move gets a dense sheet of 16 timestamped frames and a phone sheet at 360 px wide', async () => {
    const out = path.join(dir, 'move-sheets');
    const result = await runIn(['sheets', path.join(dir, 'move.mp4'), '--dense', '0.25', '--phone', '--out', out, '--json'], COMMANDS, env());
    expect(result.code, result.stdout).toBe(0);
    const sheets = (JSON.parse(result.stdout) as { data: { sheets: Array<{ role: string; path: string; labels?: string[] }> } }).data.sheets;
    expect(sheets.map((sheet) => sheet.role)).toEqual(['dense', 'phone']);
    const dense = sheets[0]!;
    expect(dense.path).toBe(path.join(out, 'dense.png'));
    expect(dense.labels).toEqual(Array.from({ length: 16 }, (_, i) => `${(i * 0.25).toFixed(2)} s`));
    const phone = sheets[1]!;
    expect(phone.labels).toEqual(['0.30 s', '2.00 s', '3.50 s']);
    // Three 360 px cells in one row: 24 px padding each side and two 12 px gaps.
    const info = await probe(phone.path);
    expect(info.video?.width).toBe(24 * 2 + 3 * PHONE_WIDTH + 2 * 12);
    // Each cell holds a picture: the middle of the first cell is not the sheet background.
    const pixels = await frameAt(phone.path, 0, { format: 'rgba' });
    const at = (x: number, y: number) => Array.from(pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3));
    expect(at(24 + 180, 24 + 100)).not.toEqual([20, 20, 20]);
  }, 300_000);

  it('an alpha overlay gets a plates sheet with 9 cells', async () => {
    const out = path.join(dir, 'overlay-sheets');
    const result = await runIn(['sheets', path.join(dir, 'overlay.mov'), '--plates', '--out', out, '--json'], COMMANDS, env());
    expect(result.code, result.stdout).toBe(0);
    const sheets = (JSON.parse(result.stdout) as { data: { sheets: Array<{ role: string; path: string; labels?: string[] }> } }).data.sheets;
    const plates = sheets.find((sheet) => sheet.role === 'plates');
    expect(plates?.labels).toHaveLength(9);
    expect(plates?.labels).toEqual(['25% at 0.75 s', '25% at 0.75 s', '25% at 0.75 s', '50% at 1.50 s', '50% at 1.50 s', '50% at 1.50 s', '75% at 2.25 s', '75% at 2.25 s', '75% at 2.25 s']);
    // Over plate-light (column 2) the white box at 25% is the plate colour around it, then white inside.
    const pixels = await frameAt(plates!.path, 0, { format: 'rgba' });
    const at = (x: number, y: number) => Array.from(pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3));
    const cellX = 24 + 400 + 12;
    expect(at(cellX + 10, 24 + 10)).toEqual([242, 242, 242]);
    expect(at(cellX + 200, 24 + 112)).toEqual([255, 255, 255]);
  }, 300_000);

  it('a film build gets the engine beats, seams and phone sheets, a valid check.json and finding crops', async () => {
    const build = filmBuild();
    const { file, doc } = await runCheck(build, { engine });
    expect(readCheck(file)).toEqual(doc);
    expect(doc.errors).toBeGreaterThanOrEqual(2);
    expect(doc.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(['text_box_overflow', 'contrast_aa_failure']));
    expect(doc.findingCrops.length).toBeGreaterThanOrEqual(2);
    expect(doc.findingCrops.every((crop) => existsSync(crop.path))).toBe(true);
    // Most severe first.
    const ranks = doc.findingCrops.map((crop) => ['error', 'warning', 'info'].indexOf(crop.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    const out = path.join(dir, 'film-sheets');
    const { sheets } = await makeSheets(path.join(dir, 'move.mp4'), { out, build, engine, browserPath });
    const roles = sheets.map((sheet) => sheet.role);
    expect(roles).toEqual(expect.arrayContaining(['beats', 'seams-01', 'phone', 'dense', 'finding-01', 'finding-02']));
    expect(roles.filter((role) => role.startsWith('finding-')).length).toBeLessThanOrEqual(6);
    for (const sheet of sheets) expect(existsSync(sheet.path), sheet.role).toBe(true);
    expect(sheets.find((sheet) => sheet.role === 'beats')?.path).toBe(path.join(out, 'beats.jpg'));
    expect(sheets.find((sheet) => sheet.role === 'seams-01')?.path).toBe(path.join(out, 'seams-01.jpg'));
    expect(sheets.find((sheet) => sheet.role === 'dense')?.labels).toHaveLength(8);
  }, 900_000);
});

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { engineDirFor, enginePins, lockSha256, packageRoot, writeOk } from '../../../../src/engine/index';
import { probe } from '../../../../src/media/probe';
import { run } from '../../../../src/proc/run';
import { readDoc } from '../../../../src/schemas/index';
import { testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

let root: string;
const project = () => path.join(root, 'project');

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-transcribe-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

async function ffmpeg(args: string[]) {
  const result = await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
    timeoutMs: 60_000, killTree: true,
  });
  expect(result.code, result.stderr).toBe(0);
  return result.stdout;
}

function cli(args: string[], cache = path.join(root, 'cache')) {
  return runIn([...args, '--json'], COMMANDS, {
    ...process.env, MF_MOTION_CACHE: cache, MF_MOTION_HOME: path.join(root, 'home'),
  });
}

async function newProject(footage: string) {
  const result = await cli(['new', 'Transcribe fixture', '--type', 'moves', '--dir', project(), '--footage', footage]);
  expect(result.code, result.stdout).toBe(0);
}

async function cfrSource(audio?: string) {
  const source = path.join(root, 'source.mp4');
  await ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25',
    ...(audio ? ['-i', audio, '-shortest', '-c:a', 'aac'] : ['-t', '2']),
    '-c:v', 'libx264', source,
  ]);
  return source;
}

const transcript = () => readDoc('transcript', path.join(project(), 'media', 'transcript.json')).doc;
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

it('normalizes alternating frame durations, retains the source timecode and keeps the marker within one frame', async () => {
  const source = path.join(root, 'vfr.mov');
  await ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=60',
    '-vf', "drawbox=color=white:t=fill:enable='between(n,20,22)',setpts='N+2*floor(N/2)'",
    '-frames:v', '60', '-fps_mode', 'vfr', '-enc_time_base', '1:60',
    '-c:v', 'libx264', '-bf', '0', '-timecode', '01:02:03:04', source,
  ]);
  const input = await probe(source, { frames: true });
  expect(input.frameTimes?.slice(0, 4)).toEqual([0, 0.016667, 0.066667, 0.083333]);
  expect(input.video?.fps.value).toBe(60);

  await newProject(source);
  const subtitles = path.join(root, 'source.srt');
  writeFileSync(subtitles, '1\n00:00:00,100 --> 00:00:01,100\na bbbb\n\n2\n00:00:01,800 --> 00:00:02,000\nNext.\n');
  const result = await cli(['transcribe', '--project', project(), '--transcript', subtitles]);
  expect(result.code, result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).data).toEqual({
    footage: { path: 'media/footage-cfr.mp4', fps: '30', vfrFixed: true },
    transcript: 'media/transcript.json', words: 3, lines: 2,
  });
  const output = path.join(project(), 'media', 'footage-cfr.mp4');
  const info = await probe(output, { frames: true });
  expect(info.video?.fps.value).toBe(30);
  expect(info.video?.avgFps?.value).toBe(30);
  for (const [index, timestamp] of (info.frameTimes ?? []).entries()) {
    expect(timestamp).toBeCloseTo(index / 30, 5);
  }
  const stats = await ffmpeg(['-i', output, '-vf', 'signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']);
  const marker = /frame:\s*(\d+)[^\n]*\n\s*lavfi.signalstats.YAVG=235\b/.exec(stats);
  expect(marker).not.toBeNull();
  expect(Math.abs(Number(marker?.[1]) - 20)).toBeLessThanOrEqual(1);
  expect(JSON.parse(readFileSync(path.join(project(), 'project.json'), 'utf8')).fps).toBe('30');
  expect(JSON.parse(readFileSync(path.join(project(), 'media', 'probe.json'), 'utf8')).timecode).toBe('01:02:03:04');
  expect(transcript().words).toEqual([
    { w: 'a', start: 0.1, end: 0.30000000000000004, conf: 1 },
    { w: 'bbbb', start: 0.30000000000000004, end: 1.1, conf: 1 },
    { w: 'Next.', start: 1.8, end: 2, conf: 1 },
  ]);
});

it('copies CFR bytes and imports WebVTT without consulting the Whisper cache', async () => {
  const source = await cfrSource();
  await newProject(source);
  const subtitles = path.join(root, 'source.vtt');
  writeFileSync(subtitles, 'WEBVTT\n\n00:00.100 --> 00:01.100 align:start\n<i>One two three four five six seven eight nine ten.</i>\n');
  const result = await cli(['transcribe', '--project', project(), '--transcript', subtitles]);
  expect(result.code, result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).data.footage).toMatchObject({ fps: '25', vfrFixed: false });
  expect(sha256(path.join(project(), 'media', 'footage-cfr.mp4'))).toBe(sha256(source));
  expect(transcript().lines.map((line) => line.text)).toEqual(['One two three four five six seven eight', 'nine ten.']);
});

it('requires doctor for a missing model and deletes a tampered model before engine execution', async () => {
  const source = await cfrSource();
  await newProject(source);
  const cache = path.join(root, 'cache');
  const engine = engineDirFor(cache, enginePins().hyperframes);
  const pkg = path.join(engine, 'node_modules', 'hyperframes');
  const models = path.join(engine, 'hf-cache', 'whisper', 'models');
  mkdirSync(pkg, { recursive: true, mode: 0o700 });
  mkdirSync(models, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(pkg, 'package.json'), '{}');
  writeOk(engine, { installedAt: new Date().toISOString(), nodeVersion: process.versions.node, lockSha256: lockSha256() });
  const args = ['transcribe', '--project', project(), '--language', 'en'];
  const missing = JSON.parse((await cli(args)).stdout);
  expect(missing.error).toMatchObject({ code: 'ENGINE_MISSING', hint: expect.stringContaining('mf-motion doctor --fix --transcribe') });
  const model = path.join(models, 'ggml-base.en.bin');
  writeFileSync(model, 'tampered');
  const tampered = JSON.parse((await cli(args)).stdout);
  expect(tampered.error).toMatchObject({ code: 'MODEL_HASH_MISMATCH' });
  expect(existsSync(model)).toBe(false);
  expect(existsSync(path.join(project(), 'media', 'transcript.json'))).toBe(false);
});

function wordErrors(expected: readonly string[], actual: readonly string[]): number {
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (const [index, word] of expected.entries()) {
    const current = [index + 1];
    for (const [position, other] of actual.entries()) {
      current.push(Math.min(current[position]! + 1, previous[position + 1]! + 1, previous[position]! + Number(word !== other)));
    }
    previous = current;
  }
  return previous[actual.length]!;
}

it.skipIf(process.env.MFM_TRANSCRIBE_REQUIRED === undefined)('transcribes local TTS with under 15% word error and word starts within 0.15 s', async () => {
  const fixture = path.join(packageRoot(), 'test', 'fixtures', 'media', 'spoken');
  const audio = path.join(fixture, 'speech.wav');
  const normalized = (word: string) => word.toLowerCase().replace(/[^a-z]/g, '');
  const expected = readFileSync(path.join(fixture, 'script.txt'), 'utf8').trim().split(/\s+/).map(normalized);
  const reference = JSON.parse(readFileSync(path.join(fixture, 'timings.json'), 'utf8')) as Array<{ w: string; start: number }>;
  expect(reference.map(({ w }) => normalized(w))).toEqual(expected);
  await newProject(await cfrSource(audio));
  const result = await cli(['transcribe', '--project', project(), '--language', 'en'], testCacheRoot());
  expect(result.code, result.stdout).toBe(0);
  const words = transcript().words;
  const wer = wordErrors(expected, words.map(({ w }) => normalized(w))) / expected.length;
  expect(wer).toBeLessThan(0.15);
  for (const { w, start } of words) {
    const truth = reference.find(({ w: target }) => normalized(target) === normalized(w));
    if (truth) expect(Math.abs(start - truth.start), w).toBeLessThanOrEqual(0.15);
  }
});

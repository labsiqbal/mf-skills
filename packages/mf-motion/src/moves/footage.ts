import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { FFPROBE_TIMEOUT_MS, probe } from '../media/probe';
import { writeJsonAtomic } from '../paths/index';
import { run } from '../proc/run';
import { frameToSec, parseFps } from '../time/grammar';

type Tags = Record<string, string>;

async function frameDurations(file: string): Promise<number[]> {
  const result = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#600',
    '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,duration_time,pkt_duration_time',
    '-of', 'json', file,
  ], { timeoutMs: FFPROBE_TIMEOUT_MS, killTree: true });
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffprobe' });
  if (result.timedOut) throw new MfmError('TIMEOUT', { tool: 'ffprobe', file });
  if (result.code !== 0) throw new MfmError('TOOL_FAILED', { tool: 'ffprobe', file, stderrTail: result.stderr.slice(-2000) });
  const { frames = [] } = JSON.parse(result.stdout) as { frames?: Array<Record<string, string>> };
  return frames.slice(0, 600).flatMap((frame, index) => {
    const delta = Number(frames[index + 1]?.best_effort_timestamp_time) - Number(frame.best_effort_timestamp_time);
    const duration = Number(frame.duration_time ?? frame.pkt_duration_time);
    const seconds = delta > 0 ? delta : duration;
    return Number.isFinite(seconds) && seconds > 0 ? [seconds] : [];
  });
}

/** Copy a CFR source or re-encode VFR footage into a staging folder. */
export async function normaliseFootage(file: string, staging: string): Promise<{ path: string; fps: string; vfrFixed: boolean }> {
  const source = await probe(file);
  if (!source.video) throw new MfmError('USAGE', { file }, { message: 'Footage must contain a video stream.' });
  const average = source.video.avgFps?.value ?? source.video.fps.value;
  const nominal = NUMBERS['fps.move.footageRates'].reduce((best, candidate) =>
    Math.abs(1 / frameToSec(1, parseFps(candidate)) - average) < Math.abs(1 / frameToSec(1, parseFps(best)) - average) ? candidate : best,
  );
  const durations = await frameDurations(file);
  const jitter = durations.length > 1 ? Math.max(...durations) - Math.min(...durations) : 0;
  const vfrFixed = Math.abs(source.video.fps.value - average) / average > 0.001 || jitter > 0.001 + 1e-9;
  const extension = path.extname(file).toLowerCase();
  const target = path.join(staging, `footage-cfr${vfrFixed ? '.mp4' : /^\.[a-z0-9]+$/.test(extension) ? extension : ''}`);
  if (vfrFixed) {
    const result = await run('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file,
      '-fps_mode', 'cfr', '-r', nominal, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', target,
    ], { timeoutMs: 60 * 60_000, killTree: true });
    if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg' });
    if (result.timedOut) throw new MfmError('TIMEOUT', { tool: 'ffmpeg', file });
    if (result.code !== 0) throw new MfmError('VFR_UNSUPPORTED', { file, fps: nominal, stderrTail: result.stderr.slice(-2000) });
  } else {
    await copyFile(file, target);
  }
  const raw = source.raw as { streams?: Array<{ tags?: Tags }>; format?: { tags?: Tags } };
  const timecode = [...(raw.streams ?? []), raw.format].flatMap((entry) => Object.entries(entry?.tags ?? {}))
    .find(([key]) => key.toLowerCase() === 'timecode')?.[1] ?? null;
  writeJsonAtomic(path.join(staging, 'probe.json'), {
    ...source, output: path.basename(target), fps: nominal, vfrFixed, timecode, frameDurationJitterSec: jitter,
  });
  return { path: target, fps: nominal, vfrFixed };
}

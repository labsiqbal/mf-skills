// ffprobe, typed: streams, a rational frame rate, duration, pixel format,
// alpha and audio presence, and (on request) frame timestamps.
import { MfmError } from '../cli/errors';
import { run } from '../proc/run';

export interface Rational {
  num: number;
  den: number;
  /** "30/1", "30000/1001". */
  text: string;
  value: number;
}

export interface VideoStream {
  index: number;
  codec: string;
  width: number;
  height: number;
  pixFmt: string;
  fps: Rational;
  avgFps: Rational | null;
  hasAlpha: boolean;
  frames: number | null;
}

export interface AudioStream {
  index: number;
  codec: string;
  channels: number;
  sampleRate: number;
}

export interface Probe {
  file: string;
  format: string;
  durationSec: number;
  sizeBytes: number | null;
  video: VideoStream | null;
  audio: AudioStream | null;
  hasAlpha: boolean;
  hasAudio: boolean;
  /** Presentation times in seconds of every video frame, when asked for. */
  frameTimes: number[] | null;
  raw: unknown;
}

export const FFPROBE_TIMEOUT_MS = 2 * 60 * 1000;

/** Pixel formats that carry an alpha channel. */
const ALPHA_FORMAT = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya[0-9]|rgba64|bgra64|ayuv)/;

export function parseRational(text: string | undefined): Rational | null {
  if (!text) return null;
  const [numText, denText = '1'] = text.split('/');
  const num = Number(numText);
  const den = Number(denText);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num === 0) return null;
  return { num, den, text: `${num}/${den}`, value: num / den };
}

type RawStream = {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  channels?: number;
  sample_rate?: string;
  tags?: Record<string, string>;
};

async function ffprobeJson(tool: string, show: string[], file: string): Promise<unknown> {
  const result = await run(tool, ['-v', 'error', '-print_format', 'json', ...show, file], {
    timeoutMs: FFPROBE_TIMEOUT_MS,
    maxCaptureBytes: 256 * 1024 * 1024,
  });
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffprobe', spawnError: result.spawnError.code });
  if (result.timedOut) throw new MfmError('TIMEOUT', { tool: 'ffprobe', file });
  if (result.code !== 0) {
    throw new MfmError('TOOL_FAILED', { tool: 'ffprobe', file, stderrTail: result.stderr.slice(-2000) }, { message: `ffprobe could not read ${file}.` });
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new MfmError('TOOL_FAILED', { tool: 'ffprobe', file }, { message: 'ffprobe printed output that is not JSON.' });
  }
}

/** Probe a media file with ffprobe (found on PATH). */
export async function probe(file: string, options: { frames?: boolean; ffprobe?: string } = {}): Promise<Probe> {
  const tool = options.ffprobe ?? 'ffprobe';
  const raw = (await ffprobeJson(tool, ['-show_streams', '-show_format'], file)) as {
    streams?: RawStream[];
    format?: { format_name?: string; duration?: string; size?: string };
  };
  const streams = raw.streams ?? [];
  const v = streams.find((stream) => stream.codec_type === 'video');
  const a = streams.find((stream) => stream.codec_type === 'audio');
  let video: VideoStream | null = null;
  if (v) {
    const fps = parseRational(v.r_frame_rate) ?? parseRational(v.avg_frame_rate);
    if (!fps) throw new MfmError('TOOL_FAILED', { tool: 'ffprobe', file }, { message: `${file} has no readable frame rate.` });
    const pixFmt = v.pix_fmt ?? '';
    const alphaTag = v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE;
    video = {
      index: v.index,
      codec: v.codec_name ?? '',
      width: v.width ?? 0,
      height: v.height ?? 0,
      pixFmt,
      fps,
      avgFps: parseRational(v.avg_frame_rate),
      hasAlpha: ALPHA_FORMAT.test(pixFmt) || alphaTag === '1',
      frames: v.nb_frames ? Number(v.nb_frames) : null,
    };
  }
  const audio: AudioStream | null = a
    ? { index: a.index, codec: a.codec_name ?? '', channels: a.channels ?? 0, sampleRate: Number(a.sample_rate ?? 0) }
    : null;
  let frameTimes: number[] | null = null;
  if (options.frames && video) {
    // A separate pass: selecting the video stream would hide the others from the main probe.
    const timing = (await ffprobeJson(tool, ['-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time,pts_time', '-show_frames'], file)) as {
      frames?: Array<Record<string, string>>;
    };
    frameTimes = (timing.frames ?? [])
      .map((frame) => Number(frame.best_effort_timestamp_time ?? frame.pts_time))
      .filter((time) => Number.isFinite(time));
  }
  return {
    file,
    format: raw.format?.format_name ?? '',
    durationSec: Number(raw.format?.duration ?? 0),
    sizeBytes: raw.format?.size ? Number(raw.format.size) : null,
    video,
    audio,
    hasAlpha: video?.hasAlpha ?? false,
    hasAudio: audio !== null,
    frameTimes,
    raw,
  };
}

// Raw pixels without an image library: FFmpeg decodes to raw bytes on stdout
// and these helpers read them. Frames are greyscale (1 byte per pixel) or
// RGBA (4 bytes per pixel), row-major, top-left first.
import { MfmError } from '../cli/errors';
import { run, runStream } from '../proc/run';
import { type Probe, probe } from './probe';

export type PixelFormat = 'gray' | 'rgba';

export interface Frame {
  data: Uint8Array;
  width: number;
  height: number;
  format: PixelFormat;
}

export interface FrameOptions {
  /** Frames per second to sample. */
  fps: number | string;
  /** Output width; height keeps the aspect ratio (even). Default: source width. */
  width?: number;
  format: PixelFormat;
  ffmpeg?: string;
  timeoutMs?: number;
}

export const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;

const channels = (format: PixelFormat) => (format === 'gray' ? 1 : 4);

/** Output size for a source scaled to `width`, keeping aspect, height rounded to even. */
export function scaledSize(source: { width: number; height: number }, width?: number): { width: number; height: number } {
  const w = width ?? source.width;
  const h = Math.max(2, Math.round((source.height * w) / source.width / 2) * 2);
  return { width: w, height: h };
}

/** Decoder flags so VP9 alpha survives decoding (the native decoder drops it). */
function inputArgs(info: Probe, file: string): string[] {
  const vp9Alpha = info.video?.codec === 'vp9' && info.video.hasAlpha;
  return [...(vp9Alpha ? ['-c:v', 'libvpx-vp9'] : []), '-i', file];
}

function ffmpegFailure(result: { spawnError?: { code: string }; timedOut: boolean; code: number | null; stderr: string }, file: string): MfmError {
  if (result.spawnError) return new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg', spawnError: result.spawnError.code });
  if (result.timedOut) return new MfmError('TIMEOUT', { tool: 'ffmpeg', file });
  return new MfmError('ENCODE_FAILED', { tool: 'ffmpeg', file, code: result.code, stderrTail: result.stderr.slice(-2000) }, {
    message: `FFmpeg could not decode ${file}.`,
  });
}

/** Decoded frames at a fixed rate, one Uint8Array per frame, streamed with backpressure. */
export async function* frames(file: string, options: FrameOptions): AsyncGenerator<Frame> {
  const info = await probe(file);
  if (!info.video) throw new MfmError('TOOL_FAILED', { file }, { message: `${file} has no video stream.` });
  const size = scaledSize(info.video, options.width);
  const bytes = size.width * size.height * channels(options.format);
  const filter = `fps=${options.fps},scale=${size.width}:${size.height}:flags=area,format=${options.format}`;
  const stream = runStream(
    options.ffmpeg ?? 'ffmpeg',
    ['-v', 'error', ...inputArgs(info, file), '-vf', filter, '-f', 'rawvideo', '-pix_fmt', options.format, '-'],
    { timeoutMs: options.timeoutMs ?? FFMPEG_TIMEOUT_MS },
  );
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of stream.chunks) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= bytes) {
      yield { data: new Uint8Array(pending.subarray(0, bytes)), ...size, format: options.format };
      pending = pending.subarray(bytes);
    }
  }
  const result = await stream.result;
  if (result.spawnError || result.timedOut || result.code !== 0) throw ffmpegFailure(result, file);
}

/** One frame at an exact time (accurate seek: `-ss` after `-i`). */
export async function frameAt(
  file: string,
  sec: number,
  options: { width?: number; format?: PixelFormat; ffmpeg?: string } = {},
): Promise<Frame> {
  const info = await probe(file);
  if (!info.video) throw new MfmError('TOOL_FAILED', { file }, { message: `${file} has no video stream.` });
  const format = options.format ?? 'rgba';
  const size = scaledSize(info.video, options.width);
  const stream = runStream(
    options.ffmpeg ?? 'ffmpeg',
    [
      '-v', 'error', ...inputArgs(info, file), '-ss', String(sec), '-frames:v', '1',
      '-vf', `scale=${size.width}:${size.height}:flags=area,format=${format}`,
      '-f', 'rawvideo', '-pix_fmt', format, '-',
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
  const parts: Buffer[] = [];
  for await (const chunk of stream.chunks) parts.push(chunk);
  const result = await stream.result;
  if (result.spawnError || result.timedOut || result.code !== 0) throw ffmpegFailure(result, file);
  const data = Buffer.concat(parts);
  const bytes = size.width * size.height * channels(format);
  if (data.length < bytes) {
    throw new MfmError('TOOL_FAILED', { file, sec }, { message: `No frame at ${sec} s in ${file}.` });
  }
  return { data: new Uint8Array(data.subarray(0, bytes)), ...size, format };
}

/** Write the frame at `sec` as a PNG (for sheets), scaled to `width` when given. */
export async function framePng(file: string, sec: number, out: string, options: { width?: number; ffmpeg?: string } = {}): Promise<string> {
  const info = await probe(file);
  if (!info.video) throw new MfmError('TOOL_FAILED', { file }, { message: `${file} has no video stream.` });
  const size = scaledSize(info.video, options.width);
  const result = await run(
    options.ffmpeg ?? 'ffmpeg',
    ['-v', 'error', '-y', ...inputArgs(info, file), '-ss', String(sec), '-frames:v', '1', '-vf', `scale=${size.width}:${size.height}:flags=area`, out],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
  if (result.spawnError || result.timedOut || result.code !== 0) throw ffmpegFailure(result, file);
  return out;
}

// Statistics used by the metrics.

function assertSameSize(a: Frame, b: Frame): void {
  if (a.width !== b.width || a.height !== b.height || a.format !== b.format) throw new Error('frames differ in size or format');
}

/**
 * Fraction of pixels that changed between two frames: a pixel changed when any
 * channel differs by more than `delta` levels (still.pixelDelta: 6).
 */
export function changedFraction(a: Frame, b: Frame, delta = 6): number {
  assertSameSize(a, b);
  const step = channels(a.format);
  const colour = Math.min(step, 3);
  let changed = 0;
  const pixels = a.width * a.height;
  for (let p = 0; p < pixels; p += 1) {
    const base = p * step;
    for (let c = 0; c < colour; c += 1) {
      if (Math.abs((a.data[base + c] ?? 0) - (b.data[base + c] ?? 0)) > delta) {
        changed += 1;
        break;
      }
    }
  }
  return pixels === 0 ? 0 : changed / pixels;
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Per-channel median colour of the four corner patches (each 2% of the frame, at least 1 px). */
export function cornerMedian(frame: Frame): number[] {
  const step = channels(frame.format);
  const colour = Math.min(step, 3);
  const pw = Math.max(1, Math.round(frame.width * 0.02));
  const ph = Math.max(1, Math.round(frame.height * 0.02));
  const samples: number[][] = Array.from({ length: colour }, () => []);
  const corners = [
    [0, 0],
    [frame.width - pw, 0],
    [0, frame.height - ph],
    [frame.width - pw, frame.height - ph],
  ];
  for (const [x0 = 0, y0 = 0] of corners) {
    for (let y = y0; y < y0 + ph; y += 1) {
      for (let x = x0; x < x0 + pw; x += 1) {
        const base = (y * frame.width + x) * step;
        for (let c = 0; c < colour; c += 1) samples[c]?.push(frame.data[base + c] ?? 0);
      }
    }
  }
  return samples.map(median);
}

/**
 * Fraction of pixels that differ from the corner median by more than `delta`
 * levels on any channel (frame0.inkMin uses 24).
 */
export function inkFraction(frame: Frame, delta = 24): number {
  const step = channels(frame.format);
  const colour = Math.min(step, 3);
  const ground = cornerMedian(frame);
  let ink = 0;
  const pixels = frame.width * frame.height;
  for (let p = 0; p < pixels; p += 1) {
    const base = p * step;
    for (let c = 0; c < colour; c += 1) {
      if (Math.abs((frame.data[base + c] ?? 0) - (ground[c] ?? 0)) > delta) {
        ink += 1;
        break;
      }
    }
  }
  return pixels === 0 ? 0 : ink / pixels;
}

/** Fraction of RGBA pixels with alpha above `threshold` (default 8 of 255, below codec noise). */
export function alphaCoverage(frame: Frame, threshold = 8): number {
  if (frame.format !== 'rgba') throw new Error('alpha coverage needs an rgba frame');
  const pixels = frame.width * frame.height;
  let covered = 0;
  for (let p = 0; p < pixels; p += 1) if ((frame.data[p * 4 + 3] ?? 0) > threshold) covered += 1;
  return pixels === 0 ? 0 : covered / pixels;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const linear = (level: number) => {
  const c = level / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance (WCAG 2) of an sRGB colour given as 0-255 levels. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Mean relative luminance of a region (clipped to the frame). */
export function regionLuminance(frame: Frame, region: Region): number {
  const step = channels(frame.format);
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(frame.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(frame.height, Math.ceil(region.y + region.height));
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const base = (y * frame.width + x) * step;
      const r = frame.data[base] ?? 0;
      sum += step === 1 ? linear(r) : relativeLuminance(r, frame.data[base + 1] ?? 0, frame.data[base + 2] ?? 0);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** WCAG contrast ratio of two relative luminances (1 to 21). */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Cluster {
  rgb: [number, number, number];
  hex: string;
  share: number;
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

const toHex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export interface ClusterOptions {
  k?: number;
  seed?: number;
  /** Clusters closer than this RGB distance are merged (28). */
  mergeDistance?: number;
  /** Pixels sampled at most (evenly strided). */
  maxSamples?: number;
  iterations?: number;
  /** RGBA pixels with alpha at or below this are ignored. */
  alphaThreshold?: number;
}

/**
 * Colour clusters by k-means with a seeded k-means++ start (8 clusters),
 * merged under RGB distance 28, sorted by share.
 */
export function colorClusters(frame: Frame, options: ClusterOptions = {}): Cluster[] {
  if (frame.format !== 'rgba') throw new Error('colour clustering needs an rgba frame');
  const k = options.k ?? 8;
  const random = prng(options.seed ?? 1);
  const pixels = frame.width * frame.height;
  const stride = Math.max(1, Math.floor(pixels / (options.maxSamples ?? 20_000)));
  const points: number[][] = [];
  for (let p = 0; p < pixels; p += stride) {
    if ((frame.data[p * 4 + 3] ?? 255) <= (options.alphaThreshold ?? 8)) continue;
    points.push([frame.data[p * 4] ?? 0, frame.data[p * 4 + 1] ?? 0, frame.data[p * 4 + 2] ?? 0]);
  }
  if (points.length === 0) return [];
  const centres: number[][] = [points[Math.floor(random() * points.length)] ?? [0, 0, 0]];
  while (centres.length < Math.min(k, points.length)) {
    const weights = points.map((point) => Math.min(...centres.map((centre) => distance(point, centre))) ** 2);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total === 0) break;
    let pick = random() * total;
    let index = 0;
    for (; index < weights.length - 1; index += 1) {
      pick -= weights[index] ?? 0;
      if (pick <= 0) break;
    }
    centres.push([...(points[index] ?? [0, 0, 0])]);
  }
  const assignment = new Array<number>(points.length).fill(0);
  for (let iteration = 0; iteration < (options.iterations ?? 20); iteration += 1) {
    let moved = false;
    points.forEach((point, i) => {
      let best = 0;
      let bestDistance = Infinity;
      centres.forEach((centre, c) => {
        const d = distance(point, centre);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      });
      if (assignment[i] !== best) moved = true;
      assignment[i] = best;
    });
    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((point, i) => {
      const sum = sums[assignment[i] ?? 0];
      if (!sum) return;
      sum[0] = (sum[0] ?? 0) + (point[0] ?? 0);
      sum[1] = (sum[1] ?? 0) + (point[1] ?? 0);
      sum[2] = (sum[2] ?? 0) + (point[2] ?? 0);
      sum[3] = (sum[3] ?? 0) + 1;
    });
    sums.forEach((sum, c) => {
      const n = sum[3] ?? 0;
      if (n > 0) centres[c] = [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n];
    });
    if (!moved && iteration > 0) break;
  }
  let clusters = centres
    .map((centre, c) => ({ rgb: centre, count: assignment.filter((a) => a === c).length }))
    .filter((cluster) => cluster.count > 0);
  // Merge clusters closer than the merge distance, largest first.
  const mergeDistance = options.mergeDistance ?? 28;
  clusters.sort((a, b) => b.count - a.count);
  const merged: Array<{ rgb: number[]; count: number }> = [];
  for (const cluster of clusters) {
    const near = merged.find((existing) => distance(existing.rgb, cluster.rgb) < mergeDistance);
    if (near) {
      const total = near.count + cluster.count;
      near.rgb = near.rgb.map((value, i) => (value * near.count + (cluster.rgb[i] ?? 0) * cluster.count) / total);
      near.count = total;
    } else {
      merged.push({ rgb: [...cluster.rgb], count: cluster.count });
    }
  }
  clusters = merged.sort((a, b) => b.count - a.count);
  return clusters.map((cluster) => {
    const rgb = cluster.rgb.map((value) => Math.round(value)) as [number, number, number];
    return { rgb, hex: toHex(rgb), share: cluster.count / points.length };
  });
}

/** Mask (1 = content) grown by `band` pixels in every direction (a square window, as two sliding-window passes). */
export function growMask(mask: Uint8Array, width: number, height: number, band: number): Uint8Array {
  const pass = (source: Uint8Array, along: 'x' | 'y') => {
    const out = new Uint8Array(source.length);
    const lines = along === 'x' ? height : width;
    const length = along === 'x' ? width : height;
    const at = (line: number, i: number) => (along === 'x' ? line * width + i : i * width + line);
    for (let line = 0; line < lines; line += 1) {
      let count = 0;
      for (let i = 0; i < Math.min(band, length); i += 1) count += source[at(line, i)] ?? 0;
      for (let i = 0; i < length; i += 1) {
        if (i + band < length) count += source[at(line, i + band)] ?? 0;
        if (i - band - 1 >= 0) count -= source[at(line, i - band - 1)] ?? 0;
        out[at(line, i)] = count > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, 'x'), 'y');
}

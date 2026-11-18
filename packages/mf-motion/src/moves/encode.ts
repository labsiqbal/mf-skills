// Delivery formats from the RGBA master (render-and-encode.md, Encodes and
// Filenames): mp4 (over the brand ground; "-preview" for alpha moves), ProRes
// 4444 mov with alpha, VP9 webm with alpha, key-colour mp4 and the kept PNG
// master. Key purity is measured on the encoded key file.
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import type { MoveMode } from '../kit/build/move';
import { NUMBERS } from '../kit/numbers';
import { parseHex } from '../kit/oklch';
import { growMask } from '../media/pixels';
import { run, runStream } from '../proc/run';
import { parseFps } from '../time/grammar';
import { type Master, masterFrame } from './render';

export { growMask };

export const FORMATS = ['mp4', 'mov', 'webm', 'key-mp4', 'png'] as const;
export type Format = (typeof FORMATS)[number];

export const ENCODE_TIMEOUT_MS = 30 * 60 * 1000;

/** The x264 settings every mp4 shares (render-and-encode.md#encodes). */
const MP4 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart'];
/**
 * RGB to YUV with the BT.709 matrix in limited range, tagged as such: players
 * and FFmpeg's own decoder then read the colours back within a level or two
 * (untagged BT.601 drifted the key ground by 3 levels).
 */
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
/**
 * The key file turns adaptive quantization off: it raises the quantizer in flat
 * areas, which is exactly the key ground, and left a 3-level ghost where a card
 * had faded out (measured on the fixture's last frame).
 */
const KEY_X264 = ['-x264-params', 'aq-mode=0'];
/**
 * The accurate, bit-exact swscale path: FFmpeg builds differ in their fast
 * RGB/YUV converters (macOS arm64 with FFmpeg 9 moved every key pixel), and
 * the generic path is the same everywhere.
 */
export const SWS_FLAGS = 'accurate_rnd+bitexact+full_chroma_int';
const toYuv = (pixFmt: string) => `scale=out_color_matrix=bt709:out_range=tv:flags=${SWS_FLAGS},format=${pixFmt}`;
const MOV = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0'];
const WEBM = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-auto-alt-ref', '0'];

/** Standalone file base: <move-id>_<WxH>_<mode>. */
export function standaloneBase(moveId: string, size: { width: number; height: number }, mode: MoveMode): string {
  return `${moveId}_${size.width}x${size.height}_${mode}`;
}

/** Placement file base: <MM>m<SS>s<FF>f_<move-id>[_<mode>], the start on the footage clock at the footage frame rate. */
export function placementBase(startSec: number, footageFps: string, moveId: string, mode?: MoveMode): string {
  const rate = parseFps(footageFps);
  const perSec = rate.num / rate.den;
  const frame = Math.floor(startSec * perSec + 1e-9);
  const wholeSec = Math.floor(frame / perSec + 1e-9);
  const ff = frame - Math.round(wholeSec * perSec);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(wholeSec / 60))}m${two(wholeSec % 60)}s${two(Math.max(0, ff))}f_${moveId}${mode ? `_${mode}` : ''}`;
}

/** Output file of a format beside the base (png is the master folder itself). */
export function outputName(format: Exclude<Format, 'png'>, base: string, mode: MoveMode): string {
  switch (format) {
    case 'mp4':
      return mode === 'alpha' ? `${base}-preview.mp4` : `${base}.mp4`;
    case 'key-mp4':
      return `${base}-key.mp4`;
    case 'mov':
      return `${base}.mov`;
    case 'webm':
      return `${base}.webm`;
  }
}

export interface EncodeOptions {
  /** Folder the files are written to. */
  out: string;
  base: string;
  mode: MoveMode;
  /** Brand ground: what the mp4 shows behind an alpha move. */
  ground: string;
  /** Key colour of the key-mp4. */
  keyColor: string | null;
  durationSec: number;
  ffmpeg?: string;
  onProgress?: (message: string) => void;
}

export interface Output {
  format: Format;
  path: string;
  bytes: number;
  /** key-mp4: the key colour (also in the deliverable notes). */
  keyColor?: string;
  /** key-mp4: purity of the background measured on the encoded file. */
  keyPurity?: KeyPurity;
}

export interface KeyPurity {
  keyColor: string;
  /** Background pixels further than key.purityLevels from the key colour, summed over the first, middle and last frame. */
  impurePixels: number;
  /** Background pixels checked (master background further than KEY_EDGE_BAND_PX from content). */
  checkedPixels: number;
  /** Frame indices (0-based) checked. */
  frames: number[];
  levels: number;
  edgeBandPx: number;
  pass: boolean;
}

/**
 * Background pixels within one H.264 macroblock (16 px) of content are not
 * judged: 4:2:0 chroma shares colour across 2x2 blocks and the encoder's
 * transform rings inside the macroblocks that hold an edge (measured on the
 * fixture card: most moved pixels within 4 px, the farthest 12 px).
 */
export const KEY_EDGE_BAND_PX = 16;

const ffColor = (hex: string) => `0x${hex.replace('#', '').toUpperCase()}`;

/** FFmpeg arguments of one format from the master. */
export function encodeArgs(format: Exclude<Format, 'png'>, master: Master, file: string, options: Pick<EncodeOptions, 'ground' | 'keyColor'>): string[] {
  const input = ['-framerate', master.fps, '-start_number', '1', '-i', master.pattern];
  const over = (hex: string) => [
    // The ground is generated as RGBA inside the lavfi graph; a YUV source would move its colour before the composite.
    '-f', 'lavfi', '-i', `color=c=${ffColor(hex)}:s=${master.width}x${master.height}:r=${master.fps},format=rgba`,
    // The composite runs in RGB so the one RGB to YUV conversion is the tagged BT.709 one.
    '-filter_complex', `[1:v][0:v]overlay=shortest=1:format=rgb,${toYuv('yuv420p')}[v]`, '-map', '[v]',
  ];
  const tail = ['-r', master.fps, '-frames:v', String(master.frames), '-an', file];
  switch (format) {
    case 'mp4':
      return ['-v', 'error', '-y', ...input, ...over(options.ground), ...MP4, ...BT709, ...tail];
    case 'key-mp4': {
      if (!options.keyColor) throw new MfmError('INTERNAL', { format }, { message: 'key-mp4 needs a key colour.' });
      return ['-v', 'error', '-y', ...input, ...over(options.keyColor), ...MP4, ...KEY_X264, ...BT709, ...tail];
    }
    case 'mov':
      return ['-v', 'error', '-y', ...input, '-vf', toYuv('yuva444p10le'), ...MOV, ...BT709, ...tail];
    case 'webm':
      return ['-v', 'error', '-y', ...input, '-vf', toYuv('yuva420p'), ...WEBM, ...BT709, ...tail];
  }
}

/**
 * The master over the key colour, losslessly in RGB (libx264rgb, CRF 0): what
 * the gate measures in key mode, so key purity judges the rendering (soft
 * edges) rather than the delivery codec, whose tolerance the -key.mp4 check
 * covers.
 */
export async function encodeKeyLossless(master: Master, file: string, keyColor: string, ffmpeg = 'ffmpeg'): Promise<Output> {
  const args = [
    '-v', 'error', '-y', '-framerate', master.fps, '-start_number', '1', '-i', master.pattern,
    '-f', 'lavfi', '-i', `color=c=${ffColor(keyColor)}:s=${master.width}x${master.height}:r=${master.fps},format=rgba`,
    '-filter_complex', `[1:v][0:v]overlay=shortest=1:format=rgb,scale=flags=${SWS_FLAGS},format=rgb24[v]`, '-map', '[v]',
    '-c:v', 'libx264rgb', '-crf', '0', '-preset', 'veryfast', '-pix_fmt', 'rgb24',
    '-r', master.fps, '-frames:v', String(master.frames), '-an', file,
  ];
  const result = await run(ffmpeg, args, { timeoutMs: ENCODE_TIMEOUT_MS });
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg', spawnError: result.spawnError.code });
  if (result.timedOut) throw new MfmError('TIMEOUT', { tool: 'ffmpeg', format: 'key-lossless', timeoutMs: ENCODE_TIMEOUT_MS });
  if (result.code !== 0) throw new MfmError('ENCODE_FAILED', { format: 'key-lossless', file, code: result.code, stderrTail: result.stderr.slice(-2000) }, { message: `FFmpeg could not encode the lossless key render (${path.basename(file)}).` });
  return { format: 'key-mp4', path: file, bytes: statSync(file).size, keyColor };
}

/** One decoded RGBA frame, by index when given (exact: select by frame number, not by time). */
async function rgbaFrame(file: string, index: number | null, ffmpeg: string): Promise<Uint8Array> {
  const toRgba = `scale=flags=${SWS_FLAGS},format=rgba`;
  const filter = index === null ? toRgba : `select=eq(n\\,${index}),${toRgba}`;
  const stream = runStream(ffmpeg, ['-v', 'error', '-i', file, '-vf', filter, '-frames:v', '1', '-f', 'rawvideo', '-'], { timeoutMs: ENCODE_TIMEOUT_MS });
  const parts: Buffer[] = [];
  for await (const chunk of stream.chunks) parts.push(chunk);
  const result = await stream.result;
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg', spawnError: result.spawnError.code });
  if (result.timedOut || result.code !== 0) throw new MfmError('ENCODE_FAILED', { file, index, stderrTail: result.stderr.slice(-2000) }, { message: `FFmpeg could not decode frame ${index ?? 0} of ${path.basename(file)}.` });
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * Key purity of an encoded key file on its first, middle and last frame: every
 * background pixel of the master (transparent, or exactly the key colour) that
 * is further than KEY_EDGE_BAND_PX from content must decode within
 * key.purityLevels of the key colour.
 */
export async function measureKeyPurity(file: string, master: Master, keyColor: string, ffmpeg = 'ffmpeg'): Promise<KeyPurity> {
  const key = parseHex(keyColor);
  const levels = NUMBERS['key.purityLevels'];
  const frames = [...new Set([0, Math.floor((master.frames - 1) / 2), master.frames - 1])];
  const pixels = master.width * master.height;
  let impure = 0;
  let checked = 0;
  for (const index of frames) {
    const source = await rgbaFrame(path.join(master.dir, masterFrame(index + 1)), null, ffmpeg);
    const encoded = await rgbaFrame(file, index, ffmpeg);
    if (source.length < pixels * 4 || encoded.length < pixels * 4) throw new MfmError('ENCODE_FAILED', { file, index }, { message: `Frame ${index} of ${path.basename(file)} is not ${master.width}x${master.height}.` });
    const content = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p += 1) {
      const transparent = source[p * 4 + 3] === 0;
      const atKey = source[p * 4 + 3] === 255 && source[p * 4] === key[0] && source[p * 4 + 1] === key[1] && source[p * 4 + 2] === key[2];
      content[p] = transparent || atKey ? 0 : 1;
    }
    const near = growMask(content, master.width, master.height, KEY_EDGE_BAND_PX);
    for (let p = 0; p < pixels; p += 1) {
      if (near[p]) continue;
      checked += 1;
      const d = Math.max(Math.abs((encoded[p * 4] ?? 0) - key[0]), Math.abs((encoded[p * 4 + 1] ?? 0) - key[1]), Math.abs((encoded[p * 4 + 2] ?? 0) - key[2]));
      if (d > levels) impure += 1;
    }
  }
  return { keyColor, impurePixels: impure, checkedPixels: checked, frames, levels, edgeBandPx: KEY_EDGE_BAND_PX, pass: impure === 0 && checked > 0 };
}

const folderBytes = (dir: string) => readdirSync(dir).reduce((sum, name) => sum + statSync(path.join(dir, name)).size, 0);

/** Encode the requested formats; the master is removed afterwards unless png is requested or keepMaster is set. */
export async function encode(master: Master, formats: readonly Format[], options: EncodeOptions & { keepMaster?: boolean }): Promise<Output[]> {
  const outputs: Output[] = [];
  for (const format of formats) {
    if (format === 'png') continue;
    const file = path.join(options.out, outputName(format, options.base, options.mode));
    options.onProgress?.(`Encoding ${path.basename(file)}`);
    const result = await run(options.ffmpeg ?? 'ffmpeg', encodeArgs(format, master, file, options), { timeoutMs: ENCODE_TIMEOUT_MS });
    if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg', spawnError: result.spawnError.code });
    if (result.timedOut) throw new MfmError('TIMEOUT', { tool: 'ffmpeg', format, timeoutMs: ENCODE_TIMEOUT_MS });
    if (result.code !== 0) {
      throw new MfmError('ENCODE_FAILED', { format, file, code: result.code, stderrTail: result.stderr.slice(-2000) }, { message: `FFmpeg could not encode ${format} (${path.basename(file)}).` });
    }
    const output: Output = { format, path: file, bytes: statSync(file).size };
    if (format === 'key-mp4' && options.keyColor) {
      output.keyColor = options.keyColor;
      output.keyPurity = await measureKeyPurity(file, master, options.keyColor, options.ffmpeg);
    }
    outputs.push(output);
  }
  if (formats.includes('png')) outputs.push({ format: 'png', path: master.dir, bytes: folderBytes(master.dir) });
  else if (!options.keepMaster) rmSync(master.dir, { recursive: true, force: true });
  return outputs;
}

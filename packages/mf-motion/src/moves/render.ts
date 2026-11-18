// The RGBA master of a move (render-and-encode.md, Master): one engine render
// as a PNG sequence into <work>/master/frame-%05d.png, its frame count checked
// against round(durationSec x fps), and the disk estimate taken before it.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MfmError, isMfmError } from '../cli/errors';
import { freeGb } from '../doctor/index';
import { type Engine, enginePins, render } from '../engine/index';
import { brandPalette } from '../kit/build/move';
import { keyColor as pickKeyColor } from '../kit/keyColor';
import { NUMBERS, aspectSize } from '../kit/numbers';
import { findMove } from '../library/registry';
import { lint, type Finding } from '../lint/index';
import { audit, writeAudit } from '../quality/audit';
import { gate } from '../quality/gate';
import { measure } from '../quality/metrics';
import { buildPacket } from '../quality/packet';
import type { Profile } from '../quality/profiles';
import { makeSheets } from '../quality/sheets';
import { writeDoc } from '../schemas/index';
import { parseFps } from '../time/grammar';
import { type MoveRenderRequest, brandFor, buildMove } from './build';
import { type Format, type Output, encode, standaloneBase } from './encode';

export const MASTER_PATTERN = 'frame-%05d.png';

/** The master's frame file name for a 1-based frame number. */
export const masterFrame = (n: number) => `frame-${String(n).padStart(5, '0')}.png`;

/** Frames a render of `durationSec` at `fps` must hold. */
export function expectedFrames(durationSec: number, fps: string): number {
  const rate = parseFps(fps);
  return Math.round((durationSec * rate.num) / rate.den);
}

export interface MasterOptions {
  fps: string;
  durationSec: number;
  /** The work folder; the master goes to <work>/master/. */
  work: string;
  engine: Engine;
  onProgress?: (message: string) => void;
}

export interface Master {
  dir: string;
  pattern: string;
  frames: number;
  fps: string;
  width: number;
  height: number;
}

/** PNG files of a folder in frame order (numeric parts compared as numbers). */
function framesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Render the RGBA master of a build and check its frame count. */
export async function renderMaster(build: string, options: MasterOptions & { width: number; height: number }): Promise<Master> {
  const dir = path.join(options.work, 'master');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  options.onProgress?.(`Rendering the master (${options.durationSec} s at ${options.fps} fps)`);
  await render(options.engine, build, { format: 'png-sequence', fps: options.fps, output: dir });
  const files = framesIn(dir);
  const expected = expectedFrames(options.durationSec, options.fps);
  if (files.length !== expected) {
    throw new MfmError('RENDER_FAILED', { expected, got: files.length, master: dir }, { message: `The master has ${files.length} frames; ${options.durationSec} s at ${options.fps} fps needs ${expected}.` });
  }
  // The engine's own names become frame-00001.png ... in order (two passes, so no name is overwritten).
  files.forEach((name, i) => renameSync(path.join(dir, name), path.join(dir, `.mfm-${i}.png`)));
  files.forEach((_, i) => renameSync(path.join(dir, `.mfm-${i}.png`), path.join(dir, masterFrame(i + 1))));
  if (!existsSync(path.join(dir, masterFrame(1)))) throw new MfmError('RENDER_FAILED', { master: dir }, { message: 'The master has no first frame.' });
  return { dir, pattern: path.join(dir, MASTER_PATTERN), frames: files.length, fps: options.fps, width: options.width, height: options.height };
}

/**
 * Bytes per second at 1920x1080 and 30 fps, per output (cost-and-budgets.md:
 * ProRes 4444 about 40 MB/s; WebM overlays about 150 MB for 40 s). The PNG
 * master is budgeted as a full-frame RGBA sequence.
 */
export const RATE_BYTES_PER_SEC: Record<string, number> = {
  master: 60e6,
  mov: 40e6,
  webm: 3.75e6,
  mp4: 2.5e6,
  'key-mp4': 2.5e6,
  png: 0,
};

/** Estimated bytes of a render: the master plus every requested format (seconds x per-format rate, scaled by pixels and frame rate). */
export function estimateBytes(formats: readonly string[], frame: { width: number; height: number; fps: string; durationSec: number }): number {
  const rate = parseFps(frame.fps);
  const scale = ((frame.width * frame.height) / (1920 * 1080)) * (rate.num / rate.den / 30);
  const perSec = [...new Set(['master', ...formats])].reduce((sum, format) => sum + (RATE_BYTES_PER_SEC[format] ?? 0), 0);
  return Math.ceil(perSec * scale * frame.durationSec);
}

/** Refuse with DISK_LOW when the estimate would leave less than disk.doctorFailGb free. */
export function checkDisk(target: string, bytes: number, free: (at: string) => number = freeGb): void {
  const freeNow = free(target);
  const after = freeNow - bytes / 1024 ** 3;
  const floor = NUMBERS['disk.doctorFailGb'];
  if (after < floor) {
    throw new MfmError('DISK_LOW', { path: target, freeGb: Math.round(freeNow * 100) / 100, estimateGb: Math.round((bytes / 1024 ** 3) * 100) / 100, minimumGb: floor }, {
      message: `The render needs about ${(bytes / 1024 ** 3).toFixed(2)} GB and would leave ${after.toFixed(2)} GB free, under ${floor} GB.`,
    });
  }
}

/** Formats a move render writes when none are asked for: what an editor needs for the mode. */
export const DEFAULT_FORMATS: Record<MoveRenderRequest['mode'], Format[]> = {
  full: ['mp4'],
  alpha: ['mov', 'webm', 'mp4'],
  key: ['key-mp4'],
};

/** The delivered file the gate measures: the one that keeps what the mode is about. */
const MEASURED: Record<MoveRenderRequest['mode'], Exclude<Format, 'png'>> = { full: 'mp4', alpha: 'mov', key: 'key-mp4' };

export interface RenderMoveRequest extends MoveRenderRequest {
  engine: Engine;
  formats?: Format[];
  keepMaster?: boolean;
  /** Lint, audit, measure, sheets, packet and the gate at the runtime target (8). */
  gate?: boolean;
  /** The agent cannot view images: gate without scores (PASS-MEASURED at best). */
  noVision?: boolean;
  browserPath?: string;
  cli: string;
  onProgress?: (message: string) => void;
  /** Test seam: free gigabytes at a path. */
  free?: (at: string) => number;
}

export interface GateReport {
  round: string;
  packet: { dir: string; hash: string; instruction: string };
  level: string | null;
  summary: string | null;
}

export interface RenderMoveResult {
  /** The kept master folder, or null when it was removed after encoding. */
  master: string | null;
  outputs: Output[];
  keyColor: string | null;
  verdict: string | null;
  build: string;
  lintWarnings: Finding[];
  gate: GateReport | null;
}

/** move render: build and lint (MFM-041), the disk check, the RGBA master, the encodes and, with `gate`, the round and its verdict. */
export async function renderMove(request: RenderMoveRequest): Promise<RenderMoveResult> {
  const built = await buildMove(request);
  const meta = findMove(request.id).meta;
  const size = aspectSize(request.aspect);
  const fps = request.fps ?? '30';
  const formats = [...new Set(request.formats && request.formats.length > 0 ? request.formats : DEFAULT_FORMATS[request.mode])];
  const out = path.resolve(request.out);
  checkDisk(out, estimateBytes(formats, { ...size, fps, durationSec: built.durationSec }), request.free);

  const master = await renderMaster(built.build, { fps, durationSec: built.durationSec, work: out, engine: request.engine, ...size, ...(request.onProgress ? { onProgress: request.onProgress } : {}) });
  const brand = brandFor(request.home, request.brand);
  const ground = brand.doc.colors.ground as string;
  const needsKey = formats.includes('key-mp4') || (request.gate === true && MEASURED[request.mode] === 'key-mp4');
  const keyColor = built.keyColor ?? (needsKey ? pickKeyColor(brandPalette(brand.doc as never)).hex : null);
  const base = standaloneBase(meta.id, size, request.mode);
  const common = { mode: request.mode, ground, keyColor, durationSec: built.durationSec, ...(request.onProgress ? { onProgress: request.onProgress } : {}) };

  let report: GateReport | null = null;
  if (request.gate) {
    const round = path.join(out, 'round');
    mkdirSync(round, { recursive: true });
    const profile = built.profile as Profile;
    lint(built.build, { profile: built.profile as never, round });
    const browser = request.browserPath ? { browserPath: request.browserPath } : {};
    writeAudit(path.join(round, 'audit.json'), await audit(built.build, { profile, aspect: request.aspect, avoidFace: meta.avoidFace, engine: request.engine, ...browser }));
    const [measured] = await encode(master, [MEASURED[request.mode]], { ...common, out: round, base: 'render', keepMaster: true });
    if (!measured) throw new MfmError('INTERNAL', { round }, { message: 'The gate render was not encoded.' });
    request.onProgress?.('Measuring the render');
    const metrics = await measure(measured.path, {
      profile,
      expectedSec: built.durationSec,
      holds: meta.holds.map((hold) => ({ fromSec: hold.from * built.durationSec, toSec: hold.to * built.durationSec })),
      ...(request.mode === 'key' && keyColor ? { keyColor } : {}),
      avoidFace: meta.avoidFace,
      auditFile: path.join(round, 'audit.json'),
    });
    writeDoc('metrics', path.join(round, 'metrics.json'), metrics as never);
    await makeSheets(measured.path, { out: round, dense: 0.25, phone: true, plates: request.mode === 'alpha', engine: request.engine, ...browser });
    const packet = await buildPacket({ roundDir: round, unit: { type: 'move', id: meta.id, version: meta.version }, oneLiner: meta.oneLiner, say: meta.say, brandDir: brand.dir, target: 8, engine: request.engine, ...browser });
    report = { round, packet: { dir: packet.dir, hash: packet.hash, instruction: packet.instruction }, level: null, summary: null };
    try {
      const outcome = gate({ roundDir: round, round: 1, target: 8, noVision: request.noVision === true, engine: enginePins().hyperframes, cli: request.cli });
      report.level = outcome.verdict.level;
      report.summary = outcome.summary;
    } catch (error) {
      // No scores yet: the verdict waits for the judge (step 2 of the quality reference).
      if (!(isMfmError(error) && error.code === 'SCORES_INVALID' && !existsSync(path.join(round, 'scores.json')))) throw error;
    }
  }

  const outputs = await encode(master, formats, { ...common, out, base, keepMaster: request.keepMaster === true });
  const kept = formats.includes('png') || request.keepMaster === true;
  return { master: kept ? master.dir : null, outputs, keyColor, verdict: report?.level ?? null, build: built.build, lintWarnings: built.lint.warnings, gate: report };
}

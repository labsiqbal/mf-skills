// Sheets for one render: the engine's beats, seams and film phone sheet (from
// the build folder), and mf-motion's own dense, move phone, plates and
// finding-crop sheets drawn from the rendered file by the sheet renderer.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import type { Engine } from '../engine/index';
import { framePng } from '../media/pixels';
import { probe } from '../media/probe';
import { type SheetItem, type SheetResult, renderSheet } from '../media/sheet';
import { reviewSheets, readCheck } from './check';
import { PLATES } from './metrics';

/** Most finding crops a round carries. */
export const MAX_FINDING_CROPS = 6;
/** Dense sheet steps: films and moves (verification.md#sheets-mfm-037). */
export const DENSE_STEP = { film: 0.5, move: 0.25 } as const;
/** Width of a phone sheet frame, in px. */
export const PHONE_WIDTH = 360;
/** Overlay frames on the plates sheet, as fractions of the duration. */
export const PLATE_FRACTIONS = [0.25, 0.5, 0.75] as const;

export interface SheetsOptions {
  /** Folder the sheets are written to. */
  out: string;
  /** Dense step in seconds (default 0.5, films; 0.25 for moves). */
  dense?: number;
  /** Move phone sheet: frames at 0.3 s, the middle and 0.5 s before the end, 360 px wide. */
  phone?: boolean;
  /** Plates sheet (overlay-alpha). */
  plates?: boolean;
  /** Build folder: adds the engine's beats, seams and (without `phone`) phone sheets. */
  build?: string | null;
  /** check.json whose finding crops become finding-NN sheets (default `<build>/check.json` when it exists). */
  check?: string | null;
  engine?: Engine;
  browserPath?: string;
}

export interface SheetFile {
  role: string;
  path: string;
  /** Cell labels of sheets mf-motion draws (timestamps, plates, finding codes). */
  labels?: string[];
}

const fmt = (sec: number) => `${(Math.round(sec * 100) / 100).toFixed(2)} s`;
const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Times on the dense grid: 0, step, 2 step, ... while a frame exists (before the last frame's end). */
export function denseTimes(durationSec: number, step: number, fps: number): number[] {
  if (!(step > 0)) throw new MfmError('USAGE', { flag: '--dense', value: step }, { message: '--dense takes a step in seconds greater than 0.' });
  const lastFrame = durationSec - 1 / fps;
  const times: number[] = [];
  for (let i = 0; i * step <= lastFrame + 1e-9; i += 1) times.push(Math.round(i * step * 1e6) / 1e6);
  return times;
}

/** Move phone key frames: 0.3 s, the middle and 0.5 s before the end (clamped inside the file). */
export function phoneTimes(durationSec: number, fps: number): number[] {
  const last = Math.max(0, durationSec - 1 / fps);
  return [0.3, durationSec / 2, durationSec - 0.5].map((t) => Math.round(Math.min(last, Math.max(0, t)) * 1e6) / 1e6);
}

export async function makeSheets(video: string, options: SheetsOptions): Promise<{ sheets: SheetFile[] }> {
  const info = await probe(video);
  if (!info.video) throw new MfmError('TOOL_FAILED', { file: video }, { message: `${video} has no video stream.` });
  const { width, height } = info.video;
  const fps = info.video.fps.value > 0 ? info.video.fps.value : 30;
  const aspect = width / height;
  const draw = { ...(options.engine ? { engine: options.engine } : {}), ...(options.browserPath ? { browserPath: options.browserPath } : {}) };
  mkdirSync(options.out, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'mfm-sheets-'));
  const sheets: SheetFile[] = [];
  const add = (role: string, files: string[]) => {
    for (const file of files) sheets.push({ role, path: file });
  };
  const addDrawn = (role: string, result: SheetResult) => {
    for (const file of result.files) sheets.push({ role, path: file, labels: result.cells.filter((cell) => cell.sheet === file).map((cell) => cell.label ?? '') });
  };
  try {
    // Engine sheets from the build folder.
    if (options.build) {
      const review = await reviewSheets(options.build, { outDir: path.join(work, 'review'), ...(options.engine ? { engine: options.engine } : {}) });
      const copy = (from: string, name: string) => {
        const to = path.join(options.out, name);
        copyFileSync(from, to);
        return to;
      };
      add('beats', review.beats.map((file, i) => copy(file, i === 0 ? 'beats.jpg' : `beats-${i + 1}.jpg`)));
      review.seams.forEach((file, i) => {
        const nn = String(i + 1).padStart(2, '0');
        add(`seams-${nn}`, [copy(file, `seams-${nn}.jpg`)]);
      });
      if (!options.phone) add('phone', review.phone.map((file, i) => copy(file, i === 0 ? 'phone.jpg' : `phone-${i + 1}.jpg`)));
    }

    const frameAt = async (sec: number, name: string, frameWidth?: number) =>
      framePng(video, sec, path.join(work, `${name}.png`), frameWidth ? { width: frameWidth } : {});

    // Dense: one timestamped frame every step.
    const step = options.dense ?? DENSE_STEP.film;
    const times = denseTimes(info.durationSec, step, fps);
    const dense: SheetItem[] = [];
    for (const [i, t] of times.entries()) dense.push({ image: await frameAt(t, `dense-${i}`, 640), label: fmt(t) });
    addDrawn('dense', await renderSheet('dense', dense, path.join(options.out, 'dense.png'), { aspect, title: `dense, every ${step} s`, ...draw }));

    // Move phone: three key frames at 360 px wide.
    if (options.phone) {
      const items: SheetItem[] = [];
      for (const [i, t] of phoneTimes(info.durationSec, fps).entries()) items.push({ image: await frameAt(t, `phone-${i}`, PHONE_WIDTH), label: fmt(t) });
      addDrawn('phone', await renderSheet('phone', items, path.join(options.out, 'phone.png'), { aspect, cellWidth: PHONE_WIDTH, columns: items.length, ...draw }));
    }

    // Plates: the overlay at 25%, 50% and 75% over each fixed plate.
    if (options.plates) {
      const items: SheetItem[] = [];
      for (const fraction of PLATE_FRACTIONS) {
        const t = Math.round(info.durationSec * fraction * 1e6) / 1e6;
        const image = await frameAt(t, `plate-${fraction}`, 800);
        for (const [name, rgb] of Object.entries(PLATES)) items.push({ image, plate: { color: hex(rgb) }, label: `${Math.round(fraction * 100)}% at ${fmt(t)}`, sublabel: name });
      }
      addDrawn('plates', await renderSheet('plates', items, path.join(options.out, 'plates.png'), { aspect, columns: Object.keys(PLATES).length, ...draw }));
    }

    // Finding crops from the engine check, most severe first.
    const checkFile = options.check ?? (options.build ? path.join(options.build, 'check.json') : null);
    if (checkFile && (options.check || existsSync(checkFile))) {
      const crops = readCheck(checkFile).findingCrops.slice(0, MAX_FINDING_CROPS);
      for (const [i, crop] of crops.entries()) {
        const nn = String(i + 1).padStart(2, '0');
        const item: SheetItem = { image: crop.path, label: crop.code, sublabel: `${crop.severity}${crop.atSec === null ? '' : ` at ${fmt(crop.atSec)}`}` };
        // The cell takes the crop's own shape, so the crop fills it.
        const shape = await probe(crop.path);
        const cropAspect = shape.video ? shape.video.width / shape.video.height : 16 / 9;
        addDrawn(`finding-${nn}`, await renderSheet('board', [item], path.join(options.out, `finding-${nn}.png`), { columns: 1, aspect: cropAspect, ...draw }));
      }
    }
    return { sheets };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}


// measure: metrics.json from a rendered file. Duration, timestamp regularity,
// frame-0 ink, overlay coverage, still stretches, contrast and key purity,
// with the hard results and caps of the file's profile, so the gate measures
// nothing itself. Films with audio also get loudness, true peak, low-end share
// and SFX timing and rise (MFM-071).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { type Frame, alphaCoverage, changedFraction, frameAt, frames, growMask, inkFraction, relativeLuminance } from '../media/pixels';
import { probe } from '../media/probe';
import { audioMetrics } from './audioMetrics';
import { type CheckId, type Profile, applies, modeOf } from './profiles';
import { type CapMetrics, RUBRIC, capFor } from './rubric';

export interface Hold {
  fromSec: number;
  toSec: number;
}

export interface MeasureOptions {
  profile: Profile;
  /** Planned length; default the file's own. */
  expectedSec?: number;
  /** Overlays: declared hold windows (still exemption up to still.overlayHoldMaxSec). */
  holds?: Hold[];
  /** Films: where the end card starts (still exemption up to still.endCardMaxSec). */
  endCardFromSec?: number | null;
  /** Key mode: the key colour; default the most common colour of frame 0. */
  keyColor?: string;
  /** Brief and overlay switches for the profile's conditional checks. */
  captions?: boolean;
  avoidFace?: boolean;
  /** audit.json and check.json beside the video are merged when present. */
  auditFile?: string | null;
  checkFile?: string | null;
  /** sound/sound.json, for the SFX cues (audio metrics need the file's audio stream). */
  soundFile?: string | null;
}

type Aspect = '16:9' | '9:16' | '1:1';
type Mode = 'full' | 'alpha' | 'key';

export interface StillStretch {
  fromSec: number;
  toSec: number;
  lenSec: number;
  exempt: 'end-card' | 'hold' | null;
}

export interface AuditLine {
  elementId: string;
  inSec: number;
  outSec: number;
  holdSec: number;
  words: number;
  ok: boolean;
  /** Optional ink box (px) and ink colour from the runtime report, for contrast. */
  box?: { x: number; y: number; width: number; height: number };
  color?: string;
}

const round = (value: number, places = 3) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

function aspectOf(width: number, height: number): Aspect {
  const ratio = width / height;
  const options: Array<[Aspect, number]> = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1]];
  return options.sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0]?.[0] ?? '16:9';
}

const modeFor = (profile: Profile): Mode => (profile === 'overlay-alpha' ? 'alpha' : profile === 'overlay-key' ? 'key' : 'full');

function parseHex(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new MfmError('USAGE', { color: hex }, { message: `${hex} is not a #RRGGBB colour.` });
  return [Number.parseInt(m[1] ?? '0', 16), Number.parseInt(m[2] ?? '0', 16), Number.parseInt(m[3] ?? '0', 16)];
}

const toHex = (rgb: readonly number[]) => `#${rgb.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Runs of still frames (at still.sampleFps, still.downscalePx greyscale) as stretches. */
export async function stillStretches(file: string, durationSec: number): Promise<Array<{ fromSec: number; toSec: number; lenSec: number }>> {
  const fps = NUMBERS['still.sampleFps'];
  const out: Array<{ fromSec: number; toSec: number; lenSec: number }> = [];
  let previous: Frame | null = null;
  let index = 0;
  let runStart: number | null = null;
  // A run of samples equal to their predecessor: the picture froze at the sample before the
  // run and stayed frozen until the first changed sample (`changedAt`).
  const close = (changedAt: number) => {
    if (runStart === null) return;
    const fromSec = (runStart - 1) / fps;
    const toSec = Math.min(durationSec, changedAt / fps);
    out.push({ fromSec: round(fromSec), toSec: round(toSec), lenSec: round(toSec - fromSec) });
    runStart = null;
  };
  for await (const frame of frames(file, { fps, width: NUMBERS['still.downscalePx'], format: 'gray' })) {
    if (previous) {
      const still = changedFraction(previous, frame, NUMBERS['still.pixelDelta']) < NUMBERS['still.frameThreshold'];
      if (still && runStart === null) runStart = index;
      if (!still) close(index);
    }
    previous = frame;
    index += 1;
  }
  close(index);
  return out;
}

/**
 * Anti-aliasing ring around content that the key check leaves out: Chrome
 * draws every rounded corner and glyph edge with one blended pixel, which a
 * keyer handles. A soft edge (blur, a soft shadow) reaches further and still
 * counts.
 */
export const KEY_AA_RING_PX = 2;

/**
 * Background purity of a key-mode frame: content is every pixel further than
 * 64 levels from the key colour; background pixels beyond KEY_AA_RING_PX of
 * content are pure within key.purityLevels and impure otherwise.
 */
export function keyPurity(frame: Frame, key: [number, number, number]): { pure: number; impure: number } {
  const tolerance = NUMBERS['key.purityLevels'];
  const near = 64;
  const pixels = frame.width * frame.height;
  const distance = new Uint8Array(pixels);
  const content = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p += 1) {
    const d = Math.max(Math.abs((frame.data[p * 4] ?? 0) - key[0]), Math.abs((frame.data[p * 4 + 1] ?? 0) - key[1]), Math.abs((frame.data[p * 4 + 2] ?? 0) - key[2]));
    distance[p] = d;
    content[p] = d > near ? 1 : 0;
  }
  const ring = growMask(content, frame.width, frame.height, KEY_AA_RING_PX);
  let pure = 0;
  let impure = 0;
  for (let p = 0; p < pixels; p += 1) {
    if (ring[p]) continue;
    if ((distance[p] ?? 0) <= tolerance) pure += 1;
    else impure += 1;
  }
  return { pure, impure };
}

/** The most common colour of a frame (the key ground of a key-mode render). */
function dominantColour(frame: Frame): [number, number, number] {
  const counts = new Map<number, number>();
  for (let p = 0; p < frame.width * frame.height; p += 4) {
    const key = ((frame.data[p * 4] ?? 0) << 16) | ((frame.data[p * 4 + 1] ?? 0) << 8) | (frame.data[p * 4 + 2] ?? 0);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

/** The three fixed plates for alpha overlays (check-profiles.md); the photo plate is a warm mid tone stand-in. */
export const PLATES: Record<string, [number, number, number]> = { 'plate-grey': [128, 128, 128], 'plate-light': [242, 242, 242], 'plate-photo': [156, 123, 99] };

/** WCAG contrast of the ink colour against the median of the 8 px ring around the box (over a plate for alpha). */
export function ringContrast(frame: Frame, box: { x: number; y: number; width: number; height: number }, ink: [number, number, number], plate: [number, number, number] | null): number {
  const ring: number[][] = [[], [], []];
  const x0 = Math.max(0, Math.floor(box.x - 8));
  const y0 = Math.max(0, Math.floor(box.y - 8));
  const x1 = Math.min(frame.width - 1, Math.ceil(box.x + box.width + 8));
  const y1 = Math.min(frame.height - 1, Math.ceil(box.y + box.height + 8));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      if (inside) continue;
      const base = (y * frame.width + x) * 4;
      const alpha = plate ? (frame.data[base + 3] ?? 255) / 255 : 1;
      for (let c = 0; c < 3; c += 1) {
        const v = frame.data[base + c] ?? 0;
        ring[c]?.push(plate ? v * alpha + (plate[c] ?? 0) * (1 - alpha) : v);
      }
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const bg = ring.map(median) as [number, number, number];
  const a = relativeLuminance(ink[0], ink[1], ink[2]);
  const b = relativeLuminance(bg[0], bg[1], bg[2]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Rubric cap order (RUBRIC.caps) to the check each cap belongs to. */
const CAP_CHECKS: CheckId[] = ['frame0-ink', 'still', 'contrast-soft', 'min-size', 'reading-hold', 'face-band', 'engine-warnings', 'loudness', 'low-share', 'sfx-timing', 'sfx-rise'];

function readJson<T>(file: string | null | undefined): T | null {
  if (!file || !existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Measure a rendered file into a metrics document. */
export async function measure(video: string, options: MeasureOptions): Promise<Record<string, unknown>> {
  if (!existsSync(video)) throw new MfmError('USAGE', { file: video }, { message: `${video} does not exist.` });
  const info = await probe(video, { frames: true });
  if (!info.video) throw new MfmError('TOOL_FAILED', { file: video }, { message: `${video} has no video stream.` });
  const { profile } = options;
  const mode = modeFor(profile);
  const fps = info.video.fps.value || 30;
  const frameSec = 1 / fps;
  const times = info.frameTimes ?? [];
  const frameCount = times.length || info.video.frames || Math.round(info.durationSec * fps);
  const durationSec = round(frameCount * frameSec);
  const expectedSec = options.expectedSec ?? durationSec;
  const ctx = { captions: options.captions === true, avoidFace: options.avoidFace !== false, hasAudio: info.hasAudio };
  // Audio metrics apply to films only (moves are silent; check-profiles.md).
  const audio = profile === 'film' ? await audioMetrics(video, { hasAudio: info.hasAudio, soundFile: options.soundFile ?? null, fps }) : null;

  // Timestamps: interval jitter against 1/fps.
  let irregular = 0;
  let maxJitterMs = 0;
  for (let i = 1; i < times.length; i += 1) {
    const jitter = Math.abs((times[i] ?? 0) - (times[i - 1] ?? 0) - frameSec) * 1000;
    maxJitterMs = Math.max(maxJitterMs, jitter);
    if (jitter > NUMBERS['timestamps.maxJitterMs']) irregular += 1;
  }

  // Frame 0 ink (film, broll) and overlay coverage (overlays).
  const first = await frameAt(video, 0, { format: 'rgba' });
  const frame0Ink = profile === 'film' || profile === 'broll' ? round(inkFraction(first, 24), 4) : null;
  let overlayCoverage: { first: number; last: number; firstInkSec: number } | null = null;
  if (mode === 'alpha') {
    const last = await frameAt(video, Math.max(0, durationSec - frameSec), { format: 'rgba' });
    let firstInkSec = durationSec;
    let index = 0;
    for await (const frame of frames(video, { fps: info.video.fps.text, width: 160, format: 'rgba' })) {
      if (alphaCoverage(frame) > NUMBERS['overlay.emptyCoverageMax']) {
        firstInkSec = round(index * frameSec);
        break;
      }
      index += 1;
    }
    overlayCoverage = { first: round(alphaCoverage(first), 4), last: round(alphaCoverage(last), 4), firstInkSec };
  }

  // Still stretches with exemptions.
  const holds = options.holds ?? [];
  const stills: StillStretch[] = (await stillStretches(video, durationSec)).map((stretch) => {
    let exempt: StillStretch['exempt'] = null;
    if (profile === 'film' && options.endCardFromSec !== null && options.endCardFromSec !== undefined && stretch.fromSec >= options.endCardFromSec - frameSec) exempt = 'end-card';
    if (mode !== 'full' && holds.some((hold) => stretch.fromSec >= hold.fromSec - 0.1 && stretch.toSec <= hold.toSec + 0.1)) exempt = 'hold';
    return { ...stretch, exempt };
  });
  const longestStillSec = Math.max(0, ...stills.filter((stretch) => stretch.exempt === null).map((stretch) => stretch.lenSec));

  // Audit (lines, hits) and engine check, when written beside the video.
  const dir = path.dirname(video);
  const audit = readJson<{ hits?: Array<{ fromSec: number; toSec: number; elementId: string; problem: string }>; lines?: AuditLine[] }>(options.auditFile ?? path.join(dir, 'audit.json'));
  const check = readJson<{ errors?: number; warnings?: number; findings?: Array<{ code: string; atSec: number | null; message: string }> }>(options.checkFile ?? path.join(dir, 'check.json'));
  const lines = (audit?.lines ?? []).map(({ elementId, inSec, outSec, holdSec, words, ok }) => ({ elementId, inSec, outSec, holdSec, words, ok }));

  // Contrast per line at its hold midpoint (worst plate for alpha overlays).
  const contrast: Array<{ atSec: number; elementId: string; ratio: number; plate: string | null }> = [];
  for (const line of audit?.lines ?? []) {
    if (!line.box || !line.color) continue;
    const atSec = round((line.inSec + line.outSec) / 2);
    const frame = await frameAt(video, atSec, { format: 'rgba' });
    const ink = parseHex(line.color);
    if (mode === 'alpha') {
      const worst = Object.entries(PLATES)
        .map(([name, plate]) => ({ name, ratio: ringContrast(frame, line.box as NonNullable<AuditLine['box']>, ink, plate) }))
        .sort((a, b) => a.ratio - b.ratio)[0];
      if (worst) contrast.push({ atSec, elementId: line.elementId, ratio: round(worst.ratio, 2), plate: worst.name });
    } else {
      contrast.push({ atSec, elementId: line.elementId, ratio: round(ringContrast(frame, line.box, ink, null), 2), plate: null });
    }
  }

  // Key purity on the first, middle and last frame.
  let key: { color: string; impurePixels: number } | null = null;
  if (mode === 'key') {
    const keyRgb = options.keyColor ? parseHex(options.keyColor) : dominantColour(first);
    let impure = 0;
    for (const at of [0, durationSec / 2, Math.max(0, durationSec - frameSec)]) impure += keyPurity(await frameAt(video, at, { format: 'rgba' }), keyRgb).impure;
    key = { color: toHex(keyRgb), impurePixels: impure };
  }

  // Hard results through the profile.
  const hard: Array<{ check: string; pass: boolean; value: number | string; limit: number | string }> = [];
  const isHard = (id: CheckId) => modeOf(profile, id, ctx) === 'hard';
  const offFrames = Math.abs(durationSec - expectedSec) * fps;
  if (isHard('duration')) hard.push({ check: 'duration', pass: offFrames <= NUMBERS['duration.toleranceFrames'] + 1e-6, value: `${durationSec} s`, limit: `${round(expectedSec)} s +-${NUMBERS['duration.toleranceFrames']} frame` });
  if (isHard('timestamps')) hard.push({ check: 'timestamps', pass: irregular === 0, value: round(maxJitterMs, 2), limit: NUMBERS['timestamps.maxJitterMs'] });
  if (isHard('overlay-empty') && overlayCoverage) {
    const max = NUMBERS['overlay.emptyCoverageMax'];
    const pass = overlayCoverage.first <= max && overlayCoverage.last <= max && overlayCoverage.firstInkSec <= NUMBERS['overlay.firstInkSec'] + frameSec / 2;
    hard.push({ check: 'overlay-empty', pass, value: `first ${overlayCoverage.first}, last ${overlayCoverage.last}, first ink ${overlayCoverage.firstInkSec} s`, limit: `coverage <= ${max}, first ink <= ${NUMBERS['overlay.firstInkSec']} s` });
  }
  if (isHard('key-purity') && key) hard.push({ check: 'key-purity', pass: key.impurePixels === 0, value: key.impurePixels, limit: 0 });
  if (isHard('contrast-hard') && contrast.length > 0) {
    const worst = Math.min(...contrast.map((entry) => entry.ratio));
    hard.push({ check: 'contrast-hard', pass: worst >= NUMBERS['contrast.hardMin'], value: worst, limit: NUMBERS['contrast.hardMin'] });
  }
  for (const [problem, id] of [['frame-margin', 'frame-margin'], ['copy-safe', 'copy-safe'], ['caption-band', 'caption-band'], ['spill', 'frame-margin'], ['overlap', 'frame-margin']] as const) {
    if (!audit || !isHard(id)) continue;
    const count = (audit.hits ?? []).filter((hit) => hit.problem === problem).length;
    hard.push({ check: problem, pass: count === 0, value: count, limit: 0 });
  }
  if (check && isHard('engine-errors')) hard.push({ check: 'engine-errors', pass: (check.errors ?? 0) === 0, value: check.errors ?? 0, limit: 0 });
  if (audio && isHard('true-peak')) hard.push({ check: 'true-peak', pass: audio.truePeak <= NUMBERS['audio.truePeakMax'], value: audio.truePeak, limit: NUMBERS['audio.truePeakMax'] });

  // Caps from the rubric, kept only where the profile applies the check.
  const capInput: CapMetrics = {
    fps: info.video.fps.text,
    frame0Ink,
    stills,
    contrast,
    audit: { hits: audit?.hits ?? [] },
    lines,
    audio,
    engineCheck: { warnings: check?.warnings ?? 0 },
  };
  const caps = capFor(capInput).filter((cap) => {
    const index = RUBRIC.caps.findIndex((entry) => cap.because.startsWith(entry.defect));
    const id = CAP_CHECKS[index];
    return id !== undefined && applies(profile, id, ctx);
  });

  return {
    schemaVersion: 1,
    kind: 'metrics',
    file: path.basename(video),
    sha256: createHash('sha256').update(readFileSync(video)).digest('hex'),
    profile,
    aspect: aspectOf(info.video.width, info.video.height),
    mode,
    durationSec,
    expectedSec: round(expectedSec),
    frames: frameCount,
    fps: info.video.fps.text.replace(/\/1$/, ''),
    timestamps: { irregular, maxJitterMs: round(maxJitterMs, 3) },
    frame0Ink,
    overlayCoverage,
    stills,
    longestStillSec: round(longestStillSec),
    contrast,
    audit: { hits: audit?.hits ?? [] },
    lines,
    key,
    audio,
    engineCheck: { errors: check?.errors ?? 0, warnings: check?.warnings ?? 0, findings: check?.findings ?? [] },
    hard,
    caps,
  };
}

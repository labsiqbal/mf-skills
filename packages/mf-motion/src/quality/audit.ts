// The frame audit (verification.md, Frame audit): open a composition in the
// page driver, seek every audit.stepSec plus each line's landing and exit
// start, measure every visible text node's ink box with Range.getClientRects()
// and record frame-margin, copy-safe, spill, overlap, caption-band, face-band
// and min-size hits; read window.MF_REPORT.lines for the hold rule.
/// <reference lib="dom" />
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { MfmError } from '../cli/errors';
import path from 'node:path';
import type { Engine } from '../engine/index';
import { evaluate, seek, withPage } from '../media/chrome';
import { type AspectKey, NUMBERS } from '../kit/numbers';
import { type Rect, safeBoxes } from '../kit/safe';
import { type CheckId, type Profile, modeOf } from './profiles';

export const AUDIT_PROBLEMS = ['frame-margin', 'copy-safe', 'spill', 'overlap', 'caption-band', 'face-band', 'min-size'] as const;
export type AuditProblem = (typeof AUDIT_PROBLEMS)[number];

/** The profile check each problem belongs to (check-profiles.md: spill and overlap sit with the frame margin). */
export const PROBLEM_CHECK: Record<AuditProblem, CheckId> = {
  'frame-margin': 'frame-margin',
  'copy-safe': 'copy-safe',
  spill: 'frame-margin',
  overlap: 'frame-margin',
  'caption-band': 'caption-band',
  'face-band': 'face-band',
  'min-size': 'min-size',
};

export interface AuditHit {
  fromSec: number;
  toSec: number;
  elementId: string;
  problem: AuditProblem;
}

export interface AuditLine {
  elementId: string;
  /** Entrance landing (the line is readable from here). */
  inSec: number;
  /** Exit start (the composition end for lines that stay). */
  outSec: number;
  holdSec: number;
  words: number;
  /** The hold the line needed (read.*). */
  needSec: number;
  ok: boolean;
  /** Ink box at the hold midpoint and the text colour, for the contrast metric. */
  box?: Rect;
  color?: string;
}

export interface AuditResult {
  hits: AuditHit[];
  lines: AuditLine[];
  /** Hits whose check is hard for the profile. */
  hard: number;
  times: number[];
}

export interface AuditOptions {
  profile: Profile;
  /** Default: from the composition's width and height. */
  aspect?: AspectKey;
  /** Films: the brief sets captions (the caption band applies). */
  captions?: boolean;
  /** Overlays: avoid the face band (default true). */
  avoidFace?: boolean;
  entry?: string;
  engine?: Engine;
  browserPath?: string;
}

/** One text owner's ink at one step, as measured in the page. */
interface Sample {
  key: string;
  elementId: string;
  lineId: string | null;
  /** Ink of its visible text (opacity at least audit.ignoreOpacityBelow), or null when none shows. */
  box: Rect | null;
  /** Ink of all its text, visible or not: what the moving exemption compares between steps. */
  all: Rect;
  bleed: boolean;
  layered: boolean;
  /** Box of the nearest ancestor with a painted background or border, or null. */
  container: Rect | null;
  /** Smallest rendered font size of its text, in px. */
  fontPx: number;
}

interface PageReport {
  width: number;
  height: number;
  duration: number;
  lines: Array<{ id: string; inSec: number; landSec: number; outSec: number | null; accent: boolean; words: number }>;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Composition size, duration and the runtime's line schedule (MF_REPORT.lines). */
function pageReport(): PageReport {
  const root = document.querySelector('[data-composition-id]') as HTMLElement;
  const report = (window as unknown as { MF_REPORT?: { lines?: Array<{ id: string; inSec: number; landSec: number; outSec: number | null }>; duration?: number } }).MF_REPORT;
  const duration = Number(root.dataset.duration ?? report?.duration ?? 0);
  return {
    width: Number(root.dataset.width ?? root.clientWidth),
    height: Number(root.dataset.height ?? root.clientHeight),
    duration,
    lines: (report?.lines ?? []).map((line) => {
      const element = line.id ? document.getElementById(line.id) : null;
      const text = (element?.textContent ?? '').trim();
      return { id: line.id, inSec: line.inSec, landSec: line.landSec, outSec: line.outSec, accent: element?.hasAttribute('data-mf-accent') ?? false, words: text ? text.split(/\s+/).length : 0 };
    }),
  };
}

/** Every visible text owner's ink box at the current frame (runs in the page). */
function measure(opacityMin: number): Sample[] {
  const root = document.querySelector('[data-composition-id]') as HTMLElement;
  const origin = root.getBoundingClientRect();
  const owners = new Map<Element, Sample>();
  const idOf = (element: Element): string => {
    const withId = element.closest('[id]');
    if (withId && root.contains(withId) && withId !== root) return withId.id;
    const parts: string[] = [];
    let node: Element | null = element;
    while (node && node !== root) {
      const parent: Element | null = node.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(node) : 0;
      parts.unshift(`${node.tagName.toLowerCase()}${index}`);
      node = parent;
    }
    return parts.join('>');
  };
  const painted = (style: CSSStyleDeclaration) => {
    const background = style.backgroundColor;
    const clear = background === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(background);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
    return !clear || style.backgroundImage !== 'none' || border;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    let opacity = 1;
    let hidden = false;
    for (let element: Element | null = parent; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      opacity *= parseFloat(style.opacity);
      if (style.display === 'none' || style.visibility === 'hidden') hidden = true;
      if (element === root) break;
    }
    const visible = !hidden && opacity >= opacityMin;
    // Ancestors that clip (overflow other than visible, as entrance masks do) cut the ink box.
    let clip: { left: number; top: number; right: number; bottom: number } | null = null;
    for (let element: Element | null = parent; element && element !== root; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const rect = element.getBoundingClientRect();
      clip = clip
        ? { left: Math.max(clip.left, rect.left), top: Math.max(clip.top, rect.top), right: Math.min(clip.right, rect.right), bottom: Math.min(clip.bottom, rect.bottom) }
        : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const all = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (all.length === 0) continue;
    const clipped = all
      .map((rect) => (clip ? { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top), right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) } : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }))
      .filter((rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5);
    // Fully masked text is not visible; its unclipped box still tracks motion.
    const shown = visible && clipped.length > 0;
    const bounds = (rects: Array<{ left: number; top: number; right: number; bottom: number }>): Rect => {
      const x0 = Math.min(...rects.map((rect) => rect.left));
      const y0 = Math.min(...rects.map((rect) => rect.top));
      return { x: x0 - origin.left, y: y0 - origin.top, width: Math.max(...rects.map((rect) => rect.right)) - x0, height: Math.max(...rects.map((rect) => rect.bottom)) - y0 };
    };
    const unclipped = bounds(all);
    const box = shown ? bounds(clipped) : null;
    const owner = parent.closest('.mf-line') ?? parent;
    // Rendered font size: computed size times the element's current scale.
    const width = (parent as HTMLElement).offsetWidth;
    const scale = width > 0 ? parent.getBoundingClientRect().width / width : 1;
    const fontPx = parseFloat(getComputedStyle(parent).fontSize) * scale;
    let container: Rect | null = null;
    for (let element: Element | null = parent; element && element !== root; element = element.parentElement) {
      if (painted(getComputedStyle(element))) {
        const rect = element.getBoundingClientRect();
        container = { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
        break;
      }
    }
    const grow = (a: Rect | null, b: Rect): Rect => {
      if (!a) return { ...b };
      const gx1 = Math.max(a.x + a.width, b.x + b.width);
      const gy1 = Math.max(a.y + a.height, b.y + b.height);
      const gx0 = Math.min(a.x, b.x);
      const gy0 = Math.min(a.y, b.y);
      return { x: gx0, y: gy0, width: gx1 - gx0, height: gy1 - gy0 };
    };
    const existing = owners.get(owner);
    if (existing) {
      existing.all = grow(existing.all, unclipped);
      if (box) {
        existing.box = grow(existing.box, box);
        existing.fontPx = Math.min(existing.fontPx, fontPx);
      }
      continue;
    }
    owners.set(owner, {
      key: idOf(owner),
      elementId: idOf(owner),
      lineId: owner.classList.contains('mf-line') ? idOf(owner) : null,
      box,
      all: unclipped,
      bleed: parent.closest('[data-mf-bleed]') !== null,
      layered: parent.closest('[data-mf-layered]') !== null,
      container,
      fontPx: box ? fontPx : Number.POSITIVE_INFINITY,
    });
  }
  return [...owners.values()];
}

/** Box and text colour of one element at the current frame (runs in the page). */
function lineInk(id: string): { box: Rect; color: string } | null {
  const element = document.getElementById(id);
  const root = document.querySelector('[data-composition-id]') as HTMLElement;
  if (!element) return null;
  const origin = root.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((rect) => rect.left));
  const y0 = Math.min(...rects.map((rect) => rect.top));
  const x1 = Math.max(...rects.map((rect) => rect.right));
  const y1 = Math.max(...rects.map((rect) => rect.bottom));
  const textNode = element.querySelector('.mf-word, .mf-char') ?? element;
  const [r = 0, g = 0, b = 0] = (getComputedStyle(textNode).color.match(/[\d.]+/g) ?? []).map(Number);
  const hex = `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return { box: { x: x0 - origin.left, y: y0 - origin.top, width: x1 - x0, height: y1 - y0 }, color: hex };
}

const inside = (box: Rect, area: Rect, tolerance = 0.5) =>
  box.x >= area.x - tolerance && box.y >= area.y - tolerance && box.x + box.width <= area.x + area.width + tolerance && box.y + box.height <= area.y + area.height + tolerance;

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The box shrunk by `share` of its height, half at the top and half at the bottom. */
const shrinkY = (box: Rect, share: number): Rect => ({ x: box.x, y: box.y + (box.height * share) / 2, width: box.width, height: box.height * (1 - share) });

/** How far a box moved between two steps (the largest edge shift). */
const moved = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.width - (b.x + b.width)), Math.abs(a.y + a.height - (b.y + b.height)));

/** The aspect of a frame size. */
export function aspectOf(width: number, height: number): AspectKey {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  return ratio > 1 ? '16:9' : '9:16';
}

/** Sample times: every audit.stepSec up to the last frame, plus each line's landing and exit start. */
export function auditTimes(durationSec: number, fps: number, extra: number[]): number[] {
  const step = NUMBERS['audit.stepSec'];
  const last = durationSec - 1 / fps;
  const times = new Set<number>();
  for (let i = 0; i * step <= last + 1e-9; i += 1) times.add(round(i * step));
  for (const time of extra) if (time >= 0 && time <= last + 1e-9) times.add(round(time));
  return [...times].sort((a, b) => a - b);
}

/** read.*: the hold a line needs. */
export function neededHold(words: number, options: { accent?: boolean; last?: boolean } = {}): number {
  const rule = NUMBERS['read.holdSec'];
  let need = rule.base + rule.perWord * words;
  if (options.accent && words <= NUMBERS['read.accentWordMinSec'].maxWords) need = NUMBERS['read.accentWordMinSec'].sec;
  if (options.last) need = Math.max(need, NUMBERS['read.lastLineMinSec']);
  return round(need);
}

/** Merge per-step hits into ranges: consecutive samples of one element and problem become one range. */
export function mergeHits(stepHits: Array<{ index: number; time: number; elementId: string; problem: AuditProblem }>): AuditHit[] {
  const open = new Map<string, { hit: AuditHit; lastIndex: number }>();
  const done: AuditHit[] = [];
  for (const entry of [...stepHits].sort((a, b) => a.index - b.index)) {
    const key = `${entry.problem}\u0000${entry.elementId}`;
    const current = open.get(key);
    if (current && current.lastIndex === entry.index - 1) {
      current.hit.toSec = entry.time;
      current.lastIndex = entry.index;
      continue;
    }
    if (current) done.push(current.hit);
    open.set(key, { hit: { fromSec: entry.time, toSec: entry.time, elementId: entry.elementId, problem: entry.problem }, lastIndex: entry.index });
  }
  for (const { hit } of open.values()) done.push(hit);
  return done.sort((a, b) => a.fromSec - b.fromSec || a.elementId.localeCompare(b.elementId) || a.problem.localeCompare(b.problem));
}

/** Audit a composition build folder. */
export async function audit(buildDir: string, options: AuditOptions): Promise<AuditResult> {
  const entry = options.entry ?? 'index.html';
  const context = { captions: options.captions === true, avoidFace: options.avoidFace !== false };
  const applies = (problem: AuditProblem) => modeOf(options.profile, PROBLEM_CHECK[problem], context) !== 'off';
  const opacityMin = NUMBERS['audit.ignoreOpacityBelow'];
  // The viewport is the composition's own size, read from its root before opening it.
  const source = readFileSync(path.join(buildDir, entry), 'utf8');
  const width = Number(source.match(/data-composition-id[^>]*?data-width="(\d+)"/)?.[1] ?? source.match(/data-width="(\d+)"/)?.[1]);
  const height = Number(source.match(/data-height="(\d+)"/)?.[1]);
  if (!(width > 0 && height > 0)) throw new MfmError('USAGE', { entry: path.join(buildDir, entry) }, { message: `${entry} has no composition root with data-width and data-height.` });
  return withPage({ dir: buildDir, entry, width, height, ...(options.engine ? { engine: options.engine } : {}), ...(options.browserPath ? { browserPath: options.browserPath } : {}) }, async (page) => {
    const report = await evaluate(page, pageReport, undefined);
    const fps = await evaluate(page, () => {
      const value = (document.querySelector('[data-composition-id]') as HTMLElement).dataset.fps ?? '30';
      const [num = 30, den = 1] = value.split('/').map(Number);
      return num / den;
    }, undefined);
    const aspect = options.aspect ?? aspectOf(report.width, report.height);
    const safe = safeBoxes(aspect, options.profile, { width: report.width, ...context });
    const minPx = NUMBERS['type.minReadablePx'].shortSideShare * Math.min(report.width, report.height);
    const lineTimes = new Map(report.lines.map((line) => [line.id, line]));
    const times = auditTimes(report.duration, fps, report.lines.flatMap((line) => [line.landSec, ...(line.outSec === null ? [] : [line.outSec])]));

    const stepHits: Array<{ index: number; time: number; elementId: string; problem: AuditProblem }> = [];
    let previous = new Map<string, Rect>();
    for (const [index, time] of times.entries()) {
      await seek(page, time);
      const samples = await evaluate(page, measure, opacityMin);
      const hit = (sample: Sample, problem: AuditProblem) => {
        if (applies(problem)) stepHits.push({ index, time, elementId: sample.elementId, problem });
      };
      for (const sample of samples) {
        const before = previous.get(sample.key);
        const box = sample.box;
        if (!box) continue;
        const moving = before !== undefined && moved(before, sample.all) > NUMBERS['audit.movingExemptPxPerStep'];
        if (!sample.bleed && !moving) {
          if (!inside(box, safe.frame)) hit(sample, 'frame-margin');
          if (!inside(box, safe.copy)) hit(sample, 'copy-safe');
        }
        if (sample.container) {
          const tolerance = NUMBERS['audit.spillTolerancePx'];
          const c = sample.container;
          const b = box;
          if (b.x < c.x - tolerance || b.y < c.y - tolerance || b.x + b.width > c.x + c.width + tolerance || b.y + b.height > c.y + c.height + tolerance) hit(sample, 'spill');
        }
        if (safe.captionBand && intersects(box, safe.captionBand)) hit(sample, 'caption-band');
        if (safe.faceBand && intersects(box, safe.faceBand)) hit(sample, 'face-band');
        const line = sample.lineId ? lineTimes.get(sample.lineId) : undefined;
        const holding = line ? time >= line.landSec - 1e-6 && time <= (line.outSec ?? report.duration) + 1e-6 : true;
        if (holding && sample.fontPx < minPx - 0.01) hit(sample, 'min-size');
      }
      // Text on text: different lines whose boxes meet after shrinking each 20% vertically.
      const lines = samples.filter((sample): sample is Sample & { box: Rect } => sample.lineId !== null && !sample.layered && sample.box !== null);
      for (let i = 0; i < lines.length; i += 1) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const a = lines[i] as Sample & { box: Rect };
          const b = lines[j] as Sample & { box: Rect };
          if (a.lineId === b.lineId) continue;
          if (intersects(shrinkY(a.box, NUMBERS['audit.overlapShrinkY']), shrinkY(b.box, NUMBERS['audit.overlapShrinkY']))) {
            hit(a, 'overlap');
            hit(b, 'overlap');
          }
        }
      }
      previous = new Map(samples.map((sample) => [sample.key, sample.all]));
    }

    // Lines: hold from landing to exit start against read.*.
    const lastOut = Math.max(...report.lines.map((line) => line.outSec ?? report.duration), 0);
    const lines: AuditLine[] = [];
    for (const line of report.lines) {
      const outSec = round(line.outSec ?? report.duration);
      const holdSec = round(outSec - line.landSec);
      const needSec = neededHold(line.words, { accent: line.accent, last: (line.outSec ?? report.duration) >= lastOut - 1e-6 });
      const entry: AuditLine = { elementId: line.id, inSec: round(line.landSec), outSec, holdSec, words: line.words, needSec, ok: holdSec >= needSec - 1e-6 };
      if (holdSec > 0) {
        await seek(page, round((line.landSec + outSec) / 2));
        const ink = await evaluate(page, lineInk, line.id);
        if (ink) {
          entry.box = { x: round(ink.box.x), y: round(ink.box.y), width: round(ink.box.width), height: round(ink.box.height) };
          entry.color = ink.color;
        }
      }
      lines.push(entry);
    }
    const hits = mergeHits(stepHits);
    const hard = hits.filter((hit) => modeOf(options.profile, PROBLEM_CHECK[hit.problem], context) === 'hard').length;
    return { hits, lines, hard, times };
  });
}

/** Write audit.json ({ hits, lines }). */
export function writeAudit(file: string, result: AuditResult): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify({ hits: result.hits, lines: result.lines }, null, 2)}\n`);
  renameSync(temp, file);
}

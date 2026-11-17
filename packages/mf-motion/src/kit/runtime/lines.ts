/// <reference lib="dom" />
// Text lines in the composition page: every `.mf-line` gets its entrance and
// exit tweens on the composition's GSAP timeline from data-mf-in and
// data-mf-out. Parts are split by word or letter as the kind needs, never by
// letter for complex scripts or right-to-left lines.
import { t as timeOf } from './time';
import {
  CLIPPED_ENTRANCES,
  CLIPPED_EXITS,
  ENTRANCE,
  EXIT,
  type EntranceKind,
  type ExitKind,
  LINE_CSS,
  type SplitUnit,
  entranceDuration,
  exitDuration,
  formatCount,
  hashText,
  isRtlText,
  parseCount,
  parseEntrance,
  parseExit,
  seeded,
  splitFor,
} from './spec';

/**
 * How far clipped parts travel, as a share of their own height: past the clip
 * floor (type.clipFloorEm below the line box) so nothing peeks in at the start.
 */
const TRAVEL = 150;

/** The slice of a GSAP timeline the runtime uses. */
export interface Timeline {
  set(target: unknown, vars: Record<string, unknown>, position?: number): Timeline;
  to(target: unknown, vars: Record<string, unknown>, position?: number): Timeline;
  fromTo(target: unknown, from: Record<string, unknown>, to: Record<string, unknown>, position?: number): Timeline;
}

export interface LineSchedule {
  element: HTMLElement;
  entrance: EntranceKind;
  exit: ExitKind;
  split: SplitUnit;
  /** Entrance start, landing time and exit start / end in seconds. */
  inSec: number;
  landSec: number;
  outSec: number | null;
  goneSec: number | null;
}

function injectCss(doc: Document): void {
  if (doc.getElementById('mf-line-css')) return;
  const style = doc.createElement('style');
  style.id = 'mf-line-css';
  style.textContent = LINE_CSS;
  doc.head.appendChild(style);
}

function fpsOf(element: HTMLElement): number {
  const root = element.closest('[data-composition-id]') as HTMLElement | null;
  const value = root?.dataset.fps ?? '30';
  const [num = 30, den = 1] = value.split('/').map(Number);
  return num / den;
}

function compositionEnd(element: HTMLElement): number {
  const root = element.closest('[data-composition-id]') as HTMLElement | null;
  const duration = Number(root?.dataset.duration ?? '0');
  return duration > 0 ? duration : 60;
}

/** Wrap the line's text in clip > body > parts. */
function build(element: HTMLElement, unit: SplitUnit): { clip: HTMLElement; body: HTMLElement; parts: HTMLElement[]; text: string } {
  const doc = element.ownerDocument;
  const text = element.textContent ?? '';
  element.textContent = '';
  const clip = doc.createElement('span');
  clip.className = 'mf-clip';
  const body = doc.createElement('span');
  body.className = 'mf-body';
  clip.appendChild(body);
  element.appendChild(clip);
  const parts: HTMLElement[] = [];
  if (unit === 'line') {
    body.textContent = text;
    return { clip, body, parts: [body], text };
  }
  for (const token of text.split(/(\s+)/)) {
    if (token === '') continue;
    if (/^\s+$/.test(token)) {
      body.appendChild(doc.createTextNode(token));
      continue;
    }
    if (unit === 'word') {
      const word = doc.createElement('span');
      word.className = 'mf-word';
      word.textContent = token;
      body.appendChild(word);
      parts.push(word);
    } else {
      const word = doc.createElement('span');
      word.className = 'mf-word';
      for (const char of token) {
        const span = doc.createElement('span');
        span.className = 'mf-char';
        span.textContent = char;
        word.appendChild(span);
        parts.push(span);
      }
      body.appendChild(word);
    }
  }
  return { clip, body, parts, text };
}

function entrance(tl: Timeline, kind: EntranceKind, ctx: { element: HTMLElement; clip: HTMLElement; body: HTMLElement; parts: HTMLElement[]; text: string; at: number; until: number; fps: number; rtl: boolean; unit: SplitUnit }): void {
  const { body, parts, at, fps, rtl, unit } = ctx;
  switch (kind) {
    case 'rise':
      tl.fromTo(body, { yPercent: TRAVEL }, { yPercent: 0, duration: ENTRANCE.rise.sec, ease: ENTRANCE.rise.ease }, at);
      return;
    case 'words':
      parts.forEach((part, i) => tl.fromTo(part, { yPercent: TRAVEL }, { yPercent: 0, duration: ENTRANCE.words.eachSec, ease: ENTRANCE.words.ease }, at + i * ENTRANCE.words.staggerSec));
      return;
    case 'letters': {
      const each = unit === 'char' ? ENTRANCE.letters.eachSec : ENTRANCE.words.eachSec;
      const stagger = unit === 'char' ? ENTRANCE.letters.staggerFrames / fps : ENTRANCE.words.staggerSec;
      parts.forEach((part, i) => tl.fromTo(part, { yPercent: TRAVEL }, { yPercent: 0, duration: each, ease: ENTRANCE.letters.ease }, at + i * stagger));
      return;
    }
    case 'ink':
      parts.forEach((part, i) =>
        tl.fromTo(part, { opacity: 0, y: ENTRANCE.ink.driftPx }, { opacity: 1, y: 0, duration: ENTRANCE.ink.eachSec, ease: ENTRANCE.ink.ease }, at + i * ENTRANCE.ink.staggerSec),
      );
      return;
    case 'type': {
      // Untyped characters take no space, so the caret follows the text; a space
      // appears with the character before it.
      const doc = ctx.element.ownerDocument;
      for (const node of [...body.childNodes]) {
        if (node.nodeType !== 3) continue;
        const space = doc.createElement('span');
        space.className = 'mf-space';
        space.textContent = node.textContent;
        node.replaceWith(space);
      }
      const step = 1 / ENTRANCE.type.charsPerSec;
      const reveal = (node: HTMLElement, time: number, display: string) => {
        tl.set(node, { display: 'none' }, 0);
        tl.set(node, { display }, time);
      };
      let typed = 0;
      let last = at;
      for (const node of [...body.children] as HTMLElement[]) {
        if (node.classList.contains('mf-space')) {
          reveal(node, last, 'inline');
          continue;
        }
        for (const part of unit === 'char' ? ([...node.children] as HTMLElement[]) : [node]) {
          typed += [...(part.textContent ?? '')].length;
          last = at + typed * step;
          reveal(part, last, 'inline-block');
        }
      }
      const caret = doc.createElement('span');
      caret.className = 'mf-caret';
      body.appendChild(caret);
      tl.set(caret, { opacity: 1 }, 0);
      // The caret blinks every caretBlinkSec from the end of typing until the line leaves.
      const blink = ENTRANCE.type.caretBlinkSec;
      for (let i = 1; last + i * blink < ctx.until; i += 1) tl.set(caret, { opacity: i % 2 === 1 ? 0 : 1 }, last + i * blink);
      return;
    }
    case 'slot': {
      const options = (ctx.element.dataset.mfOptions ?? '').split('|').map((option) => option.trim()).filter(Boolean);
      const random = seeded(hashText(ctx.text));
      const rolls =
        options.length > 0
          ? options
          : Array.from({ length: ENTRANCE.slot.defaultOptions }, () => [...ctx.text].sort(() => random() - 0.5).join(''));
      const slot = ctx.element.ownerDocument.createElement('span');
      slot.className = 'mf-slot';
      const strip = ctx.element.ownerDocument.createElement('span');
      for (const value of [...rolls, ctx.text]) {
        const row = ctx.element.ownerDocument.createElement('span');
        row.textContent = value;
        strip.appendChild(row);
      }
      slot.appendChild(strip);
      body.textContent = '';
      body.appendChild(slot);
      // Rows are laid out now: one row per perOptionSec, landing on the final word.
      const rows = [...strip.children] as HTMLElement[];
      const top = rows[0]?.offsetTop ?? 0;
      tl.set(strip, { y: 0 }, 0);
      rows.forEach((row, i) => {
        if (i > 0) tl.set(strip, { y: top - row.offsetTop }, at + i * ENTRANCE.slot.perOptionSec);
      });
      return;
    }
    case 'count': {
      const format = parseCount(ctx.text);
      if (!format) {
        tl.fromTo(body, { opacity: 0 }, { opacity: 1, duration: ENTRANCE.count.countSec }, at);
        return;
      }
      const from = Number(ctx.element.dataset.mfFrom ?? '0');
      const state = { value: from };
      tl.fromTo(
        state,
        { value: from },
        {
          value: format.value,
          duration: ENTRANCE.count.countSec,
          ease: ENTRANCE.count.ease,
          onUpdate: () => {
            body.textContent = formatCount(format, state.value);
          },
        },
        at,
      );
      tl.fromTo(body, { scale: ENTRANCE.count.stampFrom }, { scale: 1, duration: ENTRANCE.count.stampSec, ease: 'power2.out' }, at + ENTRANCE.count.countSec);
      return;
    }
    case 'mask':
      tl.fromTo(body, { clipPath: rtl ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: ENTRANCE.mask.sec, ease: ENTRANCE.mask.ease }, at);
      return;
    case 'zoom':
      parts.forEach((part) =>
        tl.fromTo(
          part,
          { scale: ENTRANCE.zoom.scaleFrom, filter: `blur(${ENTRANCE.zoom.blurFromPx}px)`, opacity: 0 },
          { scale: 1, filter: 'blur(0px)', opacity: 1, duration: ENTRANCE.zoom.sec, ease: ENTRANCE.zoom.ease },
          at,
        ),
      );
      return;
    case 'scatter': {
      const random = seeded(Number(ctx.element.dataset.mfSeed ?? hashText(ctx.text)));
      const spread = ENTRANCE.scatter.spreadEm;
      parts.forEach((part) =>
        tl.fromTo(
          part,
          { x: `${(random() - 0.5) * 2 * spread}em`, y: `${(random() - 0.5) * 2 * spread}em`, rotation: (random() - 0.5) * 90, opacity: 0 },
          { x: '0em', y: '0em', rotation: 0, opacity: 1, duration: ENTRANCE.scatter.sec, ease: ENTRANCE.scatter.ease },
          at,
        ),
      );
      return;
    }
    case 'stroke': {
      const color = getComputedStyle(ctx.element).color;
      const draw = ENTRANCE.stroke.sec * ENTRANCE.stroke.drawShare;
      body.style.setProperty('-webkit-text-stroke', `max(1px, 0.025em) ${color}`);
      tl.fromTo(body, { clipPath: rtl ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)', color: 'rgba(0, 0, 0, 0)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: draw, ease: 'power2.inOut' }, at);
      tl.to(body, { color, duration: ENTRANCE.stroke.sec - draw, ease: 'power1.out' }, at + draw);
      return;
    }
  }
}

function exit(tl: Timeline, kind: ExitKind, body: HTMLElement, at: number, rtl: boolean): void {
  switch (kind) {
    case 'fall':
      tl.to(body, { yPercent: TRAVEL, duration: EXIT.fall.sec, ease: EXIT.fall.ease }, at);
      return;
    case 'up':
      tl.to(body, { yPercent: -TRAVEL, duration: EXIT.up.sec, ease: EXIT.up.ease }, at);
      return;
    case 'blur':
      tl.to(body, { filter: `blur(${EXIT.blur.blurPx}px)`, opacity: 0, duration: EXIT.blur.sec, ease: EXIT.blur.ease }, at);
      return;
    case 'wipe':
      tl.to(body, { clipPath: rtl ? 'inset(0% 100% 0% 0%)' : 'inset(0% 0% 0% 100%)', duration: EXIT.wipe.sec, ease: EXIT.wipe.ease }, at);
      return;
    case 'scale':
      tl.to(body, { scale: EXIT.scale.scaleTo, opacity: 0, duration: EXIT.scale.sec, ease: EXIT.scale.ease }, at);
      return;
    case 'zoom':
      tl.to(body, { scale: EXIT.zoom.scaleTo, filter: `blur(${EXIT.zoom.blurPx}px)`, opacity: 0, duration: EXIT.zoom.sec, ease: EXIT.zoom.ease }, at);
      return;
    case 'cut':
    case 'end':
      return;
  }
}

/** Build one line's tweens; returns its schedule. */
export function line(tl: Timeline, element: HTMLElement): LineSchedule {
  injectCss(element.ownerDocument);
  const cueIn = parseEntrance(element.dataset.mfIn ?? '');
  const cueOut = parseExit(element.dataset.mfOut ?? 'end');
  const fps = fpsOf(element);
  const raw = element.textContent ?? '';
  const rtl = element.closest('[dir]')?.getAttribute('dir') === 'rtl' || (element.getAttribute('dir') === 'auto' && isRtlText(raw)) || (!element.closest('[dir]') && isRtlText(raw));
  if (rtl && !element.getAttribute('dir')) element.setAttribute('dir', 'rtl');
  const unit = splitFor(cueIn.kind, raw, rtl);
  const { clip, body, parts, text } = build(element, unit);
  element.dataset.mfSplit = unit;

  const inSec = timeOf(cueIn.at);
  const options = (element.dataset.mfOptions ?? '').split('|').filter((option) => option.trim()).length;
  const landSec = inSec + entranceDuration(cueIn.kind, text, fps, { rtl, ...(options > 0 ? { options } : {}) });
  const outSec = cueOut.kind === 'end' ? null : timeOf(cueOut.at);
  const goneSec = outSec === null ? null : outSec + exitDuration(cueOut.kind);

  // Hidden before the entrance and after the exit, whatever the kind.
  tl.set(body, { visibility: 'hidden' }, 0);
  tl.set(body, { visibility: 'inherit' }, inSec);
  const clippedIn = CLIPPED_ENTRANCES.has(cueIn.kind);
  const clippedOut = CLIPPED_EXITS.has(cueOut.kind);
  if (clippedIn) tl.set(clip, { overflow: 'hidden' }, 0);
  if (clippedIn && !clippedOut) tl.set(clip, { overflow: 'visible' }, landSec);
  if (clippedOut && outSec !== null) tl.set(clip, { overflow: 'hidden' }, outSec);

  const until = outSec ?? compositionEnd(element);
  entrance(tl, cueIn.kind, { element, clip, body, parts, text, at: inSec, until, fps, rtl, unit });
  if (outSec !== null && goneSec !== null) {
    exit(tl, cueOut.kind, body, outSec, rtl);
    tl.set(body, { visibility: 'hidden' }, goneSec);
  }
  return { element, entrance: cueIn.kind, exit: cueOut.kind, split: unit, inSec, landSec, outSec, goneSec };
}

/** Build every `.mf-line` under root. */
export function lines(tl: Timeline, root: ParentNode = document): LineSchedule[] {
  return [...root.querySelectorAll<HTMLElement>('.mf-line')].map((element) => line(tl, element));
}

/** True when every animated part of the line is at rest: visible, untransformed, unblurred, unclipped, filled. */
export function settled(element: HTMLElement): boolean {
  const body = element.querySelector<HTMLElement>('.mf-body') ?? element;
  const parts = [body, ...element.querySelectorAll<HTMLElement>('.mf-word, .mf-char')];
  const identity = (transform: string) => transform === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(transform);
  for (const part of parts) {
    const style = getComputedStyle(part);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.999) return false;
    if (!identity(style.transform)) return false;
    if (style.filter !== 'none' && !/^blur\(0px\)$/.test(style.filter)) return false;
    if (style.clipPath !== 'none' && !/^inset\(0(%|px)?\)$/.test(style.clipPath) && !/^inset\(0% 0% 0% 0%\)$/.test(style.clipPath)) return false;
  }
  // A slot rests when its last row (the final word) sits in the window.
  const slot = element.querySelector<HTMLElement>('.mf-slot');
  const last = slot?.firstElementChild?.lastElementChild;
  if (slot && last && Math.abs(last.getBoundingClientRect().top - slot.getBoundingClientRect().top) > 0.5) return false;
  // A stroke line rests once its fill is opaque again.
  const alpha = getComputedStyle(body).color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
  return !(alpha && Number(alpha[1]) < 0.999);
}

/** True when no part of the line is visible. */
export function gone(element: HTMLElement): boolean {
  const body = element.querySelector<HTMLElement>('.mf-body') ?? element;
  const style = getComputedStyle(body);
  return style.visibility === 'hidden' || Number(style.opacity) < 0.001;
}

// Text-line rules shared by the browser runtime and Node: the entrance and
// exit kinds with their defaults (component-kit.md, Text lines), cue parsing
// ("words@bar2+0.5b"), script detection and the split each kind uses.
// No DOM, no Node APIs: this file runs in both.

export const ENTRANCE_KINDS = ['rise', 'words', 'letters', 'ink', 'type', 'slot', 'count', 'mask', 'zoom', 'scatter', 'stroke'] as const;
export const EXIT_KINDS = ['fall', 'up', 'blur', 'wipe', 'scale', 'zoom', 'cut', 'end'] as const;
export type EntranceKind = (typeof ENTRANCE_KINDS)[number];
export type ExitKind = (typeof EXIT_KINDS)[number];

/** Entrance defaults (component-kit.md). */
export const ENTRANCE = {
  rise: { sec: 0.55, ease: 'expo.out' },
  words: { eachSec: 0.16, staggerSec: 0.07, ease: 'expo.out' },
  letters: { eachSec: 0.55, staggerFrames: 1, ease: 'expo.out' },
  ink: { eachSec: 0.3, staggerSec: 0.09, driftPx: 4, ease: 'power2.out' },
  type: { charsPerSec: 28, caretBlinkSec: 0.5 },
  slot: { perOptionSec: 0.1, defaultOptions: 3 },
  count: { countSec: 0.9, stampFrom: 1.12, stampSec: 0.35, ease: 'power2.out' },
  mask: { sec: 0.6, ease: 'power3.out' },
  zoom: { sec: 0.5, scaleFrom: 2.4, blurFromPx: 12, ease: 'expo.out' },
  scatter: { sec: 0.7, ease: 'expo.out', spreadEm: 2.2 },
  stroke: { sec: 0.8, drawShare: 0.6 },
} as const;

/** Exit defaults (component-kit.md). */
export const EXIT = {
  fall: { sec: 0.25, ease: 'power3.in' },
  up: { sec: 0.25, ease: 'power3.in' },
  blur: { sec: 0.25, blurPx: 14, ease: 'power2.in' },
  wipe: { sec: 0.3, ease: 'power3.in' },
  scale: { sec: 0.2, scaleTo: 0.92, ease: 'power2.in' },
  zoom: { sec: 0.3, scaleTo: 1.6, blurPx: 12, ease: 'power3.in' },
  cut: { sec: 0 },
  end: { sec: 0 },
} as const;

/** Entrances whose parts travel inside the line's clip (masks extend type.clipFloorEm below the line box). */
export const CLIPPED_ENTRANCES: ReadonlySet<string> = new Set(['rise', 'words', 'letters']);
export const CLIPPED_EXITS: ReadonlySet<string> = new Set(['fall', 'up']);

export interface Cue<K extends string> {
  kind: K;
  /** Time spec for the time grammar (seconds, frames, bars, cues). */
  at: string;
}

function parseCue<K extends string>(value: string, kinds: readonly K[], attribute: string): Cue<K> {
  const text = value.trim();
  const at = text.indexOf('@');
  const kind = (at < 0 ? text : text.slice(0, at)).trim();
  if (!(kinds as readonly string[]).includes(kind)) {
    throw new Error(`${attribute}="${value}": unknown kind "${kind}"; use one of ${kinds.join(', ')}`);
  }
  const spec = at < 0 ? '' : text.slice(at + 1).trim();
  if (spec === '' && kind !== 'end') throw new Error(`${attribute}="${value}" needs a time after @, for example ${kind}@1.2`);
  return { kind: kind as K, at: spec };
}

export const parseEntrance = (value: string) => parseCue(value, ENTRANCE_KINDS, 'data-mf-in');
export const parseExit = (value: string) => parseCue(value, EXIT_KINDS, 'data-mf-out');

/** Scripts whose letters must not be split (type.splitComplexScripts and other shaping scripts). */
const COMPLEX =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;
/** Letters may split only for these scripts (component-kit.md: Latin, Cyrillic, Greek). */
const LETTER_SAFE = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}\s]*$/u;
const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

export const hasComplexScript = (text: string) => COMPLEX.test(text);
export const isRtlText = (text: string) => RTL.test(text);
export const lettersAllowed = (text: string, rtl = false) => !rtl && LETTER_SAFE.test(text);

export type SplitUnit = 'line' | 'word' | 'char';

/** How a kind splits this text: letter kinds fall back to words for complex scripts and right-to-left lines. */
export function splitFor(kind: EntranceKind, text: string, rtl = false): SplitUnit {
  const letters = lettersAllowed(text, rtl);
  switch (kind) {
    case 'letters':
    case 'scatter':
    case 'type':
      return letters ? 'char' : 'word';
    case 'words':
    case 'ink':
    case 'zoom':
      return 'word';
    default:
      return 'line';
  }
}

export const wordCount = (text: string) => Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
export const letterCount = (text: string) => Math.max(1, [...text.replace(/\s+/g, '')].length);

/** Seconds from an entrance's start until the line has landed. */
export function entranceDuration(kind: EntranceKind, text: string, fps: number, options: { options?: number; rtl?: boolean } = {}): number {
  const unit = splitFor(kind, text, options.rtl ?? false);
  const parts = unit === 'char' ? letterCount(text) : wordCount(text);
  switch (kind) {
    case 'rise':
      return ENTRANCE.rise.sec;
    case 'words':
      return ENTRANCE.words.eachSec + ENTRANCE.words.staggerSec * (wordCount(text) - 1);
    case 'letters':
      return unit === 'char'
        ? ENTRANCE.letters.eachSec + (ENTRANCE.letters.staggerFrames * (parts - 1)) / fps
        : ENTRANCE.words.eachSec + ENTRANCE.words.staggerSec * (parts - 1);
    case 'ink':
      return ENTRANCE.ink.eachSec + ENTRANCE.ink.staggerSec * (wordCount(text) - 1);
    case 'type':
      return letterCount(text) / ENTRANCE.type.charsPerSec;
    case 'slot':
      return ENTRANCE.slot.perOptionSec * Math.max(1, options.options ?? ENTRANCE.slot.defaultOptions);
    case 'count':
      return ENTRANCE.count.countSec + ENTRANCE.count.stampSec;
    case 'mask':
      return ENTRANCE.mask.sec;
    case 'zoom':
      return ENTRANCE.zoom.sec;
    case 'scatter':
      return ENTRANCE.scatter.sec;
    case 'stroke':
      return ENTRANCE.stroke.sec;
  }
}

export const exitDuration = (kind: ExitKind) => EXIT[kind].sec;

export interface CountFormat {
  prefix: string;
  suffix: string;
  value: number;
  decimals: number;
  grouping: boolean;
}

/** The number inside a count line ("$1,250+", "92%", "3.5x"). */
export function parseCount(text: string): CountFormat | null {
  const match = text.match(/^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s);
  if (!match) return null;
  const digits = match[2] ?? '0';
  const decimals = digits.includes('.') ? (digits.split('.')[1] ?? '').length : 0;
  return { prefix: match[1] ?? '', suffix: match[3] ?? '', value: Number(digits.replace(/,/g, '')), decimals, grouping: digits.includes(',') };
}

export function formatCount(format: CountFormat, value: number): string {
  const fixed = value.toFixed(format.decimals);
  const [whole = '0', fraction] = fixed.split('.');
  const grouped = format.grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${format.prefix}${grouped}${fraction !== undefined ? `.${fraction}` : ''}${format.suffix}`;
}

/** Small seeded generator (mulberry32) for scatter positions and slot options. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** CSS the line structure needs; the runtime injects it and builders may inline it. */
export const LINE_CSS = `
.mf-line { position: relative; }
.mf-line > .mf-clip { display: inline-block; vertical-align: top; padding: 0.25em 0.12em 0.42em; margin: -0.25em -0.12em -0.42em; overflow: visible; max-width: calc(100% + 0.24em); }
.mf-line .mf-body { display: inline-block; }
.mf-line .mf-word, .mf-line .mf-char { display: inline-block; white-space: pre; }
.mf-line .mf-slot { display: inline-block; vertical-align: top; overflow: hidden; height: 1.2em; line-height: 1.2em; }
.mf-line .mf-slot > span, .mf-line .mf-slot > span > span { display: block; white-space: nowrap; }
.mf-line .mf-caret { display: inline-block; width: 0.07em; height: 0.95em; margin-inline-start: 0.06em; vertical-align: -0.1em; background: currentColor; }
`.trim();

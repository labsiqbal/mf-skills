// The rubric (rubric.md) as versioned data: six axes with one question and
// score anchors each, the measured caps the gate applies before the judge's
// score counts, and the targets. The judge-facing Markdown is generated from
// it (assets/rubric/rubric-<version>.md). Any wording change bumps `version`.
import { createHash } from 'node:crypto';
import { NUMBERS } from '../kit/numbers';

export const AXES = ['hook', 'brand', 'motion', 'legibility', 'rhythm', 'finish'] as const;
export type Axis = (typeof AXES)[number];

export interface Anchor {
  /** "10" or a band such as "5-6". */
  score: string;
  anchor: string;
}

export interface Cap {
  /** The measured defect, as rubric.md words it (inline code without backticks). */
  defect: string;
  axis: Axis;
  cap: number;
}

export interface Rubric {
  version: string;
  axes: readonly Axis[];
  /** How the judge scores (rubric.md, Rubric and Axes and anchors). */
  scale: string;
  questions: Record<Axis, string>;
  anchors: Record<Axis, Anchor[]>;
  /** Notes for moves (hook, rhythm). */
  notes: Partial<Record<Axis, string>>;
  caps: Cap[];
  /** The fix-line rule the judge follows for every axis under the target. */
  fixLines: string;
  target: { runtime: number; library: number };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export const RUBRIC: Rubric = deepFreeze({
  version: '1.0.0',
  axes: AXES,
  scale:
    'Six axes, scored as integers 1-10 by a judge who sees only the packet. Each axis has one question. The judge scores against the anchors; a score between two anchors means "better than the lower, not yet the higher".',
  questions: {
    hook: 'In the first second, does a viewer see something worth watching that belongs to this brand?',
    brand: "Would the brand's own designer recognise this as theirs?",
    motion: 'Does every movement have intent, weight and a clear cause?',
    legibility: 'Can every word be read once, comfortably, on a phone?',
    rhythm: 'Does the cut, motion and sound pattern feel deliberate, with no dead air?',
    finish: 'Does it look and sound finished, with nothing a professional would fix?',
  },
  anchors: {
    hook: [
      { score: '10', anchor: 'Frame 0 already shows the product, a result or a bold line; by 1 s the viewer knows what this is and wants the next beat.' },
      { score: '9', anchor: 'Strong opening image by 0.3 s and a clear promise by 1 s; one small hesitation.' },
      { score: '8', anchor: 'Content by 0.5 s, purpose clear by 1.5 s.' },
      { score: '7', anchor: 'Opens on a generic title or logo but moves to content within 1.5 s.' },
      { score: '5-6', anchor: 'A title fading over brand colour; purpose clear only after 2 s.' },
      { score: '3-4', anchor: 'Empty, black or logo-only opening longer than 1 s.' },
      { score: '1-2', anchor: 'Nothing readable or nothing happening in the first 2 s.' },
    ],
    brand: [
      { score: '10', anchor: "Real brand material (logo, real screens, real copy voice) used with the brand's own palette roles and type; nothing generic." },
      { score: '9', anchor: 'Palette roles and type exact; real material present; one element feels borrowed from a template.' },
      { score: '8', anchor: 'Correct colours and fonts; real material present but secondary.' },
      { score: '7', anchor: 'Correct colours; generic shapes and stock-like layouts dominate.' },
      { score: '5-6', anchor: 'Colours roughly right, type wrong, no real material.' },
      { score: '3-4', anchor: 'Could be any brand.' },
      { score: '1-2', anchor: 'Conflicts with the brand (wrong colours, misused logo).' },
    ],
    motion: [
      { score: '10', anchor: 'Arrivals land with weight, exits are faster than entrances, overlaps are tuned, camera moves are motivated, nothing floats.' },
      { score: '9', anchor: 'All of the above with one slightly generic ease or stagger.' },
      { score: '8', anchor: 'Purposeful and varied; a few moves feel mechanical.' },
      { score: '7', anchor: 'One ease and one timing used everywhere; competent but uniform.' },
      { score: '5-6', anchor: 'Fade-and-slide on everything; idle loops or creeping scales.' },
      { score: '3-4', anchor: 'Jittery, abrupt or random movement.' },
      { score: '1-2', anchor: 'Motion that obstructs reading or looks broken.' },
    ],
    legibility: [
      { score: '10', anchor: 'Every line holds long enough, sized for the phone sheet, high contrast, never competing with another line.' },
      { score: '9', anchor: 'One line slightly fast or small, still readable.' },
      { score: '8', anchor: 'All readable; one or two need a second look.' },
      { score: '7', anchor: 'Readable on desktop, strained on the phone sheet.' },
      { score: '5-6', anchor: 'Some lines too fast, small or low-contrast to read once.' },
      { score: '3-4', anchor: 'Several lines unreadable.' },
      { score: '1-2', anchor: 'Most copy unreadable.' },
    ],
    rhythm: [
      { score: '10', anchor: 'Something new on every beat, layout changes on the bar, holds only where meaning needs them, sound hits land on picture.' },
      { score: '9', anchor: 'Same, with one beat that drags or rushes.' },
      { score: '8', anchor: 'Even pacing; a few soft spots.' },
      { score: '7', anchor: 'Pacing follows a grid mechanically; no variation in energy.' },
      { score: '5-6', anchor: 'Noticeable dead stretches or crowded bursts.' },
      { score: '3-4', anchor: 'Long still stretches; cuts unrelated to the beat.' },
      { score: '1-2', anchor: 'No discernible rhythm.' },
    ],
    finish: [
      { score: '10', anchor: 'Clean edges, consistent spacing and radii, no banding, no clipping, correct alpha edges, mixed loudness on target.' },
      { score: '9', anchor: 'One minor craft flaw visible only on close inspection.' },
      { score: '8', anchor: 'Two or three minor flaws.' },
      { score: '7', anchor: 'A flaw visible at normal viewing (misalignment, banding, harsh shadow).' },
      { score: '5-6', anchor: 'Several visible flaws.' },
      { score: '3-4', anchor: 'Looks like a draft.' },
      { score: '1-2', anchor: 'Broken output.' },
    ],
  },
  notes: {
    hook: `For moves: "first second" means the first 0.5 s of the move's own clock; overlays are judged on how quickly the idea reads once ink appears.`,
    rhythm: "For silent moves, rhythm judges motion cadence against the move's own timing.",
  },
  caps: [
    { defect: 'Frame 0 ink under frame0.inkMin', axis: 'hook', cap: 5 },
    { defect: 'Longest still stretch over its limit', axis: 'rhythm', cap: 6 },
    { defect: 'Contrast between contrast.hardMin and contrast.textMin', axis: 'legibility', cap: 6 },
    { defect: 'Measured text below type.minReadablePx', axis: 'legibility', cap: 6 },
    { defect: 'Reading hold short on any line', axis: 'legibility', cap: 7 },
    { defect: 'Text in the face band (overlay with avoidFace)', axis: 'finish', cap: 6 },
    { defect: 'Engine check warnings, 3 or more', axis: 'finish', cap: 8 },
    { defect: 'Loudness outside audio.lufsTolerance', axis: 'finish', cap: 7 },
    { defect: 'Bed low-end share over bed.lowShareMax', axis: 'finish', cap: 8 },
    { defect: 'SFX peak off by more than sfx.peakToleranceFrames', axis: 'rhythm', cap: 7 },
    { defect: 'SFX rise under the minimum', axis: 'rhythm', cap: 8 },
  ],
  fixLines:
    'Any axis whose judge score is under the active target carries at least one fix: `{ at, where, problem, change }`, each one sentence, `change` stating an exact edit (a number, an element, a timing), never an adjective. Example: `{ "at": "4.20-5.00", "where": "headline in shot 3", "problem": "holds 0.6 s for 6 words", "change": "extend the hold to 2.3 s by moving the exit from bar4 to bar5" }`.',
  target: { runtime: NUMBERS['rubric.target.runtime'], library: NUMBERS['rubric.target.library'] },
});

/** The "Measured caps" table as rubric.md lays it out (mirrored by test/spec/rubric.json). */
export function capsTable(): Array<Record<'Measured defect' | 'Axis' | 'Cap', string>> {
  return RUBRIC.caps.map((cap) => ({ 'Measured defect': cap.defect, Axis: cap.axis, Cap: String(cap.cap) }));
}

/** sha256 of every judge-facing word and every cap; a different hash needs a new version. */
export function rubricHash(rubric: Rubric = RUBRIC): string {
  const text = JSON.stringify({
    scale: rubric.scale,
    axes: rubric.axes,
    questions: rubric.axes.map((axis) => rubric.questions[axis]),
    anchors: rubric.axes.map((axis) => rubric.anchors[axis].map((anchor) => [anchor.score, anchor.anchor])),
    notes: rubric.axes.map((axis) => rubric.notes[axis] ?? null),
    caps: rubric.caps.map((cap) => [cap.defect, cap.axis, cap.cap]),
    fixLines: rubric.fixLines,
  });
  return createHash('sha256').update(text).digest('hex');
}

/** The judge-facing rubric (assets/rubric/rubric-<version>.md). */
export function rubricMarkdown(rubric: Rubric = RUBRIC): string {
  const lines = [
    `# Rubric ${rubric.version}`,
    '',
    rubric.scale,
    '',
    `Targets: ${rubric.target.runtime} on every axis at runtime; ${rubric.target.library} on every axis, aspect and mode for the library.`,
    '',
  ];
  for (const axis of rubric.axes) {
    lines.push(`## ${axis}`, '', `Question: ${rubric.questions[axis]}`, '', '| Score | Anchor |', '|---|---|');
    for (const anchor of rubric.anchors[axis]) lines.push(`| ${anchor.score} | ${anchor.anchor} |`);
    const note = rubric.notes[axis];
    if (note) lines.push('', note);
    lines.push('');
  }
  lines.push('## Fix lines', '', rubric.fixLines, '');
  return lines.join('\n');
}

/** The parts of metrics.json the caps read. */
export interface CapMetrics {
  fps: string;
  frame0Ink: number | null;
  stills: Array<{ fromSec: number; toSec: number; lenSec: number; exempt: 'end-card' | 'hold' | null }>;
  contrast: Array<{ atSec: number; elementId: string; ratio: number }>;
  audit: { hits: Array<{ fromSec: number; elementId: string; problem: string }> };
  lines: Array<{ elementId: string; holdSec: number; words: number; ok: boolean }>;
  audio: { lufs: number; lowShare: number; sfx: Array<{ event: string; atSec: number; peakOffsetMs: number; riseDb: number }> } | null;
  engineCheck: { warnings: number };
}

export interface AppliedCap {
  axis: Axis;
  cap: number;
  because: string;
}

const fpsOf = (fps: string) => {
  const [num = 30, den = 1] = fps.split('/').map(Number);
  return num / den;
};
const fmt = (value: number) => String(Math.round(value * 1000) / 1000);

/** The caps a measurement triggers, one entry per defect found (the gate takes the minimum per axis). */
export function capFor(metrics: CapMetrics, rubric: Rubric = RUBRIC): AppliedCap[] {
  const capOf = (index: number) => rubric.caps[index] as Cap;
  const out: AppliedCap[] = [];
  const add = (index: number, because: string) => out.push({ axis: capOf(index).axis, cap: capOf(index).cap, because: `${capOf(index).defect}: ${because}` });

  const inkMin = NUMBERS['frame0.inkMin'].share;
  if (metrics.frame0Ink !== null && metrics.frame0Ink < inkMin) add(0, `frame 0 ink ${fmt(metrics.frame0Ink)} < ${inkMin}`);

  const limitFor = (exempt: 'end-card' | 'hold' | null) =>
    exempt === 'end-card' ? NUMBERS['still.endCardMaxSec'] : exempt === 'hold' ? NUMBERS['still.overlayHoldMaxSec'] : NUMBERS['still.maxSec'];
  const over = metrics.stills.filter((still) => still.lenSec > limitFor(still.exempt)).sort((a, b) => b.lenSec - a.lenSec)[0];
  if (over) add(1, `${fmt(over.lenSec)} s still at ${fmt(over.fromSec)}-${fmt(over.toSec)} s (limit ${limitFor(over.exempt)} s)`);

  const low = metrics.contrast.filter((entry) => entry.ratio >= NUMBERS['contrast.hardMin'] && entry.ratio < NUMBERS['contrast.textMin']).sort((a, b) => a.ratio - b.ratio)[0];
  if (low) add(2, `${low.elementId} at ${fmt(low.atSec)} s is ${fmt(low.ratio)}:1`);

  const small = metrics.audit.hits.find((hit) => hit.problem === 'min-size');
  if (small) add(3, `${small.elementId} at ${fmt(small.fromSec)} s`);

  const short = metrics.lines.find((line) => !line.ok);
  if (short) add(4, `${short.elementId} holds ${fmt(short.holdSec)} s for ${short.words} word(s)`);

  const face = metrics.audit.hits.find((hit) => hit.problem === 'face-band');
  if (face) add(5, `${face.elementId} at ${fmt(face.fromSec)} s`);

  if (metrics.engineCheck.warnings >= 3) add(6, `${metrics.engineCheck.warnings} warnings`);

  if (metrics.audio) {
    const { lufs, lowShare, sfx } = metrics.audio;
    if (Math.abs(lufs - NUMBERS['audio.lufsTarget']) > NUMBERS['audio.lufsTolerance']) add(7, `${fmt(lufs)} LUFS (target ${NUMBERS['audio.lufsTarget']} +-${NUMBERS['audio.lufsTolerance']})`);
    if (lowShare > NUMBERS['bed.lowShareMax'].share) add(8, `${fmt(lowShare)} of bed energy below ${NUMBERS['bed.lowShareMax'].belowHz} Hz`);
    const frameMs = 1000 / fpsOf(metrics.fps);
    const idealMs = NUMBERS['sfx.peakOffsetFrames'] * frameMs;
    const toleranceMs = NUMBERS['sfx.peakToleranceFrames'] * frameMs;
    const offPeak = sfx.find((entry) => Math.abs(entry.peakOffsetMs - idealMs) > toleranceMs);
    if (offPeak) add(9, `${offPeak.event} at ${fmt(offPeak.atSec)} s peaks ${fmt(offPeak.peakOffsetMs)} ms after the picture (aim ${fmt(idealMs)} +-${fmt(toleranceMs)} ms)`);
    const flat = sfx.find((entry) => entry.riseDb < NUMBERS['sfx.riseDb'].min);
    if (flat) add(10, `${flat.event} at ${fmt(flat.atSec)} s rises ${fmt(flat.riseDb)} dB (minimum ${NUMBERS['sfx.riseDb'].min})`);
  }
  return out;
}

// The four check profiles (check-profiles.md): which checks apply to a film,
// a broll move, an alpha overlay and a keyed overlay, and how. A profile never
// holds a threshold; values stay in NUMBERS under the keys each check names.
import { PROFILES as PROFILE_NAMES } from '../schemas/shared';

export type Profile = (typeof PROFILE_NAMES)[number];
export const PROFILE_LIST = PROFILE_NAMES;

export const CHECK_IDS = [
  'lint', 'engine-errors', 'engine-warnings', 'frame-margin', 'copy-safe', 'caption-band', 'face-band', 'line-in-out',
  'reading-hold', 'min-size', 'contrast-hard', 'contrast-soft', 'frame0-ink', 'overlay-empty', 'still', 'duration',
  'timestamps', 'key-purity', 'loudness', 'true-peak', 'sfx-timing', 'sfx-rise', 'low-share', 'brand-pieces',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type CheckMode = 'hard' | 'cap' | 'off';
export type CheckWhen = 'audio' | 'captions' | 'avoidFace';

export interface CheckRule {
  mode: CheckMode;
  when?: CheckWhen;
  /** How the check is measured for this profile (the matrix's parenthesis). */
  note?: string;
}

export type ProfileSpec = Record<CheckId, CheckRule>;

/** The check's row label and the numbers keys it reads, as the matrix words them. */
export const CHECKS: Record<CheckId, { label: string; keys: string }> = {
  lint: { label: 'Lint errors ([lint.md](lint.md))', keys: '-' },
  'engine-errors': { label: 'Engine check errors', keys: '-' },
  'engine-warnings': { label: 'Engine check warnings (3 or more)', keys: '-' },
  'frame-margin': { label: 'Frame margin, spill, text overlap', keys: 'safe.frameMarginPx, audit.*' },
  'copy-safe': { label: 'Copy outside copy-safe box', keys: 'safe.copy.*' },
  'caption-band': { label: 'Text in caption band', keys: 'safe.captionBand' },
  'face-band': { label: 'Text in face band', keys: 'safe.faceBand' },
  'line-in-out': { label: 'Entrance and exit on every line', keys: 'TXT001-TXT004' },
  'reading-hold': { label: 'Reading hold per line', keys: 'read.*' },
  'min-size': { label: 'Text below minimum size (measured)', keys: 'type.minReadablePx' },
  'contrast-hard': { label: 'Contrast under 3.0:1', keys: 'contrast.hardMin' },
  'contrast-soft': { label: 'Contrast 3.0-4.5:1', keys: 'contrast.textMin' },
  'frame0-ink': { label: 'Frame 0 ink', keys: 'frame0.inkMin' },
  'overlay-empty': { label: 'Overlay starts and ends empty, first ink time', keys: 'overlay.*' },
  still: { label: 'Longest still stretch', keys: 'still.*' },
  duration: { label: 'Duration equals plan', keys: 'duration.toleranceFrames' },
  timestamps: { label: 'Timestamps regular', keys: 'timestamps.maxJitterMs' },
  'key-purity': { label: 'Key colour purity', keys: 'key.*' },
  loudness: { label: 'Integrated loudness', keys: 'audio.lufsTarget, audio.lufsTolerance' },
  'true-peak': { label: 'True peak', keys: 'audio.truePeakMax' },
  'sfx-timing': { label: 'SFX peak timing', keys: 'sfx.peakToleranceFrames' },
  'sfx-rise': { label: 'SFX rise over bed', keys: 'sfx.riseDb' },
  'low-share': { label: 'Bed low-end share', keys: 'bed.lowShareMax' },
  'brand-pieces': { label: 'Brand pieces (logo and real shots)', keys: 'brand.film.minRealPieces' },
};

const H: CheckRule = { mode: 'hard' };
const C: CheckRule = { mode: 'cap' };
const OFF: CheckRule = { mode: 'off' };

/** One row per check: film, broll, overlay-alpha, overlay-key. */
const MATRIX: Record<CheckId, [CheckRule, CheckRule, CheckRule, CheckRule]> = {
  lint: [H, H, H, H],
  'engine-errors': [H, H, H, H],
  'engine-warnings': [C, C, C, C],
  'frame-margin': [H, H, H, H],
  'copy-safe': [H, H, H, H],
  'caption-band': [{ mode: 'hard', when: 'captions' }, OFF, H, H],
  'face-band': [OFF, OFF, { mode: 'cap', when: 'avoidFace' }, { mode: 'cap', when: 'avoidFace' }],
  'line-in-out': [H, H, H, H],
  'reading-hold': [C, C, C, C],
  'min-size': [C, C, C, C],
  'contrast-hard': [H, H, { mode: 'hard', note: 'worst plate' }, H],
  'contrast-soft': [C, C, { mode: 'cap', note: 'worst plate' }, C],
  'frame0-ink': [C, C, OFF, OFF],
  'overlay-empty': [OFF, OFF, H, { mode: 'hard', note: 'key-coloured pixels count as empty' }],
  still: [
    { mode: 'cap', note: 'end card exempt to still.endCardMaxSec' },
    C,
    { mode: 'cap', note: 'declared holds exempt to still.overlayHoldMaxSec' },
    { mode: 'cap', note: 'same' },
  ],
  duration: [H, H, H, H],
  timestamps: [H, H, H, H],
  'key-purity': [OFF, OFF, OFF, H],
  loudness: [{ mode: 'cap', when: 'audio' }, OFF, OFF, OFF],
  'true-peak': [{ mode: 'hard', when: 'audio' }, OFF, OFF, OFF],
  'sfx-timing': [{ mode: 'cap', when: 'audio' }, OFF, OFF, OFF],
  'sfx-rise': [{ mode: 'cap', when: 'audio' }, OFF, OFF, OFF],
  'low-share': [{ mode: 'cap', when: 'audio' }, OFF, OFF, OFF],
  'brand-pieces': [{ mode: 'hard', note: 'lint STR004' }, OFF, OFF, OFF],
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const profile = (index: number): ProfileSpec => Object.fromEntries(CHECK_IDS.map((id) => [id, MATRIX[id][index] as CheckRule])) as ProfileSpec;

export const PROFILES: Record<Profile, ProfileSpec> = deepFreeze({
  film: profile(0),
  broll: profile(1),
  'overlay-alpha': profile(2),
  'overlay-key': profile(3),
});

export interface ApplyContext {
  /** The delivered file has an audio stream. */
  hasAudio?: boolean;
  /** The brief sets captions (films). */
  captions?: boolean;
  /** Overlays avoid the face band; default true. */
  avoidFace?: boolean;
}

/** How a check applies to this output: its mode once its condition is known. */
export function modeOf(profile: Profile, check: CheckId, context: ApplyContext = {}): CheckMode {
  const rule = PROFILES[profile][check];
  if (rule.mode === 'off') return 'off';
  const met =
    rule.when === undefined ||
    (rule.when === 'audio' && context.hasAudio === true) ||
    (rule.when === 'captions' && context.captions === true) ||
    (rule.when === 'avoidFace' && context.avoidFace !== false);
  return met ? rule.mode : 'off';
}

export function applies(profile: Profile, check: CheckId, context: ApplyContext = {}): boolean {
  return modeOf(profile, check, context) !== 'off';
}

const LETTER: Record<CheckMode, string> = { hard: 'H', cap: 'C', off: '-' };
const COLUMNS: Array<[Profile, string]> = [
  ['film', 'film'],
  ['broll', 'broll'],
  ['overlay-alpha', 'overlay-alpha'],
  ['overlay-key', 'overlay-key'],
];

/** PROFILES as the check-matrix table reads (mirrored by test/spec/check-matrix.json). */
export function checkMatrix(): Array<Record<string, string>> {
  return CHECK_IDS.map((id) => ({
    Check: CHECKS[id].label,
    'Key values': CHECKS[id].keys,
    ...Object.fromEntries(
      COLUMNS.map(([name, column]) => {
        const rule = PROFILES[name][id];
        return [column, `${LETTER[rule.mode]}${rule.when ? ` when ${rule.when}` : ''}${rule.note ? ` (${rule.note})` : ''}`];
      }),
    ),
  }));
}

// The numbers table (safe-zones-and-numbers.md sections 1-13) as one frozen
// object keyed exactly by the doc's keys. Values keep the doc's units (seconds,
// milliseconds, pixels at the aspect's base resolution); shares written as
// percentages in the doc are fractions here. test/unit/kit/numbers checks every
// key and every number against the doc tables.

export const ASPECT_KEYS = ['16:9', '9:16', '1:1'] as const;
export type AspectKey = (typeof ASPECT_KEYS)[number];

export interface Range {
  min: number;
  max: number;
}

export interface Band {
  y0: number;
  y1: number;
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type PerAspect<T> = Record<AspectKey, T>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const numbers = {
  // 1. Formats and time
  'fps.film': 30,
  'fps.move.default': 30,
  'fps.move.footageRates': ['24000/1001', '24', '25', '30000/1001', '30', '50', '60000/1001', '60'],
  'aspect.16:9': { width: 1920, height: 1080 },
  'aspect.9:16': { width: 1080, height: 1920 },
  'aspect.1:1': { width: 1080, height: 1080 },
  /** u = min(W, H) / base. */
  'unit.u': { base: 1080 },
  'film.lengthSec': { min: 10, max: 30, default: 20 },
  'film.lengthToleranceSec': 1.5,
  'film.gridRangeSec': { min: 9.5, max: 31.0 },
  'film.tailSec': { default: 0.8, min: 0.0, max: 2.0 },
  'grid.bpm': { min: 60, max: 180 },
  'grid.beatsPerBar': [3, 4],
  'grid.defaultSeed': 1,
  'move.durationSec': { min: 1.5, max: 6.0 },
  'time.snap': 'nearest-frame-round-half-up',

  // 2. Safe zones (pixels at the aspect's base resolution)
  'safe.frameMarginPx': { '16:9': 24, '9:16': 40, '1:1': 24 } as PerAspect<number>,
  'safe.copy.leftPx': { '16:9': 115, '9:16': 70, '1:1': 76 } as PerAspect<number>,
  'safe.copy.rightPx': { '16:9': 115, '9:16': 190, '1:1': 76 } as PerAspect<number>,
  'safe.copy.topPx': { '16:9': 86, '9:16': 210, '1:1': 76 } as PerAspect<number>,
  'safe.copy.bottomPx': { '16:9': 108, '9:16': 600, '1:1': 97 } as PerAspect<number>,
  'safe.captionBand': { '16:9': { y0: 864, y1: 1000 }, '9:16': { y0: 1150, y1: 1320 }, '1:1': { y0: 830, y1: 990 } } as PerAspect<Band>,
  'safe.faceBand': {
    '16:9': { x0: 576, x1: 1344, y0: 108, y1: 864 },
    '9:16': { x0: 162, x1: 918, y0: 422, y1: 1114 },
    '1:1': { x0: 270, x1: 810, y0: 130, y1: 810 },
  } as PerAspect<Box>,

  // 3. Text audit
  'audit.stepSec': 0.1,
  'audit.ignoreOpacityBelow': 0.35,
  'audit.movingExemptPxPerStep': 6,
  'audit.overlapShrinkY': 0.2,
  'audit.spillTolerancePx': 2,

  // 4. Type
  'type.minReadablePx': { shortSideShare: 0.026, atBasePx: 28 },
  'type.titleHeightShare': { min: 0.04, max: 0.09 },
  'type.heroHeightShare': { min: 0.09, max: 0.21 },
  'type.verticalTitleScale': 1.35,
  'type.maxWordsPerLine.9:16': 5,
  'type.squareOverlayMinLineChars': 16,
  'type.trackingFloorEm': -0.025,
  'type.clipFloorEm': 0.42,
  'type.splitComplexScripts': { scripts: ['Arabic', 'Hebrew', 'Devanagari', 'Bengali', 'Thai'], split: ['word', 'line'] },

  // 5. Reading and motion timing
  'read.holdSec': { base: 0.5, perWord: 0.3 },
  'read.lastLineMinSec': 2.0,
  'read.accentWordMinSec': { sec: 0.4, maxWords: 2 },
  'motion.arriveSec': { min: 0.45, max: 0.9, eases: ['expo.out', 'power4.out'] },
  'motion.exitSec': { min: 0.2, max: 0.35, ease: 'power3.in', entranceShare: { min: 0.4, max: 0.5 } },
  'motion.cameraSec': { typical: 0.6, ease: 'power2.inOut' },
  'motion.stagger.lettersFrames': 1,
  'motion.stagger.wordsMs': { min: 60, max: 120 },
  'motion.stagger.itemsMs': { min: 40, max: 80 },
  'motion.overlapStart': { min: 0.3, max: 0.5 },
  'motion.secondaryTravel': { travel: { min: 0.5, max: 0.7 }, delayMs: { min: 100, max: 200 } },
  'motion.transitionsPerFilm': { kinds: { min: 3, max: 5 }, hardCutShareMax: 1 / 3 },
  'motion.perspectivePx': 1600,
  'motion.arriveFromZPx': -900,
  'motion.dofBlurPx': { blur: { min: 7, max: 10 }, opacity: { min: 0.35, max: 0.55 } },
  'motion.diveScale': { min: 2.6, max: 3.4, ease: 'power3.in' },
  'motion.pushInScale': 1.7,
  'motion.springs': { ease: 'back.out', overshoot: { min: 1.4, max: 2.0 } },
  'motion.onTwosFps': 12,
  'endCard.markScaleFrom': { from: 1.6, to: 1.0 },
  'endCard.holdSec': { min: 2.0, max: 3.5 },
  'overlay.exitWindowSec': { min: 0.3, max: 0.45 },
  'overlay.firstInkSec': 0.3,

  // 6. Measured checks
  'still.sampleFps': 10,
  'still.downscalePx': 160,
  'still.pixelDelta': 6,
  'still.frameThreshold': 0.004,
  'still.maxSec': 2.0,
  'still.endCardMaxSec': 3.5,
  'still.overlayHoldMaxSec': 4.0,
  'frame0.inkMin': { share: 0.03, levelDelta: 24 },
  'overlay.emptyCoverageMax': 0.005,
  'contrast.textMin': 4.5,
  'contrast.hardMin': 3.0,
  'timestamps.maxJitterMs': 1,
  'duration.toleranceFrames': 1,
  'key.minHueDistanceDeg': { deg: 60, saturation: 1.0, value: 0.85 },
  'key.purityLevels': 2,

  // 7. Sound
  'audio.sampleRate': 48000,
  'audio.lufsTarget': -14.0,
  'audio.lufsTolerance': 1.0,
  'audio.truePeakMax': -1.0,
  'audio.loudnorm': { passes: 2, I: -14, TP: -1, LRA: 11, linear: true, sampleRate: 48000 },
  'sfx.peakOffsetFrames': 0.5,
  'sfx.peakToleranceFrames': 1,
  'sfx.riseDb': { target: 5, hit: 10, min: 3, max: 14, flagUnder: 3 },
  'sfx.bedBandHz': { min: 300, max: 4000 },
  'sfx.ownWindowMs': 70,
  'sfx.sharpBodyMs': { min: 30, max: 60, withinDb: 12 },
  'sfx.crestMaxDb': { click: 12, tick: 12, type: 12, hit: 7, windowMs: 40 },
  'mix.kickDuckMax': 0.55,
  'mix.preHitDip': { level: 0.15, sec: 0.3 },
  'mix.endFadeSec': 0.25,
  'mix.voiceDuckDb': -8,
  'bed.lowShareMax': { share: 0.55, belowHz: 150 },
  /** "always": the pad plays from energy 0. */
  'energy.pad': 0,
  'energy.hats': { from: 0.3, sixteenthsFrom: 0.75 },
  'energy.bass': 0.4,
  'energy.kick': { from: 0.45, fourOnTheFloorFrom: 0.7 },
  'energy.pluck': 0.55,
  'energy.clap': 0.7,
  'sfx.roles': { roles: ['click', 'tick', 'type', 'pop', 'whoosh', 'hit', 'shimmer', 'riser'], hitMaxPerFilm: 1 },

  // 9. Planning and placement
  'interview.maxQuestions': 5,
  'brand.shots': { min: 3, max: 6 },
  'brand.candidateMinPx': { width: 800, height: 400 },
  'brand.paletteMax': 12,
  'brand.film.minRealPieces': 3,
  'placement.minStartGapSec': 4.0,
  'placement.minClearGapSec': 0.5,
  'placement.sayWindowSec': 1.5,
  'placement.sayMatchMin': 0.8,
  'catalogue.candidates': { min: 4, max: 6 },
  'catalogue.indexTokens': 1000,
  'catalogue.categoryTokens': 1500,
  'critique.maxRounds': 3,

  // 10. Colour roles
  'role.ink.contrastMin': 4.5,
  'role.accent.saturationMin': 0.35,
  'role.accent.luminance': { min: 0.04, max: 0.85 },
  'role.surface.deltaLuminance': { min: 0.005, max: 0.12 },
  'role.muted.saturationMax': 0.2,
  'role.muted.contrast': { min: 2.2, max: 6.0 },

  // 11. Reference reading
  'ref.maxHeight': 720,
  'ref.frameEverySec': { sec: 0.5, widthPx: 480 },
  'ref.cutSceneScore': 0.32,
  'ref.paletteClusters': { clusters: 8, mergeDistance: 28 },
  'ref.motionEnergyFps': 10,
  'ref.stripFps': { fps: 4, fastFps: 8, framesPerStrip: 24 },
  'ref.cutToleranceFrames': 1,

  // 12. Quality targets
  'rubric.axes': ['hook', 'brand', 'motion', 'legibility', 'rhythm', 'finish'],
  'rubric.target.runtime': 8,
  'rubric.target.library': 9,
  'lab.driftMax': 0.5,
  'lab.driftEveryUnits': 50,
  'lab.roundsPerAttempt': 5,
  'lab.noGainStop': 2,
  'lab.redesigns': 1,
  'lab.qualifyingGain': { meanRiseMin: 0.2 },

  // 13. Previews and budgets
  'preview.longEdgePx': 480,
  'preview.codec': { codec: 'vp9', container: 'webm', fps: 30, audio: false },
  'preview.maxKb': { move: 350, theme: 600 },
  'gallery.maxMb': 200,
  'disk.doctorWarnGb': 5,
  'disk.doctorFailGb': 2,
} as const;

export type Numbers = typeof numbers;
export type NumberKey = keyof Numbers;

/** The numbers table, frozen all the way down. */
export const NUMBERS: Numbers = deepFreeze(numbers);

/** The keys in doc order (mirrored by test/spec/numbers.json). */
export function numberKeys(): NumberKey[] {
  return Object.keys(NUMBERS) as NumberKey[];
}

/** Base frame size of an aspect. */
export function aspectSize(aspect: AspectKey): { width: number; height: number } {
  return NUMBERS[`aspect.${aspect}`];
}

import type { GenrePreset } from './types';

export const warmHouse: GenrePreset = {
  id: 'warm-house',
  character: 'soft kick, chord stabs, warm pad',
  bpm: { min: 112, max: 122 },
  meters: [4],
  keys: [{ key: 'E-flat major', weight: 3 }, { key: 'B-flat major', weight: 2 }],
  progressions: [['ii', 'V', 'I', 'vi'], ['I', 'vi', 'ii', 'V'], ['IV', 'V', 'iii', 'vi']],
  sevenths: true,
  roles: {
    pad: { wave: 'triangle', cutoff: 1500, detuneCents: 6, gain: 0.06, octave: 4, attack: 0.5 },
    bass: { wave: 'sine', cutoff: 400, gain: 0.234, octave: 2, pattern: 'offbeat' },
    pluck: { kind: 'fm', gain: 0.12, octave: 4, pattern: 'stabs', brightness: 0.4, ratio: 2 },
    lead: null,
  },
  drums: { kick: 0.585, snare: 0.0, clap: 0.24, hat: 0.09, fourOnFloor: true, halfTime: false, swing: 0.08, kickFromDrop: false },
  voicing: { spread: 'open' },
  fills: ['hat-burst', 'drop-out', 'snare-roll'],
  sfx: { hit: 'clap-stack', shimmer: 'bell', whoosh: 'filtered' },
  reverb: { send: 0.38, room: 0.8, damp: 0.45 },
  width: 1.2,
  master: 0.4,
};

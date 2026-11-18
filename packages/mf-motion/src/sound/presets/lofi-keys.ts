import type { GenrePreset } from './types';

export const lofiKeys: GenrePreset = {
  id: 'lofi-keys',
  character: 'dusty keys, swing hats, mellow bass',
  bpm: { min: 80, max: 92 },
  meters: [4],
  keys: [{ key: 'D major', weight: 3 }, { key: 'F major', weight: 2 }],
  progressions: [['ii', 'V', 'I', 'IV'], ['I', 'iii', 'vi', 'IV'], ['vi', 'ii', 'V', 'I'], ['IV', 'iii', 'ii', 'I']],
  sevenths: true,
  roles: {
    pad: { wave: 'triangle', cutoff: 1100, detuneCents: 12, gain: 0.083, octave: 4, attack: 0.08 },
    bass: { wave: 'sine', cutoff: 300, gain: 0.208, octave: 2, pattern: 'roots' },
    pluck: { kind: 'fm', gain: 0.131, octave: 4, pattern: 'arp8', brightness: 0.3, ratio: 1 },
    lead: null,
  },
  drums: { kick: 0.44, snare: 0.261, clap: 0.0, hat: 0.083, fourOnFloor: false, halfTime: false, swing: 0.25, kickFromDrop: false },
  voicing: { spread: 'close' },
  fills: ['drop-out', 'hat-burst'],
  sfx: { hit: 'clap-stack', shimmer: 'bell', whoosh: 'noise' },
  reverb: { send: 0.3, room: 0.7, damp: 0.6 },
  width: 0.9,
  master: 0.53,
};

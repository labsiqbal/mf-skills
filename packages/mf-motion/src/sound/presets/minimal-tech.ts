import type { GenrePreset } from './types';

export const minimalTech: GenrePreset = {
  id: 'minimal-tech',
  character: 'clicks, sub bass, sparse bell motif',
  bpm: { min: 100, max: 120 },
  meters: [4],
  keys: [{ key: 'A minor', weight: 2 }, { key: 'G minor', weight: 2 }],
  progressions: [['i', 'i', 'iv', 'i'], ['i', 'VII', 'i', 'v'], ['i', 'iv', 'i', 'VII']],
  sevenths: false,
  roles: {
    pad: { wave: 'sine', cutoff: 1200, detuneCents: 4, gain: 0.109, octave: 4, attack: 0.6 },
    bass: { wave: 'sine', cutoff: 200, gain: 0.15, octave: 1, pattern: 'roots' },
    pluck: { kind: 'fm', gain: 0.219, octave: 5, pattern: 'offbeat', brightness: 0.5, ratio: 3.5 },
    lead: null,
  },
  drums: { kick: 0.375, snare: 0.0, clap: 0.35, hat: 0.175, fourOnFloor: true, halfTime: false, swing: 0.05, kickFromDrop: false },
  voicing: { spread: 'close' },
  fills: ['hat-burst', 'drop-out'],
  sfx: { hit: 'boom', shimmer: 'bell', whoosh: 'filtered' },
  reverb: { send: 0.25, room: 0.7, damp: 0.5 },
  width: 1.1,
  master: 0.37,
};

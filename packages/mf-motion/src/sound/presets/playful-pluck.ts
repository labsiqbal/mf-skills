import type { GenrePreset } from './types';

export const playfulPluck: GenrePreset = {
  id: 'playful-pluck',
  character: 'bouncy plucks, claps, marimba-like FM',
  bpm: { min: 100, max: 112 },
  meters: [4, 3],
  keys: [{ key: 'C major', weight: 3 }, { key: 'G major', weight: 2 }],
  progressions: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'V', 'I'], ['vi', 'IV', 'I', 'V'], ['I', 'iii', 'IV', 'V']],
  sevenths: false,
  roles: {
    pad: { wave: 'triangle', cutoff: 1600, detuneCents: 5, gain: 0.045, octave: 4, attack: 0.2 },
    bass: { wave: 'square', cutoff: 380, gain: 0.18, octave: 2, pattern: 'roots' },
    pluck: { kind: 'fm', gain: 0.16, octave: 5, pattern: 'arp8', brightness: 0.6, ratio: 4 },
    lead: null,
  },
  drums: { kick: 0.65, snare: 0.0, clap: 0.3, hat: 0.08, fourOnFloor: false, halfTime: false, swing: 0.12, kickFromDrop: false },
  voicing: { spread: 'close' },
  fills: ['kick-run', 'hat-burst', 'snare-roll'],
  sfx: { hit: 'clap-stack', shimmer: 'bell', whoosh: 'filtered' },
  reverb: { send: 0.25, room: 0.65, damp: 0.4 },
  width: 1.15,
  master: 0.45,
};

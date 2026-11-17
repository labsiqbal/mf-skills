import type { GenrePreset } from './types';

export const darkPulse: GenrePreset = {
  id: 'dark-pulse',
  character: 'gated bass, metallic hats, low drones',
  bpm: { min: 95, max: 110 },
  meters: [4],
  keys: [{ key: 'F-sharp minor', weight: 2 }, { key: 'C-sharp minor', weight: 2 }],
  progressions: [['i', 'i', 'VI', 'v'], ['i', 'iio', 'v', 'i'], ['i', 'VII', 'VI', 'VII']],
  sevenths: false,
  roles: {
    pad: { wave: 'saw', cutoff: 700, detuneCents: 16, gain: 0.06, octave: 3, attack: 0.8 },
    bass: { wave: 'saw', cutoff: 340, gain: 0.17, octave: 1, pattern: 'gated' },
    pluck: { kind: 'fm', gain: 0.1, octave: 4, pattern: 'offbeat', brightness: 0.5, ratio: 5.1 },
    lead: null,
  },
  drums: { kick: 0.85, snare: 0.3, clap: 0.0, hat: 0.11, fourOnFloor: true, halfTime: true, swing: 0, kickFromDrop: false },
  voicing: { spread: 'close' },
  fills: ['snare-roll', 'drop-out', 'tom-run'],
  sfx: { hit: 'boom', shimmer: 'glass', whoosh: 'filtered' },
  reverb: { send: 0.35, room: 0.85, damp: 0.3 },
  width: 1.25,
  master: 0.32,
};

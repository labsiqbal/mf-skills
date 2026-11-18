import type { GenrePreset } from './types';

export const ambientGlass: GenrePreset = {
  id: 'ambient-glass',
  character: 'slow pads, bell shimmer, no kick until the drop',
  bpm: { min: 70, max: 90 },
  meters: [4, 3],
  keys: [{ key: 'D major', weight: 2 }, { key: 'A major', weight: 2 }],
  progressions: [['I', 'IV', 'vi', 'V'], ['IV', 'I', 'V', 'vi'], ['I', 'vi', 'IV', 'IV']],
  sevenths: true,
  roles: {
    pad: { wave: 'triangle', cutoff: 2000, detuneCents: 10, gain: 0.081, octave: 4, attack: 1.4 },
    bass: { wave: 'sine', cutoff: 250, gain: 0.17, octave: 2, pattern: 'sustain' },
    pluck: { kind: 'fm', gain: 0.115, octave: 6, pattern: 'arp8', brightness: 0.4, ratio: 3.5 },
    lead: null,
  },
  drums: { kick: 0.51, snare: 0.207, clap: 0.0, hat: 0.058, fourOnFloor: false, halfTime: true, swing: 0, kickFromDrop: true },
  voicing: { spread: 'open' },
  fills: ['drop-out'],
  sfx: { hit: 'boom', shimmer: 'glass', whoosh: 'noise' },
  reverb: { send: 0.55, room: 0.92, damp: 0.2 },
  width: 1.4,
  master: 0.34,
};

import type { GenrePreset } from './types';

export const orchestralHybrid: GenrePreset = {
  id: 'orchestral-hybrid',
  character: 'ostinato plucks, timpani-like hits, wide pads',
  bpm: { min: 84, max: 100 },
  meters: [4, 3],
  keys: [{ key: 'D minor', weight: 3 }, { key: 'B-flat major', weight: 2 }],
  progressions: [['i', 'VI', 'VII', 'i'], ['i', 'iv', 'VII', 'III'], ['VI', 'VII', 'i', 'v'], ['i', 'III', 'iv', 'V']],
  sevenths: false,
  roles: {
    pad: { wave: 'saw', cutoff: 1300, detuneCents: 12, gain: 0.055, octave: 3, attack: 0.7 },
    bass: { wave: 'triangle', cutoff: 300, gain: 0.24, octave: 2, pattern: 'eighths' },
    pluck: { kind: 'string', gain: 0.2, octave: 4, pattern: 'ostinato', brightness: 0.55 },
    lead: { wave: 'saw', gain: 0.035, octave: 5 },
  },
  drums: { kick: 0.8, snare: 0.3, clap: 0.0, hat: 0.05, fourOnFloor: false, halfTime: true, swing: 0, kickFromDrop: false },
  voicing: { spread: 'open' },
  fills: ['tom-run', 'snare-roll'],
  sfx: { hit: 'timpani', shimmer: 'glass', whoosh: 'noise' },
  reverb: { send: 0.45, room: 0.9, damp: 0.3 },
  width: 1.35,
  master: 0.35,
};

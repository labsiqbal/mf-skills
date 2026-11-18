import type { GenrePreset } from './types';

export const cinematicPulse: GenrePreset = {
  id: 'cinematic-pulse',
  character: 'half-time drums, low strings-like pad, rising pulses',
  bpm: { min: 90, max: 110 },
  meters: [4],
  keys: [{ key: 'C minor', weight: 3 }, { key: 'E minor', weight: 2 }],
  progressions: [['i', 'VI', 'III', 'VII'], ['i', 'i', 'VI', 'VII'], ['VI', 'III', 'VII', 'i']],
  sevenths: false,
  roles: {
    pad: { wave: 'saw', cutoff: 900, detuneCents: 14, gain: 0.087, octave: 3, attack: 0.9 },
    bass: { wave: 'saw', cutoff: 260, gain: 0.117, octave: 1, pattern: 'eighths' },
    pluck: { kind: 'string', gain: 0.262, octave: 4, pattern: 'ostinato', brightness: 0.45 },
    lead: null,
  },
  drums: { kick: 0.552, snare: 0.525, clap: 0.0, hat: 0.087, fourOnFloor: false, halfTime: true, swing: 0, kickFromDrop: false },
  voicing: { spread: 'open' },
  fills: ['tom-run', 'snare-roll', 'drop-out'],
  sfx: { hit: 'timpani', shimmer: 'glass', whoosh: 'noise' },
  reverb: { send: 0.45, room: 0.9, damp: 0.25 },
  width: 1.3,
  master: 0.31,
};

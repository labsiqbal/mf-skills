import type { GenrePreset } from './types';

export const indiePop: GenrePreset = {
  id: 'indie-pop',
  character: 'bright strum-like plucks, live-feel drums',
  bpm: { min: 104, max: 118 },
  meters: [4],
  keys: [{ key: 'G major', weight: 3 }, { key: 'D major', weight: 2 }],
  progressions: [['I', 'V', 'vi', 'IV'], ['vi', 'IV', 'I', 'V'], ['I', 'IV', 'vi', 'V'], ['IV', 'I', 'V', 'V']],
  sevenths: false,
  roles: {
    pad: { wave: 'saw', cutoff: 1700, detuneCents: 8, gain: 0.051, octave: 4, attack: 0.3 },
    bass: { wave: 'square', cutoff: 450, gain: 0.128, octave: 2, pattern: 'eighths' },
    pluck: { kind: 'string', gain: 0.255, octave: 4, pattern: 'stabs', brightness: 0.8 },
    lead: { wave: 'triangle', gain: 0.076, octave: 5 },
  },
  drums: { kick: 0.525, snare: 0.433, clap: 0.0, hat: 0.115, fourOnFloor: false, halfTime: false, swing: 0.06, kickFromDrop: false },
  voicing: { spread: 'open' },
  fills: ['tom-run', 'snare-roll', 'kick-run'],
  sfx: { hit: 'clap-stack', shimmer: 'bell', whoosh: 'noise' },
  reverb: { send: 0.28, room: 0.7, damp: 0.4 },
  width: 1.2,
  master: 0.4,
};

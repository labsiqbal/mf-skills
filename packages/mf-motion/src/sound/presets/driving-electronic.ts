import type { GenrePreset } from './types';

export const drivingElectronic: GenrePreset = {
  id: 'driving-electronic',
  character: 'four-on-floor pulse, saw bass, bright plucks',
  bpm: { min: 118, max: 128 },
  meters: [4],
  keys: [{ key: 'A minor', weight: 3 }, { key: 'F minor', weight: 2 }, { key: 'D minor', weight: 2 }],
  progressions: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'VI', 'v'], ['VI', 'VII', 'i', 'i'], ['i', 'III', 'VII', 'VI']],
  sevenths: false,
  roles: {
    pad: { wave: 'saw', cutoff: 2200, detuneCents: 9, gain: 0.075, octave: 4, attack: 0.25 },
    bass: { wave: 'saw', cutoff: 520, gain: 0.104, octave: 2, pattern: 'offbeat' },
    pluck: { kind: 'string', gain: 0.364, octave: 5, pattern: 'arp16', brightness: 0.75 },
    lead: { wave: 'square', gain: 0.083, octave: 5 },
  },
  drums: { kick: 0.52, snare: 0.0, clap: 0.464, hat: 0.166, fourOnFloor: true, halfTime: false, swing: 0, kickFromDrop: false },
  voicing: { spread: 'close' },
  fills: ['snare-roll', 'hat-burst', 'drop-out'],
  sfx: { hit: 'boom', shimmer: 'glass', whoosh: 'filtered' },
  reverb: { send: 0.3, room: 0.78, damp: 0.35 },
  width: 1.25,
  master: 0.35,
};

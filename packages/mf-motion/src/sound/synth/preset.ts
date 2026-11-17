// Presets drive what the synth plays. Until the ten presets (MFM-067) exist,
// one built-in test preset exercises every voice and processor.
import type { Wave } from './tables';

export interface Preset {
  id: string;
  /** Root as a MIDI note (the key's tonic in the bass octave). */
  rootMidi: number;
  /** Chords as semitone offsets from the root, one per bar, cycling. */
  progression: number[][];
  pad: { wave: Wave; cutoff: number; detuneCents: number; gain: number };
  bass: { wave: Wave; cutoff: number; gain: number };
  pluck: { gain: number; brightness: number };
  bell: { gain: number; ratio: number; index: number };
  drums: { kick: number; snare: number; clap: number; hat: number };
  reverb: { send: number; room: number; damp: number };
  width: number;
  master: number;
}

export const TEST_PRESET: Preset = {
  id: 'test-basic',
  rootMidi: 45, // A2: A minor
  progression: [
    [0, 3, 7], // Am
    [-4, 0, 3], // F
    [3, 7, 10], // C
    [-2, 2, 5], // G
  ],
  pad: { wave: 'saw', cutoff: 1800, detuneCents: 7, gain: 0.07 },
  bass: { wave: 'square', cutoff: 420, gain: 0.22 },
  pluck: { gain: 0.32, brightness: 0.55 },
  bell: { gain: 0.16, ratio: 3.5, index: 2.4 },
  drums: { kick: 0.85, snare: 0.32, clap: 0.3, hat: 0.11 },
  reverb: { send: 0.35, room: 0.82, damp: 0.3 },
  width: 1.2,
  master: 0.8,
};

export const PRESETS: Record<string, Preset> = { [TEST_PRESET.id]: TEST_PRESET };

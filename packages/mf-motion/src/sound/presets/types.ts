// Genre preset data shape (sound.md, Presets).
import type { Wave } from '../synth/tables';

export type Degree = string; // roman numeral, upper case major, lower case minor, "o" diminished, optional "7"
export type FillKind = 'snare-roll' | 'hat-burst' | 'kick-run' | 'drop-out' | 'tom-run';
export type PluckPattern = 'arp8' | 'arp16' | 'offbeat' | 'stabs' | 'ostinato';

export interface GenrePreset {
  id: string;
  character: string;
  bpm: { min: number; max: number };
  /** Allowed beats per bar. */
  meters: Array<3 | 4>;
  /** Key pool with weights; "A minor", "E-flat major". */
  keys: Array<{ key: string; weight: number }>;
  /** 3-6 progressions of scale degrees, one chord per bar. */
  progressions: Degree[][];
  /** Use seventh chords everywhere. */
  sevenths: boolean;
  roles: {
    pad: { wave: Wave; cutoff: number; detuneCents: number; gain: number; octave: number; attack: number };
    bass: { wave: Wave; cutoff: number; gain: number; octave: number; pattern: 'roots' | 'eighths' | 'offbeat' | 'gated' | 'sustain' };
    pluck: { kind: 'string' | 'fm'; gain: number; octave: number; pattern: PluckPattern; brightness: number; ratio?: number };
    lead: { wave: Wave; gain: number; octave: number } | null;
  };
  drums: {
    kick: number;
    snare: number;
    clap: number;
    hat: number;
    /** Four on the floor allowed from energy.kick.fourOnTheFloorFrom. */
    fourOnFloor: boolean;
    /** Half-time backbeat (snare on beat 3). */
    halfTime: boolean;
    /** Swing for off-beat hats, 0-0.3 of a sixteenth step. */
    swing: number;
    /** No kick before the first drop section. */
    kickFromDrop: boolean;
  };
  voicing: { spread: 'close' | 'open' };
  fills: FillKind[];
  /** SFX voicing defaults (MFM-068): which voice plays each role. */
  sfx: { hit: 'boom' | 'timpani' | 'clap-stack'; shimmer: 'bell' | 'glass'; whoosh: 'noise' | 'filtered' };
  reverb: { send: number; room: number; damp: number };
  width: number;
  master: number;
}

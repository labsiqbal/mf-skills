// Arrangement: a resolved beat grid, a genre preset and a seed become per-bar
// instrument events (instruments enter at the energy.* thresholds, every 4
// bars the voicing inverts or the progression advances, fills close sections,
// risers build, drops hit, the end card strips down), and the events render
// through the synth voices and mix.
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { Ducker, Reverb, softClip, widen } from './synth/dsp';
import { midiToHz, mulberry32, voiceSeed } from './synth/math';
import { SAMPLE_RATE, type ScoreGrid } from './synth/render';
import { renderBell, renderClap, renderHat, renderKick, renderOsc, renderPluck, renderRiser, renderSnare } from './synth/voices';
import type { FillKind, GenrePreset } from './presets/types';

export type Role = 'pad' | 'bass' | 'pluck' | 'lead' | 'kick' | 'snare' | 'clap' | 'hat' | 'open-hat' | 'roll' | 'tom' | 'riser' | 'impact' | 'bell' | 'shimmer';

export interface ArrangedEvent {
  /** Start in seconds. */
  at: number;
  /** Length in seconds (held notes, risers). */
  dur: number;
  role: Role;
  midi?: number;
  gain: number;
}

export interface ArrangedBar {
  bar: number;
  startSec: number;
  energy: number;
  section: string | null;
  /** The chord's MIDI notes in the pad octave, after voicing. */
  chord: number[];
  instruments: Role[];
  fill: FillKind | null;
}

export interface Arrangement {
  preset: string;
  key: string;
  bpm: number;
  bars: ArrangedBar[];
  events: ArrangedEvent[];
  lengthSec: number;
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const NUMERALS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

/** "E-flat major" -> { tonic: 3, minor: false }. */
export function parseKey(key: string): { tonic: number; minor: boolean } {
  const match = key.trim().match(/^([A-G])(-(flat|sharp))?\s+(major|minor)$/i);
  if (!match) throw new MfmError('SCHEMA_INVALID', { key }, { message: `"${key}" is not a key such as "A minor" or "E-flat major".` });
  const base = PITCH[(match[1] ?? 'C').toUpperCase()] ?? 0;
  const shift = match[3]?.toLowerCase() === 'flat' ? -1 : match[3]?.toLowerCase() === 'sharp' ? 1 : 0;
  return { tonic: (base + shift + 12) % 12, minor: match[4]?.toLowerCase() === 'minor' };
}

/** A scale degree ("VI", "ii", "iio", "V7") to semitone offsets from the tonic. */
export function chordFor(degree: string, minor: boolean, sevenths: boolean): number[] {
  const match = degree.match(/^([ivIV]+)(o)?(7)?$/);
  if (!match) throw new MfmError('SCHEMA_INVALID', { degree }, { message: `"${degree}" is not a scale degree.` });
  const numeral = match[1] ?? 'i';
  const index = NUMERALS.indexOf(numeral.toLowerCase());
  if (index < 0) throw new MfmError('SCHEMA_INVALID', { degree }, { message: `"${degree}" is not a scale degree.` });
  const root = (minor ? MINOR : MAJOR)[index] ?? 0;
  const diminished = match[2] === 'o';
  const upper = numeral === numeral.toUpperCase();
  const triad = diminished ? [0, 3, 6] : upper ? [0, 4, 7] : [0, 3, 7];
  const seventh = sevenths || match[3] === '7' ? [diminished ? 10 : upper ? (index === 4 ? 10 : 11) : 10] : [];
  return [...triad, ...seventh].map((step) => root + step);
}

/** Pick a key from the preset pool by weight (or use the requested one). */
function chooseKey(preset: GenrePreset, random: () => number, requested: string | null): string {
  if (requested) {
    if (!preset.keys.some((entry) => entry.key.toLowerCase() === requested.toLowerCase())) {
      throw new MfmError('SCHEMA_INVALID', { key: requested, preset: preset.id, keys: preset.keys.map((entry) => entry.key) }, { message: `${requested} is not in the ${preset.id} key pool.` });
    }
    return requested;
  }
  const total = preset.keys.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = random() * total;
  for (const entry of preset.keys) {
    pick -= entry.weight;
    if (pick < 0) return entry.key;
  }
  return preset.keys[0]?.key ?? 'A minor';
}

function voice(chord: number[], base: number, spread: 'close' | 'open', invert: boolean): number[] {
  let notes = chord.map((step) => base + step);
  if (spread === 'open' && notes.length >= 3) notes = [notes[0] as number, notes[2] as number, (notes[1] as number) + 12, ...notes.slice(3).map((note) => note + 12)];
  if (invert) notes = [...notes.slice(1), (notes[0] as number) + 12];
  return notes.sort((a, b) => a - b);
}

const isEndCard = (name: string | null) => name !== null && /^end/.test(name);

/** Per-bar instrument events for a grid. */
export function arrange(grid: ScoreGrid, preset: GenrePreset, seed: number, options: { key?: string | null } = {}): Arrangement {
  const random = mulberry32(voiceSeed(seed, `arrange:${preset.id}`));
  const key = chooseKey(preset, random, options.key ?? null);
  const { tonic, minor } = parseKey(key);
  const spb = 60 / grid.bpm;
  const barSec = spb * grid.beatsPerBar;
  const e = NUMBERS;
  const events: ArrangedEvent[] = [];
  const bars: ArrangedBar[] = [];
  const firstDrop = grid.sections.find((section) => section.drop)?.from.sec ?? Number.POSITIVE_INFINITY;
  const push = (event: ArrangedEvent) => events.push(event);

  for (let bar = 0; bar < grid.bars; bar += 1) {
    const start = bar * barSec;
    const section = grid.sections.find((entry) => start >= entry.from.sec - 1e-6 && start < entry.to.sec - 1e-6) ?? null;
    const name = section ? (section as { name?: string }).name ?? null : null;
    const energy = section ? section.energy : 0.5;
    const firstBar = section !== null && Math.abs(section.from.sec - start) < 1e-6;
    const lastBar = section !== null && Math.abs(section.to.sec - (start + barSec)) < 1e-6;
    const block = Math.floor(bar / 4);
    const progression = preset.progressions[Math.floor(block / 2) % preset.progressions.length] ?? ['i'];
    const degree = progression[bar % progression.length] ?? 'i';
    const steps = chordFor(degree, minor, preset.sevenths);
    const padBase = 12 * (preset.roles.pad.octave + 1) + tonic;
    const chord = voice(steps, padBase, preset.voicing.spread, block % 2 === 1);
    const root = 12 * (preset.roles.bass.octave + 1) + tonic + (steps[0] ?? 0);
    const instruments = new Set<Role>(['pad']);
    const add = (role: Role, at: number, dur: number, gain: number, midi?: number) => {
      instruments.add(role);
      push({ at, dur, role, gain, ...(midi !== undefined ? { midi } : {}) });
    };
    const last = bar === grid.bars - 1;
    // Pad: always, held for the bar (the final bar rings into the tail).
    for (const note of chord) add('pad', start, last ? barSec + grid.tailSec * 0.5 : barSec, preset.roles.pad.gain, note);

    if (isEndCard(name)) {
      // End card: pad, a mark hit and a shimmer only.
      if (firstBar) {
        add('impact', start, 0.5, preset.drums.kick * 0.6);
        add('bell', start, 2.4, 0.16, 12 * (preset.roles.pluck.octave + 1) + tonic + (steps[0] ?? 0));
        add('shimmer', start + spb, 2.6, 0.1, 12 * (preset.roles.pluck.octave + 2) + tonic + (steps[2] ?? 7));
      }
      bars.push({ bar, startSec: start, energy, section: name, chord, instruments: [...instruments], fill: null });
      continue;
    }

    const drums = section?.drop ? Math.max(energy, e['energy.clap']) : energy;
    const kickAllowed = !preset.drums.kickFromDrop || start >= firstDrop - 1e-6;
    if (section?.drop && firstBar) add('impact', start, 0.6, preset.drums.kick * 1.15);

    // Bass from energy.bass.
    if (energy >= e['energy.bass']) {
      const pattern = preset.roles.bass.pattern;
      if (pattern === 'sustain') add('bass', start, barSec * 0.95, preset.roles.bass.gain, root);
      else {
        const per = pattern === 'gated' ? 4 : pattern === 'eighths' || pattern === 'offbeat' ? 2 : 1;
        for (let beat = 0; beat < grid.beatsPerBar; beat += 1) {
          for (let sub = 0; sub < per; sub += 1) {
            if (pattern === 'offbeat' && sub === 0) continue;
            const at = start + beat * spb + (sub * spb) / per;
            add('bass', at, (spb / per) * (pattern === 'gated' ? 0.45 : 0.8), preset.roles.bass.gain, root + (pattern === 'eighths' && sub === 1 && beat % 2 === 1 ? 12 : 0));
          }
        }
      }
    }
    // Plucks from energy.pluck.
    if (energy >= e['energy.pluck']) {
      const pattern = preset.roles.pluck.pattern;
      const base = 12 * (preset.roles.pluck.octave + 1) + tonic;
      const tones = steps.map((step) => base + step);
      const per = pattern === 'arp16' || pattern === 'ostinato' ? 4 : 2;
      for (let step = 0; step < grid.beatsPerBar * per; step += 1) {
        const at = start + (step * spb) / per;
        if (pattern === 'offbeat' && step % 2 === 0) continue;
        if (pattern === 'stabs' && step % per !== per - 1 && step % (per * 2) !== per) continue;
        if (pattern === 'arp8' && random() < 0.2) continue;
        if (pattern === 'stabs') {
          for (const tone of tones.slice(0, 3)) add('pluck', at, 0.35, preset.roles.pluck.gain * 0.6, tone);
          continue;
        }
        const index = pattern === 'ostinato' ? [0, 2, 1, 2][step % 4] ?? 0 : Math.floor(random() * tones.length);
        add('pluck', at, 0.6, preset.roles.pluck.gain, (tones[index % tones.length] ?? base) + (pattern === 'ostinato' && step % 8 === 4 ? 12 : 0));
      }
    }
    // Lead on high energy: a chord tone per beat.
    if (preset.roles.lead && energy >= 0.8) {
      for (let beat = 0; beat < grid.beatsPerBar; beat += 1) {
        const tone = steps[Math.floor(random() * steps.length)] ?? 0;
        add('lead', start + beat * spb, spb * 0.9, preset.roles.lead.gain, 12 * (preset.roles.lead.octave + 1) + tonic + tone);
      }
    }
    // Drums.
    for (let beat = 0; beat < grid.beatsPerBar; beat += 1) {
      const at = start + beat * spb;
      const fourOnFloor = preset.drums.fourOnFloor && drums >= e['energy.kick'].fourOnTheFloorFrom;
      const backbeat = preset.drums.halfTime ? beat === 2 : beat % 2 === 1;
      if (kickAllowed && drums >= e['energy.kick'].from && (fourOnFloor || beat === 0 || (!preset.drums.halfTime && grid.beatsPerBar === 4 && beat === 2))) add('kick', at, 0.4, preset.drums.kick);
      if (drums >= e['energy.clap'] && preset.drums.clap > 0 && backbeat) add('clap', at, 0.3, preset.drums.clap);
      else if (kickAllowed && drums >= e['energy.kick'].from && preset.drums.snare > 0 && backbeat) add('snare', at, 0.25, preset.drums.snare);
      if (drums >= e['energy.hats'].from) {
        const per = drums >= e['energy.hats'].sixteenthsFrom ? 4 : 2;
        for (let sub = 0; sub < per; sub += 1) {
          const swing = sub % 2 === 1 ? preset.drums.swing * (spb / per) : 0;
          add('hat', at + (sub * spb) / per + swing, 0.06, preset.drums.hat * (sub === 0 ? 1 : 0.7));
        }
      }
    }
    // Riser sections build a noise riser and a roll into the next section.
    let fill: FillKind | null = null;
    if (section?.riser && lastBar) {
      add('riser', start, barSec, 0.45);
      for (let i = 0; i < grid.beatsPerBar * 4; i += 1) add('roll', start + (i * spb) / 4, 0.12, preset.drums.snare > 0 ? preset.drums.snare * (0.3 + (0.7 * i) / (grid.beatsPerBar * 4)) : 0.2);
    } else if (lastBar && section !== null) {
      // The last bar of a section carries a seeded fill in its last beat.
      fill = preset.fills[Math.floor(random() * preset.fills.length)] ?? null;
      const beatStart = start + (grid.beatsPerBar - 1) * spb;
      if (fill === 'drop-out') {
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const event = events[i] as ArrangedEvent;
          if (event.at >= beatStart - 1e-9 && ['kick', 'snare', 'clap', 'hat'].includes(event.role)) events.splice(i, 1);
        }
      } else if (fill === 'snare-roll') for (let i = 0; i < 8; i += 1) add('roll', beatStart + (i * spb) / 8, 0.1, 0.12 + i * 0.025);
      else if (fill === 'hat-burst') for (let i = 0; i < 4; i += 1) add('open-hat', beatStart + (i * spb) / 4, 0.2, preset.drums.hat * 1.2);
      else if (fill === 'kick-run') for (let i = 0; i < 4; i += 1) add('kick', beatStart + (i * spb) / 4, 0.3, preset.drums.kick * 0.7);
      else if (fill === 'tom-run') for (let i = 0; i < 4; i += 1) add('tom', beatStart + (i * spb) / 4, 0.3, 0.35, 50 - i * 3);
    }
    bars.push({ bar, startSec: start, energy, section: name, chord, instruments: [...instruments].sort(), fill });
  }
  events.sort((a, b) => a.at - b.at || a.role.localeCompare(b.role) || (a.midi ?? 0) - (b.midi ?? 0));
  return { preset: preset.id, key, bpm: grid.bpm, bars, events, lengthSec: barSec * grid.bars + grid.tailSec };
}

/** Render an arrangement: [left, right] and the peak before the soft clip. */
export function renderArrangement(arrangement: Arrangement, preset: GenrePreset, seed: number): { channels: [Float32Array, Float32Array]; peak: number } {
  const sr = SAMPLE_RATE;
  const length = Math.round(arrangement.lengthSec * sr);
  const bed = new Float64Array(length);
  const kick = new Float64Array(length);
  const drums = new Float64Array(length);
  const at = (sec: number) => Math.round(sec * sr);
  arrangement.events.forEach((event, i) => {
    const s = voiceSeed(seed, `${event.role}:${i}`);
    const hz = event.midi !== undefined ? midiToHz(event.midi) : 0;
    switch (event.role) {
      case 'pad':
        renderOsc(bed, { wave: preset.roles.pad.wave, freq: hz, start: at(event.at), holdSamples: at(event.dur), gain: event.gain, env: { attack: preset.roles.pad.attack, decay: 0.8, sustain: 0.8, release: 0.9 }, cutoff: preset.roles.pad.cutoff, detuneCents: preset.roles.pad.detuneCents }, sr);
        return;
      case 'bass':
        renderOsc(bed, { wave: preset.roles.bass.wave, freq: hz, start: at(event.at), holdSamples: at(event.dur), gain: event.gain, env: { attack: 0.004, decay: 0.2, sustain: 0.65, release: 0.06 }, cutoff: preset.roles.bass.cutoff }, sr);
        return;
      case 'lead':
        renderOsc(bed, { wave: preset.roles.lead?.wave ?? 'triangle', freq: hz, start: at(event.at), holdSamples: at(event.dur), gain: event.gain, env: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.2 }, cutoff: 3000 }, sr);
        return;
      case 'pluck':
        if (preset.roles.pluck.kind === 'fm') renderBell(bed, at(event.at), hz, event.dur, event.gain, sr, preset.roles.pluck.ratio ?? 4, 1.6);
        else renderPluck(bed, at(event.at), hz, event.dur + 0.3, event.gain, s, sr, preset.roles.pluck.brightness);
        return;
      case 'bell':
      case 'shimmer':
        renderBell(bed, at(event.at), hz, event.dur, event.gain, sr, event.role === 'shimmer' ? 7 : 3.5, event.role === 'shimmer' ? 1.2 : 2.4);
        return;
      case 'kick':
        renderKick(kick, at(event.at), event.gain, s, sr);
        return;
      case 'impact':
        renderKick(kick, at(event.at), event.gain, s, sr, 1.4);
        return;
      case 'tom':
        renderOsc(drums, { wave: 'sine', freq: hz || 110, start: at(event.at), holdSamples: at(0.05), gain: event.gain, env: { attack: 0.002, decay: 0.15, sustain: 0.2, release: 0.15 } }, sr);
        return;
      case 'snare':
      case 'roll':
        renderSnare(drums, at(event.at), event.gain, s, sr);
        return;
      case 'clap':
        renderClap(drums, at(event.at), event.gain, s, sr);
        return;
      case 'hat':
      case 'open-hat':
        renderHat(drums, at(event.at), event.gain, s, sr, event.role === 'open-hat');
        return;
      case 'riser':
        renderRiser(drums, at(event.at), event.dur, event.gain, s, sr);
        return;
    }
  });
  const reverb = new Reverb(sr, preset.reverb.room, preset.reverb.damp);
  const ducker = new Ducker(sr, NUMBERS['mix.kickDuckMax']);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let peak = 0;
  for (let n = 0; n < length; n += 1) {
    const k = kick[n] ?? 0;
    const b = (bed[n] ?? 0) * ducker.gain(k);
    const d = drums[n] ?? 0;
    const [wl, wr] = reverb.process((b + d * 0.4) * preset.reverb.send);
    const dry = b + d + k;
    const [l, r] = widen(dry + wl * 10, dry + wr * 10, preset.width);
    const ml = l * preset.master;
    const mr = r * preset.master;
    peak = Math.max(peak, Math.abs(ml), Math.abs(mr));
    left[n] = softClip(ml);
    right[n] = softClip(mr);
  }
  return { channels: [left, right], peak };
}

/** A theme's sound block narrows a preset's BPM and key; anything outside the preset is rejected. */
export function narrowPreset(preset: GenrePreset, sound: { bpm: [number, number]; key: string | null }): GenrePreset {
  const [low, high] = sound.bpm;
  if (!(low <= high) || low < preset.bpm.min || high > preset.bpm.max) {
    throw new MfmError('SCHEMA_INVALID', { preset: preset.id, bpm: sound.bpm, allowed: [preset.bpm.min, preset.bpm.max] }, {
      message: `The theme asks ${low}-${high} BPM, outside ${preset.id} (${preset.bpm.min}-${preset.bpm.max}).`,
    });
  }
  let keys = preset.keys;
  if (sound.key) {
    keys = preset.keys.filter((entry) => entry.key.toLowerCase() === sound.key?.toLowerCase());
    if (keys.length === 0) {
      throw new MfmError('SCHEMA_INVALID', { preset: preset.id, key: sound.key, keys: preset.keys.map((entry) => entry.key) }, { message: `The theme's key ${sound.key} is not in the ${preset.id} key pool.` });
    }
  }
  return { ...preset, bpm: { min: low, max: high }, keys };
}

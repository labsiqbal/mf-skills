// renderScore: a resolved beat grid, a seed and a preset to stereo float audio
// at audio.sampleRate, deterministic to the bit.
import { NUMBERS } from '../../kit/numbers';
import { Ducker, Reverb, softClip, widen } from './dsp';
import { midiToHz, mulberry32, voiceSeed } from './math';
import { type Preset, TEST_PRESET } from './preset';
import { renderBell, renderClap, renderHat, renderKick, renderOsc, renderPluck, renderRiser, renderSnare } from './voices';

export const SAMPLE_RATE = NUMBERS['audio.sampleRate'];

/** The parts of a resolved beat grid the synth reads. */
export interface ScoreGrid {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  tailSec: number;
  sections: Array<{ from: { sec: number }; to: { sec: number }; energy: number; riser: boolean; drop: boolean }>;
}

interface Stems {
  bed: Float64Array;
  kick: Float64Array;
  drums: Float64Array;
}

function energyAt(grid: ScoreGrid, sec: number): { energy: number; section: ScoreGrid['sections'][number] | null } {
  const section = grid.sections.find((entry) => sec >= entry.from.sec - 1e-9 && sec < entry.to.sec - 1e-9) ?? null;
  return { energy: section ? section.energy : 0.5, section };
}

/** Render the score: [left, right] at audio.sampleRate. */
export function renderScore(grid: ScoreGrid, options: { seed: number; preset?: Preset }): [Float32Array, Float32Array] {
  const preset = options.preset ?? TEST_PRESET;
  const sr = SAMPLE_RATE;
  const spb = 60 / grid.bpm;
  const barSec = spb * grid.beatsPerBar;
  const musicSec = barSec * grid.bars;
  const length = Math.round((musicSec + grid.tailSec) * sr);
  const stems: Stems = { bed: new Float64Array(length), kick: new Float64Array(length), drums: new Float64Array(length) };
  const at = (sec: number) => Math.round(sec * sr);
  const seedOf = (name: string, i: number) => voiceSeed(options.seed, `${name}-${i}`);
  const random = mulberry32(voiceSeed(options.seed, 'arrangement'));
  const e = { hats: NUMBERS['energy.hats'], bass: NUMBERS['energy.bass'], kick: NUMBERS['energy.kick'], pluck: NUMBERS['energy.pluck'], clap: NUMBERS['energy.clap'] };

  for (let bar = 0; bar < grid.bars; bar += 1) {
    const barStart = bar * barSec;
    const { energy, section } = energyAt(grid, barStart);
    const chord = preset.progression[bar % preset.progression.length] ?? [0];
    const last = bar === grid.bars - 1;
    // Pad: always; the last bar rings into the tail.
    const hold = at(last ? barSec + grid.tailSec * 0.5 : barSec);
    for (const offset of chord) {
      renderOsc(stems.bed, { wave: preset.pad.wave, freq: midiToHz(preset.rootMidi + 24 + offset), start: at(barStart), holdSamples: hold, gain: preset.pad.gain, env: { attack: 0.35, decay: 0.8, sustain: 0.8, release: 0.9 }, cutoff: preset.pad.cutoff, detuneCents: preset.pad.detuneCents }, sr);
    }
    // Bass on every beat from energy.bass.
    if (energy >= e.bass) {
      for (let beat = 0; beat < grid.beatsPerBar; beat += 1) {
        renderOsc(stems.bed, { wave: preset.bass.wave, freq: midiToHz(preset.rootMidi + (chord[0] ?? 0)), start: at(barStart + beat * spb), holdSamples: at(spb * 0.7), gain: preset.bass.gain, env: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.08 }, cutoff: preset.bass.cutoff }, sr);
      }
    }
    // Plucks: an eighth-note arpeggio of the chord with seeded rests, from energy.pluck.
    if (energy >= e.pluck) {
      for (let step = 0; step < grid.beatsPerBar * 2; step += 1) {
        if (random() < 0.25) continue;
        const note = preset.rootMidi + 36 + (chord[Math.floor(random() * chord.length)] ?? 0);
        renderPluck(stems.bed, at(barStart + step * spb * 0.5), midiToHz(note), 0.9, preset.pluck.gain, seedOf('pluck', bar * 16 + step), sr, preset.pluck.brightness);
      }
    }
    // Bell at the start of each section and on a drop.
    if (section && Math.abs(section.from.sec - barStart) < 1e-6) {
      renderBell(stems.bed, at(barStart), midiToHz(preset.rootMidi + 48 + (chord[0] ?? 0)), 2.2, preset.bell.gain * (section.drop ? 1.4 : 1), sr, preset.bell.ratio, preset.bell.index);
    }
    // Drums.
    for (let beat = 0; beat < grid.beatsPerBar; beat += 1) {
      const t = barStart + beat * spb;
      const fourOnFloor = energy >= NUMBERS['energy.kick'].fourOnTheFloorFrom;
      if (energy >= e.kick.from && (fourOnFloor || beat === 0 || (grid.beatsPerBar === 4 && beat === 2))) renderKick(stems.kick, at(t), preset.drums.kick, seedOf('kick', bar * 8 + beat), sr);
      if (energy >= e.clap && beat % 2 === 1) renderClap(stems.drums, at(t), preset.drums.clap, seedOf('clap', bar * 8 + beat), sr);
      else if (energy >= e.kick.from && beat % 2 === 1) renderSnare(stems.drums, at(t), preset.drums.snare, seedOf('snare', bar * 8 + beat), sr);
      if (energy >= e.hats.from) {
        const per = energy >= e.hats.sixteenthsFrom ? 4 : 2;
        for (let sub = 0; sub < per; sub += 1) renderHat(stems.drums, at(t + (sub * spb) / per), preset.drums.hat * (sub === 0 ? 1 : 0.7), seedOf('hat', bar * 64 + beat * 8 + sub), sr, sub === per - 1 && beat === grid.beatsPerBar - 1 && last);
      }
    }
    // Riser across a riser section's last bar; impact on a drop.
    if (section?.riser && Math.abs(section.to.sec - (barStart + barSec)) < 1e-6) renderRiser(stems.drums, at(barStart), barSec, 0.5, seedOf('riser', bar), sr);
    if (section?.drop && Math.abs(section.from.sec - barStart) < 1e-6) renderKick(stems.kick, at(barStart), preset.drums.kick * 1.2, seedOf('impact', bar), sr, 1.4);
  }

  // Mix: bed ducked by the kick, reverb on bed and drums, width, soft clip.
  const reverb = new Reverb(sr, preset.reverb.room, preset.reverb.damp);
  const ducker = new Ducker(sr, NUMBERS['mix.kickDuckMax']);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let n = 0; n < length; n += 1) {
    const kick = stems.kick[n] ?? 0;
    const bed = (stems.bed[n] ?? 0) * ducker.gain(kick);
    const drums = stems.drums[n] ?? 0;
    const [wl, wr] = reverb.process((bed + drums * 0.5) * preset.reverb.send);
    const dry = bed + drums + kick;
    const [l, r] = widen(dry + wl * 10, dry + wr * 10, preset.width);
    left[n] = softClip(l * preset.master);
    right[n] = softClip(r * preset.master);
  }
  return [left, right];
}

// The mix: the music bed with SFX windows and the pre-hit dip (sfx.ts), the
// end fade, and voiceover ducking; then the voice on top. Kick ducking
// (mix.kickDuckMax) happens inside the synth render, where the kick stem exists.
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { runStream } from '../proc/run';
import { type PlacedCue, type SfxCueInput, mixSfx } from './sfx';
import { OnePole, Svf } from './synth/dsp';
import { dbToGain } from './synth/math';

export type Stereo = [Float32Array, Float32Array];

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Decode any audio file to stereo float at `sampleRate` (FFmpeg f32le). */
export async function decodeStereo(file: string, sampleRate: number): Promise<Stereo> {
  const stream = runStream('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '2', '-ar', String(sampleRate), '-f', 'f32le', '-'], { timeoutMs: 600_000 });
  const parts: Buffer[] = [];
  for await (const chunk of stream.chunks) parts.push(chunk);
  const result = await stream.result;
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg' });
  if (result.code !== 0) throw new MfmError('TOOL_FAILED', { tool: 'ffmpeg', file, stderrTail: result.stderr.slice(-1000) }, { message: `FFmpeg could not decode ${file}.` });
  const bytes = Buffer.concat(parts);
  const frames = Math.floor(bytes.length / 8);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    left[i] = bytes.readFloatLE(i * 8);
    right[i] = bytes.readFloatLE(i * 8 + 4);
  }
  return [left, right];
}

/** A slice from `fromSec`, `seconds` long (zero-padded), with a linear fade over the last mix.endFadeSec. */
export function trimWithFade(audio: Stereo, sampleRate: number, fromSec: number, seconds: number): Stereo {
  const length = Math.round(seconds * sampleRate);
  const start = Math.round(fromSec * sampleRate);
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  for (let c = 0; c < 2; c += 1) for (let n = 0; n < length; n += 1) (out[c] as Float32Array)[n] = (audio[c] as Float32Array)[start + n] ?? 0;
  endFade(out, sampleRate);
  return out;
}

/** Linear fade to silence over the last mix.endFadeSec. */
export function endFade(audio: Stereo, sampleRate: number): void {
  const fade = Math.min(audio[0].length, Math.round(NUMBERS['mix.endFadeSec'] * sampleRate));
  for (let k = 0; k < fade; k += 1) {
    const n = audio[0].length - fade + k;
    const g = 1 - (k + 1) / fade;
    audio[0][n] = (audio[0][n] ?? 0) * g;
    audio[1][n] = (audio[1][n] ?? 0) * g;
  }
}

/** Speech regions of a voice track: 20 ms RMS above -45 dBFS, smoothed (40 ms attack, 250 ms release). */
export function speechGate(voice: Stereo, sampleRate: number): Float64Array {
  const length = voice[0].length;
  const gate = new Float64Array(length);
  const block = Math.round(0.02 * sampleRate);
  const threshold = dbToGain(-45);
  const attack = new OnePole(0.04, sampleRate);
  const release = new OnePole(0.25, sampleRate);
  let level = 0;
  for (let start = 0; start < length; start += block) {
    let sum = 0;
    const end = Math.min(length, start + block);
    for (let n = start; n < end; n += 1) {
      const v = ((voice[0][n] ?? 0) + (voice[1][n] ?? 0)) / 2;
      sum += v * v;
    }
    const on = Math.sqrt(sum / Math.max(1, end - start)) > threshold ? 1 : 0;
    for (let n = start; n < end; n += 1) {
      level = on > level ? attack.process(on) : release.process(on);
      gate[n] = level;
    }
  }
  return gate;
}

export interface MixInput {
  /** The music: the synth render or the trimmed track. */
  bed: Stereo;
  /** The grid's SFX cues (frame-snapped picture times). */
  sfx: SfxCueInput[];
  /** A voiceover already at -16 LUFS, or null. */
  voice: Stereo | null;
  seed: number;
  fps: number;
  sampleRate: number;
  /** The bed already yields to SFX (rendered from yielded events). */
  bedYielded?: boolean;
}

export interface MixResult {
  channels: Stereo;
  /** The music after its own processing and voice ducking, without SFX or voice. */
  music: Stereo;
  cues: PlacedCue[];
  /** Share of the music's energy below bed.lowShareMax's frequency. */
  lowShare: number;
}

/** Mix bed, SFX and voice (mix.voiceDuckDb under speech, mix.endFadeSec at the end). */
export function mix(input: MixInput): MixResult {
  const sr = input.sampleRate;
  const length = input.bed[0].length;
  const bed: Stereo = [Float32Array.from(input.bed[0]), Float32Array.from(input.bed[1])];
  // Music ducks under speech.
  if (input.voice) {
    const gate = speechGate(input.voice, sr);
    const duck = dbToGain(NUMBERS['mix.voiceDuckDb']);
    for (let n = 0; n < length; n += 1) {
      const g = 1 - (1 - duck) * (gate[n] ?? 0);
      bed[0][n] = (bed[0][n] ?? 0) * g;
      bed[1][n] = (bed[1][n] ?? 0) * g;
    }
  }
  endFade(bed, sr);
  const withSfx = mixSfx(bed, input.sfx, { seed: input.seed, fps: input.fps, sampleRate: sr, ...(input.bedYielded ? { bedYielded: true } : {}) });
  const channels = withSfx.channels;
  if (input.voice) {
    for (let n = 0; n < length; n += 1) {
      channels[0][n] = (channels[0][n] ?? 0) + (input.voice[0][n] ?? 0);
      channels[1][n] = (channels[1][n] ?? 0) + (input.voice[1][n] ?? 0);
    }
  }
  endFade(channels, sr);
  return { channels, music: withSfx.bed, cues: withSfx.cues, lowShare: lowShare(withSfx.bed, sr) };
}

/** Energy share below bed.lowShareMax.belowHz (2-pole low-pass). */
export function lowShare(audio: Stereo, sampleRate: number): number {
  const low = new Svf(sampleRate, NUMBERS['bed.lowShareMax'].belowHz, 0.707);
  let total = 0;
  let below = 0;
  for (let n = 0; n < audio[0].length; n += 1) {
    const v = ((audio[0][n] ?? 0) + (audio[1][n] ?? 0)) / 2;
    const l = low.process(v, 'low');
    total += v * v;
    below += l * l;
  }
  return total > 0 ? Math.round(Math.min(1, below / total) * 1000) / 1000 : 0;
}

/** 32-bit float stereo WAV (the loudness passes read it; no clipping before normalisation). */
export async function encodeWavFloat(audio: Stereo, sampleRate: number): Promise<Uint8Array> {
  const { WaveFile } = await import('wavefile');
  const wav = new WaveFile();
  wav.fromScratch(2, sampleRate, '32f', [Array.from(audio[0]), Array.from(audio[1])]);
  return wav.toBuffer();
}

export interface FinishInput {
  mode: 'synth' | 'track';
  bed: Stereo;
  /** Project-relative raw synth render, or null for a track. */
  raw: string | null;
  bpm: number;
  key: string | null;
  genre: string | null;
  seed: number | null;
  sfx: SfxCueInput[];
  fps: number;
  bedYielded?: boolean;
}

export interface FinishResult {
  sound: string;
  soundJson: string;
  lufs: number;
  truePeak: number;
  sfx: PlacedCue[];
  voice: string | null;
  lowShare: number;
  seconds: number;
}

/** Mix, normalise and write sound/score.wav and sound/sound.json. */
export async function finishScore(project: string, input: FinishInput): Promise<FinishResult> {
  const { existsSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { writeDoc } = await import('../schemas/index');
  const { loudnorm, normaliseTo } = await import('./loudness');
  const sr = NUMBERS['audio.sampleRate'];
  const work = mkdtempSync(path.join(tmpdir(), 'mfm-mix-'));
  try {
    let voice: Stereo | null = null;
    const voiceFile = path.join(project, 'sound', 'voice.wav');
    if (existsSync(voiceFile)) {
      // A user or generated voice is normalised to -16 LUFS before mixing.
      const normalised = path.join(work, 'voice-16.wav');
      await normaliseTo(voiceFile, normalised, -16);
      voice = await decodeStereo(normalised, sr);
    }
    const mixed = mix({ bed: input.bed, sfx: input.sfx, voice, seed: input.seed ?? 0, fps: input.fps, sampleRate: sr, ...(input.bedYielded ? { bedYielded: true } : {}) });
    const pre = path.join(work, 'mix.wav');
    writeFileSync(pre, await encodeWavFloat(mixed.channels, sr));
    const out = path.join(project, 'sound', 'score.wav');
    const measured = await loudnorm(pre, out);
    const seconds = Math.round((mixed.channels[0].length / sr) * 1000) / 1000;
    const soundJson = path.join(project, 'sound', 'sound.json');
    writeDoc('sound', soundJson, {
      schemaVersion: 1,
      kind: 'sound',
      mode: input.mode,
      file: 'sound/score.wav',
      raw: input.raw,
      seconds,
      bpm: input.bpm,
      key: input.key,
      genre: input.genre,
      seed: input.seed,
      lufs: measured.lufs,
      truePeak: measured.truePeak,
      lowShare: mixed.lowShare,
      voice: voice ? 'sound/voice.wav' : null,
      sfx: mixed.cues.map((cue) => ({ role: cue.role, event: cue.event, atSec: round3(cue.atSec), peakAtSec: round3(cue.peakAtSec), gainDb: Math.round(cue.gainDb * 100) / 100 })),
    });
    return { sound: out, soundJson, lufs: measured.lufs, truePeak: measured.truePeak, sfx: mixed.cues, voice: voice ? voiceFile : null, lowShare: mixed.lowShare, seconds };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

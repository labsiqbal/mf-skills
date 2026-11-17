// A user's own track: tempo, beats, downbeats, sections and the drop, from
// the engine's local `audio` analysis or (when that fails or finds no beats)
// a fallback: FFmpeg mono 22,050 Hz decode, music-tempo for tempo and beats,
// meyda for RMS and spectra per 512-sample hop. Then the beat grid is fitted
// to it. The track itself is never edited here.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Meyda from 'meyda';
// music-tempo ships no type declarations; its constructor is typed at the call site.
// @ts-expect-error untyped module
import MusicTempo from 'music-tempo';
import { MfmError } from '../cli/errors';
import { type Engine, audio as engineAudio, engineDirFor, enginePins, engineReady } from '../engine/index';
import { cache as cacheDir } from '../paths/index';
import { run, runStream } from '../proc/run';

export const DECODE_RATE = 22050;
export const HOP = 512;
/** Drop heuristic (sound.md): after/before envelope ratio floor and the onset-strength percentile. */
export const DROP = { ratioMin: 1.8, onsetTopShare: 0.1, windowBars: 2 } as const;

export interface TrackAnalysisDoc {
  schemaVersion: 1;
  kind: 'track-analysis';
  file: string;
  sha256: string;
  provider: 'hyperframes-local' | 'fallback';
  bpm: number;
  bpmCurve: number[];
  beats: number[];
  downbeats: number[];
  meter: 3 | 4;
  sections: Array<{ from: number; to: number; label: string | null }>;
  drop: { atSec: number; confidence: number } | null;
  lufs: number;
  truePeak: number;
}

export interface Features {
  /** Seconds per hop. */
  hopSec: number;
  rms: Float64Array;
  flux: Float64Array;
  durationSec: number;
}

/** Decode any audio or video file to mono float at 22,050 Hz. */
export async function decodeMono(file: string): Promise<Float32Array> {
  const stream = runStream('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(DECODE_RATE), '-f', 'f32le', '-'], { timeoutMs: 600_000 });
  const parts: Buffer[] = [];
  for await (const chunk of stream.chunks) parts.push(chunk);
  const result = await stream.result;
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg' });
  if (result.code !== 0) throw new MfmError('TOOL_FAILED', { tool: 'ffmpeg', file, stderrTail: result.stderr.slice(-1000) }, { message: `FFmpeg could not decode ${file}.` });
  const bytes = Buffer.concat(parts);
  const samples = new Float32Array(Math.floor(bytes.length / 4));
  for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readFloatLE(i * 4);
  return samples;
}

/** RMS and spectral flux per 512-sample hop (meyda RMS and amplitude spectrum; flux = summed positive spectral change). */
export function features(samples: Float32Array): Features {
  const meyda = Meyda as unknown as { bufferSize: number; sampleRate: number; windowingFunction: string; extract: (features: string[], signal: Float32Array) => { rms: number; amplitudeSpectrum: Float32Array } };
  meyda.bufferSize = HOP;
  meyda.sampleRate = DECODE_RATE;
  meyda.windowingFunction = 'hanning';
  const hops = Math.floor(samples.length / HOP);
  const rms = new Float64Array(hops);
  const flux = new Float64Array(hops);
  let previous: Float32Array | null = null;
  for (let h = 0; h < hops; h += 1) {
    const frame = samples.slice(h * HOP, (h + 1) * HOP);
    const result = meyda.extract(['rms', 'amplitudeSpectrum'], frame);
    rms[h] = result.rms;
    const spectrum = Float32Array.from(result.amplitudeSpectrum);
    if (previous) {
      let sum = 0;
      for (let k = 0; k < spectrum.length; k += 1) {
        const d = (spectrum[k] ?? 0) - (previous[k] ?? 0);
        if (d > 0) sum += d;
      }
      flux[h] = sum;
    }
    previous = spectrum;
  }
  return { hopSec: HOP / DECODE_RATE, rms, flux, durationSec: samples.length / DECODE_RATE };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

function meanOver(values: Float64Array, hopSec: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from / hopSec));
  const b = Math.min(values.length, Math.ceil(to / hopSec));
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += values[i] ?? 0;
  return b > a ? sum / (b - a) : 0;
}

/** Local maxima of spectral flux: time and strength. */
export function onsets(f: Features): Array<{ atSec: number; strength: number }> {
  const out: Array<{ atSec: number; strength: number }> = [];
  for (let i = 1; i < f.flux.length - 1; i += 1) {
    const v = f.flux[i] ?? 0;
    if (v > 0 && v >= (f.flux[i - 1] ?? 0) && v > (f.flux[i + 1] ?? 0)) out.push({ atSec: i * f.hopSec, strength: v });
  }
  return out;
}

/** Downbeats: the beat phase with the most flux, every `meter` beats. */
export function downbeatsFrom(beats: number[], f: Features, meter: 3 | 4): number[] {
  let best = 0;
  let bestSum = -1;
  for (let phase = 0; phase < meter; phase += 1) {
    let sum = 0;
    for (let i = phase; i < beats.length; i += meter) sum += meanOver(f.flux, f.hopSec, (beats[i] ?? 0) - 0.03, (beats[i] ?? 0) + 0.05);
    if (sum > bestSum) {
      bestSum = sum;
      best = phase;
    }
  }
  return beats.filter((_, i) => i >= best && (i - best) % meter === 0);
}

/** Sections from envelope changes at downbeats (fallback): a boundary where 2 bars after vs before change by 1.4x, at least 4 bars apart. */
export function sectionsFrom(downbeats: number[], f: Features): Array<{ from: number; to: number; label: string | null }> {
  const barSec = downbeats.length > 1 ? median(downbeats.slice(1).map((t, i) => t - (downbeats[i] ?? 0))) : 2;
  const cuts: number[] = [];
  for (let i = 2; i < downbeats.length - 2; i += 1) {
    const at = downbeats[i] ?? 0;
    const before = meanOver(f.rms, f.hopSec, at - 2 * barSec, at);
    const after = meanOver(f.rms, f.hopSec, at, at + 2 * barSec);
    const ratio = before > 0 ? after / before : 1;
    if ((ratio > 1.4 || ratio < 1 / 1.4) && (cuts.length === 0 || at - (cuts[cuts.length - 1] ?? 0) >= 4 * barSec - 1e-6)) cuts.push(at);
  }
  const edges = [0, ...cuts, f.durationSec];
  return edges.slice(1).map((to, i) => ({ from: edges[i] ?? 0, to, label: String.fromCharCode(65 + i) }));
}

/**
 * Drop: candidates are section boundaries and beats (so a misplaced section
 * edge or downbeat cannot hide it); each needs 2 bars after vs before of at
 * least 1.8x envelope and an onset within 1 beat in the top 10% of onsets; the
 * best score wins, confidence = its share of all passing scores.
 */
export function findDrop(f: Features, sections: Array<{ from: number }>, beats: number[], beatSec: number, barSec: number): { atSec: number; confidence: number } | null {
  const all = onsets(f);
  if (all.length === 0) return null;
  const sorted = all.map((onset) => onset.strength).sort((a, b) => b - a);
  const floor = sorted[Math.max(0, Math.ceil(sorted.length * DROP.onsetTopShare) - 1)] ?? 0;
  const peak = sorted[0] ?? 1;
  const window = DROP.windowBars * barSec;
  const candidates = [...sections.map((section) => section.from), ...beats]
    .filter((at) => at >= window && at <= f.durationSec - window)
    .sort((a, b) => a - b)
    .filter((at, i, list) => i === 0 || at - (list[i - 1] ?? 0) > beatSec / 2);
  // Each passing candidate is scored and placed at the strong onset that qualified it.
  const scored: Array<{ atSec: number; score: number }> = [];
  for (const at of candidates) {
    const before = meanOver(f.rms, f.hopSec, at - window, at);
    const after = meanOver(f.rms, f.hopSec, at, at + window);
    const ratio = before > 0 ? after / before : 0;
    if (ratio < DROP.ratioMin) continue;
    const near = all.filter((onset) => Math.abs(onset.atSec - at) <= beatSec).sort((a, b) => b.strength - a.strength)[0];
    if (!near || near.strength < floor) continue;
    scored.push({ atSec: near.atSec, score: ratio * (near.strength / peak) });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || a.atSec - b.atSec);
  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  const best = scored[0] as { atSec: number; score: number };
  return { atSec: Math.round(best.atSec * 1000) / 1000, confidence: Math.round((best.score / total) * 1000) / 1000 };
}

/** Integrated loudness and true peak from FFmpeg's ebur128 filter. */
export async function loudness(file: string): Promise<{ lufs: number; truePeak: number }> {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { timeoutMs: 600_000 });
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg' });
  const summary = result.stderr.slice(result.stderr.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s*(-?[\d.]+|-inf)\s*LUFS/)?.[1] ?? Number.NaN);
  const peak = Number(summary.match(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/)?.[1] ?? Number.NaN);
  return { lufs: Number.isFinite(lufs) ? lufs : -70, truePeak: Number.isFinite(peak) ? peak : -70 };
}

interface EngineItem {
  beats?: { times?: number[] };
  downbeats?: { times?: number[]; meter?: number };
  bpm?: { value?: number; curve?: Array<{ bpm: number }> };
  sections?: { spans?: Array<{ start: number; end: number; label?: string | null }> };
}

export interface AnalyseOptions {
  /** The installed engine; the fallback runs without one. */
  engine?: Engine | null;
  forceFallback?: boolean;
  /** The file's path relative to the project, for the document. */
  relPath: string;
  onWarn?: (message: string) => void;
}

/** Analyse a track (engine audio first, fallback when it fails or finds no beats). */
export async function analyseTrack(file: string, options: AnalyseOptions): Promise<TrackAnalysisDoc> {
  const samples = await decodeMono(file);
  if (samples.length < DECODE_RATE * 4) throw new MfmError('USAGE', { file }, { message: 'The track is shorter than 4 seconds.' });
  const f = features(samples);
  let provider: TrackAnalysisDoc['provider'] = 'fallback';
  let beats: number[] = [];
  let downbeats: number[] = [];
  let bpmCurve: number[] = [];
  let meter: 3 | 4 = 4;
  let sections: TrackAnalysisDoc['sections'] = [];
  if (options.engine && !options.forceFallback) {
    try {
      const json = (await engineAudio(options.engine, file)) as { items?: EngineItem[] };
      const item = json.items?.[0];
      const times = item?.beats?.times ?? [];
      if (times.length >= 4) {
        provider = 'hyperframes-local';
        beats = times;
        meter = item?.downbeats?.meter === 3 ? 3 : 4;
        downbeats = item?.downbeats?.times?.length ? item.downbeats.times : downbeatsFrom(beats, f, meter);
        bpmCurve = (item?.bpm?.curve ?? []).map((point) => point.bpm).filter((bpm) => bpm > 0);
        if (bpmCurve.length === 0 && item?.bpm?.value) bpmCurve = [item.bpm.value];
        sections = (item?.sections?.spans ?? []).map((span) => ({ from: span.start, to: span.end, label: span.label ?? null }));
      } else {
        options.onWarn?.('The engine found no beats in this track; using the local fallback.');
      }
    } catch (error) {
      options.onWarn?.(`The engine audio analysis failed (${error instanceof Error ? error.message : String(error)}); using the local fallback.`);
    }
  }
  if (provider === 'fallback') {
    const tempo = new MusicTempo(Array.from(samples), { bufferSize: 1024, hopSize: 220, timeStep: 220 / DECODE_RATE }) as { tempo: number | string; beats: number[] };
    beats = tempo.beats;
    if (beats.length < 4) throw new MfmError('TOOL_FAILED', { file }, { message: 'No beats were found in this track.' });
    // BPM curve over 8-beat spans (less frame jitter than single intervals).
    bpmCurve = [];
    for (let i = 0; i + 8 < beats.length; i += 4) bpmCurve.push((60 * 8) / ((beats[i + 8] ?? 0) - (beats[i] ?? 0)));
    if (bpmCurve.length === 0) bpmCurve = [Number(tempo.tempo)];
    downbeats = downbeatsFrom(beats, f, meter);
    sections = sectionsFrom(downbeats, f);
  }
  const bpm = Math.round(median(bpmCurve) * 2) / 2;
  const beatSec = 60 / bpm;
  const drop = findDrop(f, sections, beats, beatSec, beatSec * meter);
  if (provider === 'fallback' && drop) {
    // A drop lands on a downbeat: re-phase the flux-chosen downbeats to the drop.
    const at = beats.reduce((best, beat, i) => (Math.abs(beat - drop.atSec) < Math.abs((beats[best] ?? 0) - drop.atSec) ? i : best), 0);
    downbeats = beats.filter((_, i) => i >= at % meter && (i - (at % meter)) % meter === 0);
    sections = sectionsFrom(downbeats, f);
  }
  const level = await loudness(file);
  const round = (values: number[]) => values.map((value) => Math.round(value * 1000) / 1000);
  return {
    schemaVersion: 1,
    kind: 'track-analysis',
    file: options.relPath,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    provider,
    bpm,
    bpmCurve: round(bpmCurve),
    beats: round(beats),
    downbeats: round(downbeats),
    meter,
    sections: sections.map((section) => ({ from: Math.round(section.from * 1000) / 1000, to: Math.round(section.to * 1000) / 1000, label: section.label })),
    drop,
    lufs: level.lufs,
    truePeak: level.truePeak,
  };
}

export interface GridFit {
  bpm: number;
  beatsPerBar: 3 | 4;
  bars: number;
  /** The track second the film starts at (first downbeat). */
  offsetSec: number;
  lengthSec: number;
  /** Cues to merge into the beat grid (`drop` as a bar spec). */
  cues: Record<string, string>;
}

/** Fit a beat grid to the analysis: bars that end before the track does, nearest the requested length. */
export function fitGrid(analysis: TrackAnalysisDoc, trackSec: number, requestedSec?: number): GridFit {
  const offsetSec = analysis.downbeats[0] ?? analysis.beats[0] ?? 0;
  const barSec = (60 / analysis.bpm) * analysis.meter;
  const maxBars = Math.max(1, Math.floor((trackSec - offsetSec) / barSec + 1e-9));
  const bars = requestedSec ? Math.min(maxBars, Math.max(1, Math.round(requestedSec / barSec))) : maxBars;
  const cues: Record<string, string> = {};
  if (analysis.drop) {
    const dropBar = Math.round((analysis.drop.atSec - offsetSec) / barSec) + 1;
    if (dropBar >= 1 && dropBar <= bars) cues.drop = `bar${dropBar}`;
  }
  return { bpm: analysis.bpm, beatsPerBar: analysis.meter, bars, offsetSec, lengthSec: Math.round(bars * barSec * 1000) / 1000, cues };
}

/** The pinned engine when it is already installed (score never installs it; doctor --fix does). */
export function installedEngine(env: NodeJS.ProcessEnv = process.env): Engine | null {
  const version = enginePins().hyperframes;
  const dir = engineDirFor(cacheDir({ env }), version);
  return engineReady(dir) ? { dir, version } : null;
}

export interface TrackScoreResult {
  track: string;
  analysis: string;
  provider: TrackAnalysisDoc['provider'];
  bpm: number;
  meter: 3 | 4;
  drop: TrackAnalysisDoc['drop'];
  lufs: number;
  truePeak: number;
  fit: GridFit;
  /** True when plan/beatgrid.json was updated to the fit. */
  gridUpdated: boolean;
}

/**
 * score --track: copy the track into sound/, analyse it, write
 * sound/track-analysis.json and fit plan/beatgrid.json to it when the grid
 * exists (bpm, meter, bars, track, the drop cue).
 */
export async function scoreTrack(project: string, source: string, options: { engine?: Engine | null; forceFallback?: boolean; onWarn?: (message: string) => void } = {}): Promise<TrackScoreResult> {
  const { copyFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { readDoc, writeDoc } = await import('../schemas/index');
  if (!existsSync(source)) throw new MfmError('USAGE', { flag: '--track', file: source }, { message: `${source} does not exist.` });
  const ext = (path.extname(source).toLowerCase() || '.wav').replace(/[^.a-z0-9]/g, '');
  const rel = `sound/track${ext}`;
  const target = path.join(project, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  if (path.resolve(source) !== path.resolve(target)) copyFileSync(source, target);
  const analysis = await analyseTrack(target, { engine: options.engine ?? null, ...(options.forceFallback ? { forceFallback: true } : {}), relPath: rel, ...(options.onWarn ? { onWarn: options.onWarn } : {}) });
  const analysisRel = 'sound/track-analysis.json';
  writeDoc('track-analysis', path.join(project, analysisRel), analysis);
  const trackSec = (await decodeMono(target)).length / DECODE_RATE;
  const gridFile = path.join(project, 'plan', 'beatgrid.json');
  let requested: number | undefined;
  let grid: Record<string, unknown> | null = null;
  if (existsSync(gridFile)) {
    grid = readDoc('beatgrid', gridFile).doc as unknown as Record<string, unknown>;
    requested = grid.requestedSec as number;
  }
  const fit = fitGrid(analysis, trackSec, requested);
  if (grid) {
    const cues = { ...(grid.cues as Record<string, unknown>), ...fit.cues };
    const next = { ...grid, bpm: fit.bpm, beatsPerBar: fit.beatsPerBar, bars: fit.bars, track: { path: rel, analysis: analysisRel, offsetSec: fit.offsetSec }, cues };
    writeDoc('beatgrid', gridFile, next as never);
  } else {
    writeFileSync(path.join(project, 'sound', 'track-fit.json'), `${JSON.stringify(fit, null, 2)}\n`);
  }
  return { track: target, analysis: path.join(project, analysisRel), provider: analysis.provider, bpm: analysis.bpm, meter: analysis.meter, drop: analysis.drop, lufs: analysis.lufs, truePeak: analysis.truePeak, fit, gridUpdated: grid !== null };
}

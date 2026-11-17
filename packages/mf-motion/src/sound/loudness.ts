// Loudness: two FFmpeg loudnorm passes per audio.loudnorm (JSON measurement,
// then linear with the measured values at 48 kHz), then ebur128 verification.
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { run } from '../proc/run';
import { dbToGain } from './synth/math';
import { loudness } from './track';

export interface LoudnormMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

async function ffmpeg(args: string[]): Promise<string> {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', ...args], { timeoutMs: 900_000 });
  if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg' });
  if (result.code !== 0) throw new MfmError('ENCODE_FAILED', { tool: 'ffmpeg', stderrTail: result.stderr.slice(-1500) }, { message: 'FFmpeg could not process the audio.' });
  return result.stderr;
}

/** The last JSON object FFmpeg printed (loudnorm print_format=json). */
function lastJson(text: string): Record<string, string> {
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new MfmError('ENCODE_FAILED', { stderrTail: text.slice(-800) }, { message: 'loudnorm printed no measurement.' });
  return JSON.parse(text.slice(start, end + 1)) as Record<string, string>;
}

/** Headroom kept under audio.truePeakMax when peaks are limited before the linear pass, in dB. */
export const LIMIT_MARGIN_DB = 1.5;

/**
 * Normalise `input` to an integrated target with two loudnorm passes (measure,
 * then linear with the measured values); writes 24-bit PCM at 48 kHz. When the
 * gain would push the true peak over audio.truePeakMax, peaks are first limited
 * (FFmpeg alimiter) so a linear pass can reach the target.
 */
export async function normaliseTo(input: string, output: string, targetLufs: number): Promise<{ lufs: number; truePeak: number }> {
  const spec = NUMBERS['audio.loudnorm'];
  const base = `I=${targetLufs}:TP=${spec.TP}:LRA=${spec.LRA}`;
  const measure = async (file: string) => lastJson(await ffmpeg(['-i', file, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']));
  let source = input;
  let measured = await measure(source);
  const gain = targetLufs - Number(measured.input_i);
  const ceiling = NUMBERS['audio.truePeakMax'] - LIMIT_MARGIN_DB;
  if (Number(measured.input_tp) + gain > ceiling) {
    // Peak ceiling in the input's own scale: after the gain it lands at the ceiling.
    const limitDb = ceiling - gain;
    const limit = Math.min(1, Math.max(0.0625, dbToGain(limitDb)));
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    source = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-limit-')), 'limited.wav');
    // Limited at 4x the sample rate, so inter-sample (true) peaks are caught too; latency=1
    // removes the 5 ms lookahead delay so the audio stays in sync with the picture.
    const rate = NUMBERS['audio.sampleRate'];
    await ffmpeg(['-y', '-i', input, '-af', `aresample=${rate * 4},alimiter=limit=${limit.toFixed(6)}:attack=5:release=60:level=0:latency=1,aresample=${rate}`, '-c:a', 'pcm_f32le', source]);
    measured = await measure(source);
  }
  const second = [
    `loudnorm=${base}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    `linear=${spec.linear ? 'true' : 'false'}`,
    'print_format=summary',
  ].join(':');
  await ffmpeg(['-y', '-i', source, '-af', second, '-ar', String(spec.sampleRate), '-c:a', 'pcm_s24le', output]);
  return loudness(output);
}

/**
 * audio.loudnorm to -14 LUFS / -1 dBTP, then verify with ebur128: outside
 * audio.lufsTolerance or above audio.truePeakMax fails ENCODE_FAILED.
 */
export async function loudnorm(input: string, output: string): Promise<{ lufs: number; truePeak: number }> {
  let measured = await normaliseTo(input, output, NUMBERS['audio.lufsTarget']);
  if (measured.truePeak > NUMBERS['audio.truePeakMax'] - 0.2) {
    // A last linear trim when the true peak overshoots or sits within 0.2 dB of the limit
    // (ebur128 reports to 0.1 dB), landing 0.3 dB under it while loudness stays in tolerance.
    const trimDb = measured.truePeak - NUMBERS['audio.truePeakMax'] + 0.3;
    if (measured.lufs - trimDb >= NUMBERS['audio.lufsTarget'] - NUMBERS['audio.lufsTolerance']) {
      const { mkdtempSync, renameSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const trimmed = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-trim-')), 'trimmed.wav');
      await ffmpeg(['-y', '-i', output, '-af', `volume=${(-trimDb).toFixed(2)}dB`, '-c:a', 'pcm_s24le', trimmed]);
      renameSync(trimmed, output);
      measured = await loudness(output);
    }
  }
  const off = Math.abs(measured.lufs - NUMBERS['audio.lufsTarget']) > NUMBERS['audio.lufsTolerance'];
  if (off || measured.truePeak > NUMBERS['audio.truePeakMax']) {
    throw new MfmError('ENCODE_FAILED', { lufs: measured.lufs, truePeak: measured.truePeak, target: NUMBERS['audio.lufsTarget'], tolerance: NUMBERS['audio.lufsTolerance'], truePeakMax: NUMBERS['audio.truePeakMax'] }, {
      message: `After normalisation the score measures ${measured.lufs} LUFS and ${measured.truePeak} dBTP (target ${NUMBERS['audio.lufsTarget']} +-${NUMBERS['audio.lufsTolerance']} LUFS, at most ${NUMBERS['audio.truePeakMax']} dBTP).`,
    });
  }
  return measured;
}

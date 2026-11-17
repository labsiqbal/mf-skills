// 24-bit PCM WAV with wavefile (stereo, audio.sampleRate).
import { WaveFile } from 'wavefile';

const FULL_SCALE = 8388607;

/** Float samples in [-1, 1] to 24-bit integers (clamped, rounded half away from zero). */
export function toPcm24(samples: Float32Array): Int32Array {
  const out = new Int32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] ?? 0;
    const c = v > 1 ? 1 : v < -1 ? -1 : v;
    const scaled = c * FULL_SCALE;
    out[i] = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  }
  return out;
}

export function encodeWav24(channels: [Float32Array, Float32Array], sampleRate: number): Uint8Array {
  const wav = new WaveFile();
  wav.fromScratch(2, sampleRate, '24', [Array.from(toPcm24(channels[0])), Array.from(toPcm24(channels[1]))]);
  return wav.toBuffer();
}

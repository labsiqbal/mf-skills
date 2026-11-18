// MFM-095: the sharp voices (click, tick, type, hit) measured from the
// generator output: crest factor at or under sfx.crestMaxDb and a body inside
// sfx.sharpBodyMs, for seeds 1-3 and the voice seeds mixSfx derives for the
// fixture cues; the other generators are byte-identical to the build before.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUMBERS } from '../../../../src/kit/numbers';
import { type SfxCueInput, type SfxRole, generateSfx, sfxShape } from '../../../../src/sound/sfx';
import { SAMPLE_RATE } from '../../../../src/sound/synth/index';
import { voiceSeed } from '../../../../src/sound/synth/math';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(here, 'sharp-cues.json'), 'utf8')) as { seed: number; cues: SfxCueInput[] };
const sr = SAMPLE_RATE;
const SHARP = ['click', 'tick', 'type', 'hit'] as const;

/** Seeds 1-3 and the seed mixSfx gives each fixture cue of the role. */
const seedsFor = (role: SfxRole) => [1, 2, 3, ...fixture.cues.flatMap((cue, i) => (cue.role === role ? [voiceSeed(fixture.seed, `sfx:${cue.role}:${cue.event}:${i}`)] : []))];

/** sha256 of each buffer and its peak offset, recorded on the build before MFM-095. */
const UNCHANGED: Record<string, string> = {
  'pop:1': 'b09ef331ffd5f2f3816c801fa6a0a5cc4f63d67825df507fcae7b765c3c5cd52:73',
  'pop:2': 'b09ef331ffd5f2f3816c801fa6a0a5cc4f63d67825df507fcae7b765c3c5cd52:73',
  'pop:3': 'b09ef331ffd5f2f3816c801fa6a0a5cc4f63d67825df507fcae7b765c3c5cd52:73',
  'whoosh:1': '234158e391b75696e19d503d443e86c2123fb0668be32c78340a92e5c06972a2:18213',
  'whoosh:2': '407f0b1b29e74c28a56413813bfaac914d8a3dccd53c553d5b8a8ee618886fe4:16881',
  'whoosh:3': 'eaaf8c563e96376ddd9e69dc1899dbfb51351e6063bbf0031d89adc7bcb14264:18906',
  'shimmer:1': 'e0f37985b07ee1cf66b900e02fe6d1ab893e2d5e07b6d43455c7ede7a38d1bf4:6070',
  'shimmer:2': '2a29c6db88f486e916046279f2ec80d89015f6f3478b68572a7eef0f333a612d:5859',
  'shimmer:3': 'aa00e9ff5660e6000c62723b2b65c7efd4b1aba38b8287f8a76769c55f6f082c:5868',
  'riser:1': 'ffc3273b4e789ca4f5f383373e5c988a9f19e6b3446c347a02d6a420f2ceed44:89442',
  'riser:2': '964ea9476bd7dae8a1baa8f7cf4ba0e8b740c842e6ea73159421f5fbb323fc07:91256',
  'riser:3': 'af6a588432e72a117ced5d2e553f2faa11d2356759661caea34f52f4abe960a5:94444',
};

describe('sharp SFX voicing', () => {
  it.each(SHARP)('%s keeps its crest factor at or under sfx.crestMaxDb and its body inside sfx.sharpBodyMs', (role) => {
    const body = NUMBERS['sfx.sharpBodyMs'];
    const limit = NUMBERS['sfx.crestMaxDb'][role];
    const seeds = seedsFor(role);
    expect(seeds.length).toBeGreaterThanOrEqual(4);
    for (const seed of seeds) {
      const generated = generateSfx(role, sr, seed);
      const shape = sfxShape(generated.buffer, sr);
      console.log(`${role} seed ${seed}: crest ${shape.crestDb} dB, body ${shape.bodyMs} ms, peak ${((generated.peakOffset / sr) * 1000).toFixed(1)} ms`);
      expect(shape.crestDb, `${role} seed ${seed}`).toBeLessThanOrEqual(limit);
      expect(shape.bodyMs, `${role} seed ${seed}`).toBeGreaterThanOrEqual(body.min);
      expect(shape.bodyMs, `${role} seed ${seed}`).toBeLessThanOrEqual(body.max);
      // The peak offset is the buffer's true peak.
      const peak = Math.max(...Array.from(generated.buffer, Math.abs));
      expect(Math.abs(generated.buffer[generated.peakOffset] ?? 0)).toBe(peak);
    }
  });

  it('pop, whoosh, shimmer and riser are byte-identical to the build before the re-voicing', () => {
    for (const [key, want] of Object.entries(UNCHANGED)) {
      const [role, seed] = key.split(':') as [SfxRole, string];
      const generated = generateSfx(role, sr, Number(seed));
      expect(`${createHash('sha256').update(Buffer.from(generated.buffer.buffer)).digest('hex')}:${generated.peakOffset}`, key).toBe(want);
    }
  });
});

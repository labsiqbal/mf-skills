import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import { transcribeModelCheck } from '../../../src/doctor/index';
import { transcribe } from '../../../src/engine/index';
import { verifiedWhisperModel, WHISPER_FIX } from '../../../src/moves/transcribe';
import { fakeEngine } from '../engine/fake-engine';

vi.mock('../../../src/moves/transcribe', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/moves/transcribe')>(),
  verifiedWhisperModel: vi.fn(),
}));

describe('doctor Whisper model row', () => {
  const engine = { dir: '/unused', version: '0.9.61' };
  const options = { fix: false, env: {} };

  it('offers the fix when a default model is missing', async () => {
    vi.mocked(verifiedWhisperModel).mockImplementation(async (_, model) => model === 'small' ? 'small.bin' : null);
    await expect(transcribeModelCheck(engine, options)).resolves.toMatchObject({
      id: 'transcribe-model', status: 'optional', found: null, fix: `${WHISPER_FIX} --json`,
    });
  });

  it('reports ok when both default models verify', async () => {
    vi.mocked(verifiedWhisperModel).mockImplementation(async (_, model) => `${model}.bin`);
    await expect(transcribeModelCheck(engine, options)).resolves.toMatchObject({
      id: 'transcribe-model', status: 'ok', found: 'small, base.en', fix: null,
    });
  });

  it('surfaces a verified hash mismatch as a failing row', async () => {
    vi.mocked(verifiedWhisperModel).mockRejectedValue(new MfmError('MODEL_HASH_MISMATCH', { model: 'small' }));
    await expect(transcribeModelCheck(engine, options)).resolves.toMatchObject({
      id: 'transcribe-model', status: 'missing', found: 'MODEL_HASH_MISMATCH: small', fix: `${WHISPER_FIX} --json`,
    });
  });
});

describe('the Whisper adapter', () => {
  it('uses local Whisper without installation unless the caller opts in', async () => {
    const engine = fakeEngine();
    try {
      await transcribe(engine, 'talk.mp4', { model: 'base.en', language: 'en' });
      expect(engine.lastArgs()).toEqual([
        'transcribe', 'talk.mp4', '--json', '--engine', 'whisper', '--no-runtime-install',
        '--model', 'base.en', '--language', 'en',
      ]);
      await transcribe(engine, 'probe.wav', { engine: 'whisper', model: 'small', runtimeInstall: true });
      expect(engine.lastArgs()).toEqual([
        'transcribe', 'probe.wav', '--json', '--engine', 'whisper', '--runtime-install', '--model', 'small',
      ]);
    } finally {
      rmSync(engine.dir, { recursive: true, force: true });
    }
  });

  it('preserves the pinned engine’s missing-runtime reason', async () => {
    const engine = fakeEngine();
    try {
      writeFileSync(path.join(engine.dir, 'node_modules/hyperframes/bin/hyperframes.cjs'), `
        console.log(JSON.stringify({ok:false, skipped:true, reason:"whisper_unavailable"}));
        process.exitCode = 1;
      `);
      await expect(transcribe(engine, 'talk.mp4')).rejects.toMatchObject({ details: { engineCode: 'whisper_unavailable' } });
    } finally {
      rmSync(engine.dir, { recursive: true, force: true });
    }
  });
});

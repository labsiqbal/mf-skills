// Every flag the adapter passes must appear in the engine help recorded for
// the pinned version. The fake engine echoes the arguments each call passes.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADAPTER_FLAGS,
  audio,
  capture,
  check,
  enginePins,
  packageRoot,
  removeBackground,
  render,
  snapshotAt,
  snapshotReview,
  transcribe,
  tts,
} from '../../../src/engine/index';
import { fakeEngine } from './fake-engine';

const fixtures = path.join(packageRoot(), 'src', 'engine', 'fixtures', `help-${enginePins().hyperframes}`);
const helpFlags = (command: string) => new Set(readFileSync(path.join(fixtures, `${command}.txt`), 'utf8').match(/--[a-z][a-z0-9-]*/g) ?? []);

describe('recorded engine help', () => {
  it('exists for every engine command the adapter calls', () => {
    for (const command of Object.keys(ADAPTER_FLAGS)) expect(existsSync(path.join(fixtures, `${command}.txt`)), command).toBe(true);
  });

  it('lists every flag the adapter declares', () => {
    for (const [command, flags] of Object.entries(ADAPTER_FLAGS)) {
      const known = helpFlags(command);
      for (const flag of flags) expect(known.has(flag), `${command} ${flag}`).toBe(true);
    }
  });

  it('lists every flag the adapter functions actually pass', async () => {
    const engine = fakeEngine();
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    const calls: Array<() => Promise<unknown>> = [
      () => check(engine, build, { at: [1, 2] }),
      () => snapshotReview(engine, build, path.join(build, 'review')),
      () => snapshotAt(engine, build, [1.5], path.join(build, 'stills')),
      () => render(engine, build, { format: 'png-sequence', fps: '30000/1001', output: path.join(build, 'frames'), workers: 2 }),
      () => capture(engine, { url: 'https://example.com' }, path.join(build, 'capture')),
      () => capture(engine, { localFile: 'site/index.html', localRoot: 'site' }, path.join(build, 'capture-local')),
      () => audio(engine, 'track.wav'),
      () => tts(engine, 'script.txt', 'af_heart', path.join(build, 'voice.wav')),
      () => transcribe(engine, 'talk.mp4', { model: 'base.en', language: 'en' }),
      () => removeBackground(engine, 'in.png', path.join(build, 'out.png')),
    ];
    for (const call of calls) {
      await call();
      const args = engine.lastArgs();
      const command = args[0] ?? '';
      const known = helpFlags(command);
      for (const flag of args.filter((arg) => arg.startsWith('--'))) {
        expect(known.has(flag), `${command} ${flag} in recorded help`).toBe(true);
        expect(ADAPTER_FLAGS[command], `${command} declares ${flag}`).toContain(flag);
      }
    }
  });
});

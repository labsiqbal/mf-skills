import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { engineDirFor, packageRoot } from '../../../../src/engine/index';
import { verifiedWhisperModel } from '../../../../src/moves/transcribe';
import { npmCli } from '../../../../src/proc/npmBin';
import { run } from '../../../../src/proc/run';
import { testBrowser } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

it.skipIf(process.env.MFM_TRANSCRIBE_REQUIRED === undefined)(
  'doctor --fix --transcribe prefetches and verifies both default models in a cold engine cache',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mfm-whisper-integration-'));
    try {
      const installed = (await testBrowser()).engine;
      const cache = path.join(root, 'cache');
      const engine = { version: installed.version, dir: engineDirFor(cache, installed.version) };
      mkdirSync(engine.dir, { recursive: true, mode: 0o700 });
      // Reuse only the pinned CLI and browser. The engine has an empty Whisper cache.
      symlinkSync(path.join(installed.dir, 'node_modules'), path.join(engine.dir, 'node_modules'), 'junction');
      copyFileSync(path.join(installed.dir, '.ok'), path.join(engine.dir, '.ok'));
      mkdirSync(path.join(engine.dir, 'hf-config'));
      writeFileSync(path.join(engine.dir, 'hf-config', 'config.json'), '{}\n');
      expect(existsSync(path.join(engine.dir, 'hf-cache', 'whisper'))).toBe(false);
      const packed = await run(process.execPath, [npmCli(), 'pack', '--ignore-scripts', '--pack-destination', root], {
        cwd: packageRoot(), timeoutMs: 120_000, killTree: true,
      });
      expect(packed.code, packed.stderr).toBe(0);
      const filename = readdirSync(root).find((name) => name.endsWith('.tgz'));
      expect(filename).toBeDefined();
      const result = await runIn(['doctor', '--fix', '--transcribe', '--cli-tarball', path.join(root, filename!), '--json'], COMMANDS, {
        ...process.env, MF_MOTION_CACHE: cache, MF_MOTION_HOME: path.join(root, 'home'),
      });
      expect(result.code, result.stdout || result.stderr).toBe(0);
      const { data } = JSON.parse(result.stdout);
      expect(data.checks).toContainEqual(expect.objectContaining({ id: 'transcribe-model', status: 'ok', found: 'small, base.en' }));
      await expect(verifiedWhisperModel(engine, 'small')).resolves.toBeTruthy();
      await expect(verifiedWhisperModel(engine, 'base.en')).resolves.toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  },
  2_400_000,
);

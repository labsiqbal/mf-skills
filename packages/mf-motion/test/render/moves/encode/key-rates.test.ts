import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { NUMBERS } from '../../../../src/kit/numbers';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

beforeAll(async () => { await testBrowser(); }, 900_000);

it.each(NUMBERS['fps.move.footageRates'])('keeps the Ink Underline key background clean at %s fps', async (fps) => {
  const out = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-key-rate-')));
  const result = await runIn([
    'move', 'render', 'ink-underline', '--brand', 'demo:tessarine', '--aspect', '16:9', '--mode', 'key',
    '--duration', '3.2', '--fps', fps, '--formats', 'key-mp4', '--out', out, '--json',
  ], COMMANDS, { ...process.env, MF_MOTION_CACHE: testCacheRoot() });
  expect(result.code, result.stdout + result.stderr).toBe(0);
  const { outputs } = JSON.parse(result.stdout).data;
  expect(outputs).toMatchObject([{ format: 'key-mp4', keyPurity: { pass: true, impurePixels: 0 } }]);
  expect(outputs[0].keyPurity.checkedPixels).toBeGreaterThan(1920 * 1080);
});

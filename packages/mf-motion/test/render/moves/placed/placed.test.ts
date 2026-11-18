import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { enginePins, packageRoot } from '../../../../src/engine/index';
import { probe } from '../../../../src/media/probe';
import type { Output } from '../../../../src/moves/encode';
import { readEvents } from '../../../../src/paths/index';
import { run } from '../../../../src/proc/run';
import { gate } from '../../../../src/quality/gate';
import { testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';

it('renders the three approved seeds and names overlay, b-roll and preview files at 25 fps', async () => {
  const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-placed-render-')));
  const root = path.join(scratch, 'project');
  const home = path.join(scratch, 'home');
  cpSync(path.join(packageRoot(), 'test/fixtures/projects/moves'), root, { recursive: true });
  cpSync(path.join(packageRoot(), 'assets/demo-brands/tessarine'), path.join(home, 'brands/tessarine'), { recursive: true });
  const cli = (...args: string[]) => runIn([...args, '--project', root, '--home', home, '--json'], COMMANDS, {
    ...process.env, MF_MOTION_CACHE: testCacheRoot(),
  });

  const checked = await cli('placement', 'check');
  expect(checked.code, checked.stdout).toBe(0);
  const approved = await cli('approve', '--subject', 'placement', '--text', 'Yes, render all three.');
  expect(approved.code, approved.stdout).toBe(0);

  const result = await cli('moves', 'render');
  expect(result.code, result.stdout + result.stderr).toBe(0);
  const { items } = JSON.parse(result.stdout).data as { items: Array<{ id: string; move: string; outputs: Output[]; verdict: string | null }> };
  expect(items.map((item) => [item.id, item.move, item.verdict])).toEqual([
    ['p01', 'title-lockup', null], ['p02', 'ink-underline', null], ['p03', 'three-step-flow', null],
  ]);
  expect(items.map((item) => item.outputs.map((output) => [output.format, path.basename(output.path)]))).toEqual([
    [['mov', '00m00s12f_title-lockup_alpha.mov'], ['mp4', '00m00s12f_title-lockup_alpha-preview.mp4']],
    [['mov', '00m04s24f_ink-underline_alpha.mov'], ['mp4', '00m04s24f_ink-underline_alpha-preview.mp4']],
    [['mp4', '00m09s15f_three-step-flow_full.mp4'], ['mp4', '00m09s15f_three-step-flow_full-preview.mp4']],
  ]);
  for (const item of items) {
    for (const output of item.outputs) {
      expect(path.dirname(output.path)).toBe(path.join(root, 'moves', item.id));
      expect(output.bytes).toBeGreaterThan(0);
      const info = await probe(output.path);
      expect(info.video?.fps.value).toBe(25);
      expect(info.video?.width).toBe(1920);
      expect(info.video?.height).toBe(1080);
      expect(info.video?.hasAlpha).toBe(output.format === 'mov');
    }
  }
  expect(readEvents(root).at(-1)).toMatchObject({ type: 'render.finished', data: { ids: ['p01', 'p02', 'p03'] } });

  const overlayPath = items[0]!.outputs[0]!.path;
  const alpha = await run('ffmpeg', [
    '-v', 'error', '-ss', '1.5', '-i', overlayPath, '-frames:v', '1',
    '-vf', 'alphaextract,format=yuv444p,signalstats,metadata=mode=print:key=lavfi.signalstats.YMIN:file=-',
    '-f', 'null', '-',
  ], { timeoutMs: 60_000 });
  expect(alpha.code, alpha.stderr).toBe(0);
  expect(alpha.stdout).toMatch(/signalstats.YMIN=0(?:\s|$)/);
  const gated = await cli('moves', 'render', '--only', 'p01', '--gate');
  expect(gated.code, gated.stdout + gated.stderr).toBe(0);
  expect(JSON.parse(gated.stdout).data.items).toMatchObject([{ id: 'p01', verdict: null }]);
  const round = path.join(root, 'moves', 'p01', 'round');
  for (const file of ['lint.json', 'audit.json', 'metrics.json', 'packet/packet.json']) expect(existsSync(path.join(round, file)), file).toBe(true);
  expect(JSON.parse(gated.stdout).next[0]).toContain('scores.json');
  const packet = JSON.parse(readFileSync(path.join(round, 'packet/packet.json'), 'utf8'));
  const scores = JSON.parse(readFileSync(path.join(packageRoot(), 'test/fixtures/scores/seed-self-8.json'), 'utf8'));
  writeFileSync(path.join(round, 'scores.json'), JSON.stringify({ ...scores, packetHash: packet.hash }));
  const verdict = gate({ roundDir: round, round: 1, target: 8, engine: enginePins().hyperframes, cli: '1.0.0' }).verdict;
  expect(verdict.hardFailures).toEqual([]);
  expect(verdict.level).toBe('PASS-SELF');
}, 600_000);

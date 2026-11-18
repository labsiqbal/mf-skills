import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { safeBoxes } from '../../../../../src/kit/safe';
import { buildMove } from '../../../../../src/moves/build';
import { audit } from '../../../../../src/quality/audit';
import { testBrowser } from '../../../../helpers/engine';
import { seedAcceptance } from '../message-cascade/seed-acceptance';

seedAcceptance('ranked-bars', { category: 'data', uses: ['broll'] });

it('keeps every ranked value and the leader stamp visible in portrait', async () => {
  const { engine, browserPath } = await testBrowser();
  const temp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-ranking-portrait-')));
  try {
    const aspect = '9:16';
    const result = await buildMove({ id: 'ranked-bars', brand: 'demo:tessarine', aspect, mode: 'full', out: path.join(temp, 'out'), home: path.join(temp, 'home'), engine });
    const report = await audit(result.build, { aspect, profile: 'broll', engine, browserPath });
    const rankedLines = report.lines.filter(({ elementId }) => /^rb-(?:leader|(?:name|value)-\d-sorted)$/.test(elementId));
    expect(rankedLines).toHaveLength(7);
    const copy = safeBoxes(aspect, 'broll').copy;
    const clipped = rankedLines.filter(({ box }) =>
      !box || box.x < copy.x || box.x + box.width > copy.x + copy.width ||
      box.y < copy.y || box.y + box.height > copy.y + copy.height,
    );
    expect(clipped.map(({ elementId }) => elementId)).toEqual([]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

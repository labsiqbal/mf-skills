import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { safeBoxes } from '../../../../../src/kit/safe';
import { buildMove } from '../../../../../src/moves/build';
import { audit } from '../../../../../src/quality/audit';
import { testBrowser } from '../../../../helpers/engine';
import { seedAcceptance } from '../message-cascade/seed-acceptance';

seedAcceptance('revenue-step', { category: 'business', uses: ['broll'] });

it('keeps all four quarters and the Q4 change visible in portrait', async () => {
  const { engine, browserPath } = await testBrowser();
  const temp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-revenue-portrait-')));
  try {
    const aspect = '9:16';
    const result = await buildMove({ id: 'revenue-step', brand: 'demo:mossmallow', aspect, mode: 'full', out: path.join(temp, 'out'), home: path.join(temp, 'home'), engine });
    const report = await audit(result.build, { aspect, profile: 'broll', engine, browserPath });
    const chartLines = report.lines.filter(({ elementId }) => /^rs-(?:quarter-\d|value-\d|change)$/.test(elementId));
    expect(chartLines).toHaveLength(9);
    const copy = safeBoxes(aspect, 'broll').copy;
    const clipped = chartLines.filter(({ box }) =>
      !box || box.x < copy.x || box.x + box.width > copy.x + copy.width ||
      box.y < copy.y || box.y + box.height > copy.y + copy.height,
    );
    expect(clipped.map(({ elementId }) => elementId)).toEqual([]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

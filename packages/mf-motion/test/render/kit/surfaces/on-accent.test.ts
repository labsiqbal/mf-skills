// Text on an accent fill takes the token that contrasts most with the accent,
// and for every demo brand that pair meets contrast.textMin.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveCtx } from '../../../../src/kit/build/move';
import { onAccent } from '../../../../src/kit/build/surfaces';
import { NUMBERS } from '../../../../src/kit/numbers';
import { contrastRatio, parseHex } from '../../../../src/kit/oklch';
import { packageRoot } from '../type/page';

describe('on-accent text', () => {
  it('names the best-contrast token and reads on every demo brand', () => {
    const expected: Record<string, string> = { tessarine: 'var(--mf-ground)', mossmallow: 'var(--mf-surface)', quillfen: 'var(--mf-surface)' };
    for (const [brand, token] of Object.entries(expected)) {
      const doc = JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', brand, 'brand.json'), 'utf8'));
      const ctx = moveCtx({ aspect: '16:9', mode: 'full', layer: 'broll', brand: doc, seed: 1, durationSec: 1 });
      expect(onAccent(ctx), brand).toBe(token);
      const name = token.slice(4, -1).replace('--mf-', '') as 'ground' | 'surface' | 'ink';
      expect(contrastRatio(parseHex(ctx.brand.colors.accent), parseHex(ctx.brand.colors[name])), brand).toBeGreaterThanOrEqual(NUMBERS['contrast.textMin']);
    }
  });
});

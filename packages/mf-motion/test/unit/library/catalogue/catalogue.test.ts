import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { packageRoot } from '../../../../src/engine/pins';
import { catalogueFiles, catalogueTokens, readCatalogue } from '../../../../src/library/catalogue';
import { libraryMoves } from '../../../../src/library/registry';
import { porterStem, searchCatalogue } from '../../../../src/library/search';
import { CATEGORIES } from '../../../../src/schemas/move-meta';
import { runIn } from '../../cli/harness';

const entries = libraryMoves();
const moves = entries.map(({ meta }) => meta);
const social = moves.find(({ id }) => id === 'message-cascade')!;
const dist = path.join(packageRoot(), 'dist', 'catalog');

describe('built catalogue', () => {
  it('ships one seed per category and a bounded index', () => {
    const generated = catalogueFiles(moves);
    expect(generated.index).toContain('10 moves in 10 categories');
    expect(catalogueTokens(generated.index)).toBeLessThan(1000);
    for (const category of CATEGORIES) {
      expect(generated.index).toContain(`${category} (1):`);
      const expected = moves.find((meta) => meta.category === category)!;
      const file = readFileSync(path.join(dist, `${category}.md`), 'utf8');
      expect(file).toEqual(generated[category]);
      expect(file.trimEnd().split('\n')).toHaveLength(1);
      expect(file).toMatch(new RegExp(`^- ${expected.id} \\|`));
    }
    expect(generated.social).toMatch(/overlay, broll \| alpha, key, full \| overlay 16:9, 9:16\n$/);
  });

  it('fails a build with a 40-entry category over its token budget', () => {
    const overBudget = Array.from({ length: 40 }, (_, i) => ({
      ...social,
      id: `move-${i}`,
      say: ['x'.repeat(80), 'y'.repeat(80)],
    }));
    expect(() => catalogueFiles(overBudget)).toThrow(/Catalogue social uses \d+ tokens \(limit 1500\)/);
  });

  it('filters square overlays and appends user moves without rewriting the built file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-catalogue-'));
    try {
      const built = catalogueFiles(moves).social;
      const file = path.join(dir, 'social.md');
      writeFileSync(file, built);
      const user = { ...entries.find(({ meta }) => meta.id === social.id)!, source: 'user' as const,
        meta: { ...social, id: 'personal-chat', overlayAspects: ['1:1'] as const },
      };
      const result = readCatalogue([...entries, { ...user, meta: { ...user.meta, overlayAspects: [...user.meta.overlayAspects] } }],
        { category: 'social', use: 'overlay', aspect: '1:1' }, dir);
      expect(result.text).toMatch(/^- personal-chat /);
      expect(result.text).not.toContain('message-cascade');
      expect(result.tokens).toBe(catalogueTokens(result.text));
      expect(readFileSync(file, 'utf8')).toBe(built);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('catalogue search', () => {
  it('stems message variants and ranks the chat seed first', async () => {
    expect(['message', 'messages', 'messaged', 'messaging'].map(porterStem)).toEqual(['messag', 'messag', 'messag', 'messag']);
    expect(searchCatalogue(moves, 'they messaged me')[0]?.id).toBe('message-cascade');
    const result = await runIn(['catalog', 'search', 'they', 'messaged', 'me', '--limit', '1', '--json'], COMMANDS);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data.results).toEqual([expect.objectContaining({ id: 'message-cascade', category: 'social' })]);
  });

  it('reads a category through the CLI and validates filters', async () => {
    const result = await runIn(['catalog', 'system', '--aspect', '1:1', '--use', 'overlay', '--json'], COMMANDS);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data.text).toMatch(/^- title-lockup /);
    const invalid = await runIn(['catalog', 'unknown', '--json'], COMMANDS);
    expect(invalid.code).toBe(2);
  });
});

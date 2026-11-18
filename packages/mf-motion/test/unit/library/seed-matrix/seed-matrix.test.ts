// MFM-098: the seed matrix in CI (testing.md, Seed matrix in CI). Both OS
// offsets cover every demo brand, aspect and mode; the two assignments differ
// for most seeds; the sample is deterministic; and every registered seed
// matches its planned row, so a seed ticket that changes its meta updates
// SEED_TABLE in the same commit.
import { describe, expect, it } from 'vitest';
import { libraryMoves } from '../../../../src/library/registry';
import { DEMO_BRANDS } from '../../../../src/schemas/move-meta';
import { ASPECT_ORDER, MODE_ORDER, SEED_TABLE, type SeedCase, casesToRegister, rowOfMeta, sampleAssignment, seedCases, seedMatrixSetting } from '../../../helpers/seed-matrix';

const key = (c: SeedCase) => `${c.brand} ${c.aspect} ${c.mode}`;
const sorted = (values: readonly string[]) => [...values].sort();
const SEED_IDS = [
  'message-cascade',
  'follower-milestone',
  'prompt-to-result',
  'terminal-run',
  'task-checkoff',
  'revenue-step',
  'ranked-bars',
  'ink-underline',
  'title-lockup',
  'three-step-flow',
];

describe('SEED_TABLE', () => {
  it('lists the ten seeds in seed-table order, overlay aspects within aspects', () => {
    expect(SEED_TABLE.map((row) => row.id)).toEqual(SEED_IDS);
    for (const row of SEED_TABLE) {
      for (const aspect of row.overlayAspects) expect(row.aspects, row.id).toContain(aspect);
      expect(seedCases(row).length, row.id).toBeGreaterThan(0);
    }
  });

  it('enumerates brand x aspect x declared mode, overlay modes only over the overlay aspects', () => {
    const full = seedCases({ modes: ['full', 'alpha', 'key'], aspects: ['1:1', '16:9', '9:16'], overlayAspects: ['16:9', '9:16'] });
    expect(full).toHaveLength(3 * (3 + 2 * 2));
    expect(full.filter((c) => c.aspect === '1:1').map((c) => c.mode)).toEqual(['full', 'full', 'full']);
    expect(full.slice(0, 3).map(key)).toEqual(['tessarine 16:9 full', 'tessarine 16:9 alpha', 'tessarine 16:9 key']);
    expect(seedCases({ modes: ['full'], aspects: ASPECT_ORDER, overlayAspects: ASPECT_ORDER })).toHaveLength(9);
  });

  it('every registered seed has its row, and its meta matches the row', () => {
    const library = libraryMoves().map((entry) => entry.meta);
    const registered = library.filter((meta) => meta.status === 'seed' || SEED_IDS.includes(meta.id));
    expect(registered.length).toBeGreaterThan(0);
    for (const meta of registered) {
      const row = SEED_TABLE.find((candidate) => candidate.id === meta.id);
      expect(row, `${meta.id} is missing from SEED_TABLE`).toBeDefined();
      if (!row) continue;
      const built = rowOfMeta(meta);
      expect(built.category, meta.id).toBe(row.category);
      expect(sorted(built.uses), `${meta.id} uses`).toEqual(sorted(row.uses));
      expect(sorted(built.modes), `${meta.id} modes`).toEqual(sorted(row.modes));
      expect(sorted(built.aspects), `${meta.id} aspects`).toEqual(sorted(row.aspects));
      expect(sorted(built.overlayAspects), `${meta.id} overlay aspects`).toEqual(sorted(row.overlayAspects));
    }
  });
});

describe('sampleAssignment', () => {
  const offsets = [0, 1] as const;

  it.each(offsets)('offset %i gives every seed one of its own cases and covers every brand, aspect and mode', (offset) => {
    const assignment = sampleAssignment(SEED_TABLE, offset);
    expect([...assignment.keys()].sort()).toEqual([...SEED_IDS].sort());
    for (const row of SEED_TABLE) expect(seedCases(row).map(key), row.id).toContain(key(assignment.get(row.id) as SeedCase));
    const cases = [...assignment.values()];
    expect(sorted([...new Set(cases.map((c) => c.brand))])).toEqual(sorted(DEMO_BRANDS));
    expect(sorted([...new Set(cases.map((c) => c.aspect))])).toEqual(sorted(ASPECT_ORDER));
    expect(sorted([...new Set(cases.map((c) => c.mode))])).toEqual(sorted(MODE_ORDER));
  });

  it('the two offsets differ for at least five of the ten seeds', () => {
    const a = sampleAssignment(SEED_TABLE, 0);
    const b = sampleAssignment(SEED_TABLE, 1);
    const differing = SEED_TABLE.filter((row) => key(a.get(row.id) as SeedCase) !== key(b.get(row.id) as SeedCase));
    expect(differing.length).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic', () => {
    for (const offset of offsets) {
      const first = [...sampleAssignment(SEED_TABLE, offset)].map(([id, c]) => `${id}: ${key(c)}`);
      const again = [...sampleAssignment([...SEED_TABLE], offset)].map(([id, c]) => `${id}: ${key(c)}`);
      expect(again).toEqual(first);
    }
  });

  it('still covers every value when a seed drops its 1:1 overlay cases', () => {
    const table = SEED_TABLE.map((row) => (row.id === 'message-cascade' ? { ...row, overlayAspects: ['16:9', '9:16'] as const } : row));
    for (const offset of offsets) {
      const cases = [...sampleAssignment(table, offset).values()];
      expect(new Set(cases.map((c) => c.aspect)).size).toBe(3);
      expect(new Set(cases.map((c) => c.mode)).size).toBe(3);
      expect(new Set(cases.map((c) => c.brand)).size).toBe(3);
    }
  });
});

describe('seed matrix setting', () => {
  it('reads MFM_SEED_MATRIX (unset means full) and MFM_SEED_OFFSET (default 0)', () => {
    expect(seedMatrixSetting({})).toEqual({ matrix: 'full', offset: 0 });
    expect(seedMatrixSetting({ MFM_SEED_MATRIX: 'sample', MFM_SEED_OFFSET: '1' })).toEqual({ matrix: 'sample', offset: 1 });
    expect(() => seedMatrixSetting({ MFM_SEED_MATRIX: 'some' })).toThrow(/full or sample/);
    expect(() => seedMatrixSetting({ MFM_SEED_OFFSET: '2' })).toThrow(/0 or 1/);
  });

  it('registers every case under full and the assigned case under sample', () => {
    for (const meta of libraryMoves().map((entry) => entry.meta).filter((m) => m.status === 'seed')) {
      expect(casesToRegister(meta, { matrix: 'full', offset: 0 })).toEqual(seedCases(rowOfMeta(meta)));
      for (const offset of [0, 1] as const) {
        const one = casesToRegister(meta, { matrix: 'sample', offset });
        expect(one).toHaveLength(1);
        expect(key(one[0] as SeedCase)).toBe(key(sampleAssignment(SEED_TABLE, offset).get(meta.id) as SeedCase));
      }
    }
  });
});

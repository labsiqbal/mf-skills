// The seed matrix (testing.md, Seed matrix in CI): the planned seed table, the
// cases one seed renders (demo brand x aspect x declared mode, alpha and key
// over the overlay aspects) and the per-OS sample of one case per seed. Pure:
// no registry, engine or file access, so the unit test and the render
// acceptance share it.
import { DEMO_BRANDS } from '../../src/schemas/move-meta';

export type SeedAspect = '16:9' | '9:16' | '1:1';
export type SeedMode = 'full' | 'alpha' | 'key';
export type SeedBrand = (typeof DEMO_BRANDS)[number];

export interface SeedRow {
  id: string;
  category: string;
  uses: readonly ('overlay' | 'broll')[];
  modes: readonly SeedMode[];
  aspects: readonly SeedAspect[];
  /** Aspects the overlay modes (alpha, key) build over; a subset of aspects. */
  overlayAspects: readonly SeedAspect[];
}

export interface SeedCase {
  brand: SeedBrand;
  aspect: SeedAspect;
  mode: SeedMode;
}

/** Fixed enumeration orders, so a case list never depends on how a meta orders its arrays. */
export const ASPECT_ORDER: readonly SeedAspect[] = ['16:9', '9:16', '1:1'];
export const MODE_ORDER: readonly SeedMode[] = ['full', 'alpha', 'key'];
const OVERLAY_MODES: readonly SeedMode[] = ['alpha', 'key'];

const ALL: readonly SeedAspect[] = ASPECT_ORDER;
const overlayAndBroll = (id: string, category: string): SeedRow => ({ id, category, uses: ['overlay', 'broll'], modes: ['full', 'alpha', 'key'], aspects: ALL, overlayAspects: ALL });
const brollOnly = (id: string, category: string): SeedRow => ({ id, category, uses: ['broll'], modes: ['full'], aspects: ALL, overlayAspects: ALL });
const overlayOnly = (id: string, category: string): SeedRow => ({ id, category, uses: ['overlay'], modes: ['alpha', 'key'], aspects: ALL, overlayAspects: ALL });

/**
 * The ten seeds in move-contract.md seed-table order with their planned uses,
 * modes, aspects and overlay aspects. A seed ticket that changes its built
 * meta updates its row in the same commit (the seed-matrix unit test checks it).
 */
export const SEED_TABLE: readonly SeedRow[] = [
  // MFM-099: 1:1 overlay lines of 2-11 graphemes beside the face band; 1:1 is b-roll only.
  { ...overlayAndBroll('message-cascade', 'social'), overlayAspects: ['16:9', '9:16'] },
  overlayAndBroll('follower-milestone', 'creator'),
  brollOnly('prompt-to-result', 'ai'),
  brollOnly('terminal-run', 'dev'),
  overlayAndBroll('task-checkoff', 'productivity'),
  brollOnly('revenue-step', 'business'),
  brollOnly('ranked-bars', 'data'),
  overlayOnly('ink-underline', 'paper'),
  overlayAndBroll('title-lockup', 'system'),
  brollOnly('three-step-flow', 'explain'),
];

/** Every case of one seed, brand then aspect then mode, in the fixed orders. */
export function seedCases(row: Pick<SeedRow, 'modes' | 'aspects' | 'overlayAspects'>): SeedCase[] {
  const cases: SeedCase[] = [];
  const aspects = ASPECT_ORDER.filter((aspect) => row.aspects.includes(aspect));
  const modes = MODE_ORDER.filter((mode) => row.modes.includes(mode));
  for (const brand of DEMO_BRANDS) {
    for (const aspect of aspects) {
      for (const mode of modes) {
        if (OVERLAY_MODES.includes(mode) && !row.overlayAspects.includes(aspect)) continue;
        cases.push({ brand, aspect, mode });
      }
    }
  }
  return cases;
}

/**
 * One case per seed for an OS offset (0 or 1). Offset 0 walks the table in
 * order, offset 1 in reverse; each seed takes the case that covers the most
 * brand, aspect and mode values not yet covered, ties broken by rotating
 * through its cases from its table index plus the offset. Deterministic.
 */
export function sampleAssignment(table: readonly SeedRow[], offset: number): Map<string, SeedCase> {
  const order = table.map((row, index) => ({ row, index }));
  if (offset % 2 === 1) order.reverse();
  const covered = { brand: new Set<string>(), aspect: new Set<string>(), mode: new Set<string>() };
  const assignment = new Map<string, SeedCase>();
  for (const { row, index } of order) {
    const cases = seedCases(row);
    if (cases.length === 0) continue;
    const gain = (c: SeedCase) => Number(!covered.brand.has(c.brand)) + Number(!covered.aspect.has(c.aspect)) + Number(!covered.mode.has(c.mode));
    const best = Math.max(...cases.map(gain));
    const start = (index + offset) % cases.length;
    let chosen = cases[start] as SeedCase;
    for (let step = 0; step < cases.length; step += 1) {
      const candidate = cases[(start + step) % cases.length] as SeedCase;
      if (gain(candidate) === best) {
        chosen = candidate;
        break;
      }
    }
    covered.brand.add(chosen.brand);
    covered.aspect.add(chosen.aspect);
    covered.mode.add(chosen.mode);
    assignment.set(row.id, chosen);
  }
  return assignment;
}

export interface SeedMatrixSetting {
  matrix: 'full' | 'sample';
  offset: 0 | 1;
}

/** MFM_SEED_MATRIX (full or sample; unset means full) and MFM_SEED_OFFSET (0 or 1; default 0). */
export function seedMatrixSetting(env: Record<string, string | undefined> = process.env): SeedMatrixSetting {
  const matrix = env.MFM_SEED_MATRIX === undefined || env.MFM_SEED_MATRIX === '' ? 'full' : env.MFM_SEED_MATRIX;
  if (matrix !== 'full' && matrix !== 'sample') throw new Error(`MFM_SEED_MATRIX must be full or sample, not ${matrix}`);
  const rawOffset = env.MFM_SEED_OFFSET === undefined || env.MFM_SEED_OFFSET === '' ? '0' : env.MFM_SEED_OFFSET;
  if (rawOffset !== '0' && rawOffset !== '1') throw new Error(`MFM_SEED_OFFSET must be 0 or 1, not ${rawOffset}`);
  return { matrix, offset: rawOffset === '1' ? 1 : 0 };
}

/** The row a built meta implies (overlay aspects default to all its aspects). */
export function rowOfMeta(meta: { id: string; category: string; uses: readonly string[]; modes: readonly string[]; aspects: readonly string[]; overlayAspects?: readonly string[] | undefined }): SeedRow {
  return {
    id: meta.id,
    category: meta.category,
    uses: [...meta.uses] as SeedRow['uses'],
    modes: [...meta.modes] as SeedMode[],
    aspects: [...meta.aspects] as SeedAspect[],
    overlayAspects: [...(meta.overlayAspects ?? meta.aspects)] as SeedAspect[],
  };
}

/** The cases the seed acceptance registers for a seed under the current setting. */
export function casesToRegister(meta: Parameters<typeof rowOfMeta>[0], setting: SeedMatrixSetting = seedMatrixSetting()): SeedCase[] {
  const cases = seedCases(rowOfMeta(meta));
  if (setting.matrix === 'full') return cases;
  const assigned = sampleAssignment(SEED_TABLE, setting.offset).get(meta.id);
  if (!assigned) throw new Error(`seed ${meta.id} has no row in SEED_TABLE (test/helpers/seed-matrix.ts)`);
  const match = cases.find((c) => c.brand === assigned.brand && c.aspect === assigned.aspect && c.mode === assigned.mode);
  if (!match) throw new Error(`seed ${meta.id}: its SEED_TABLE row assigns ${assigned.brand} ${assigned.aspect} ${assigned.mode}, which its meta does not build; update its row`);
  return [match];
}

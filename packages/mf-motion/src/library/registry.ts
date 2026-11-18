// The move registry (move-contract.md, Registry): library moves from
// src/library/moves/index.ts, metas validated at load, builders loaded on
// demand; user library entries merge in later (MFM-086) where the library
// wins and the user entry is reported as USER_MOVE_SHADOWED.
import type { Warning } from '../cli/output';
import { MfmError } from '../cli/errors';
import { type MoveMeta, type MoveModule, validateMeta } from './contract';
import { LIBRARY_MOVES } from './moves/index';

export interface RegistryEntry {
  meta: MoveMeta;
  source: 'library' | 'user';
  /** Folder of the move's own files (assets/ and credits.json), when it has one. */
  dir: string | null;
  load: () => Promise<MoveModule>;
}

let library: RegistryEntry[] | null = null;
let extra: RegistryEntry[] = [];

/** The library moves with validated metas. */
export function libraryMoves(): RegistryEntry[] {
  library ??= LIBRARY_MOVES.map((entry) => ({ meta: validateMeta(entry.meta, `library move ${entry.meta.id}`), source: 'library' as const, dir: null, load: entry.load }));
  return library;
}

/** Merge user entries: an id the library already has stays the library's, with a USER_MOVE_SHADOWED warning. */
export function mergeUser(base: RegistryEntry[], user: RegistryEntry[]): { entries: RegistryEntry[]; warnings: Warning[] } {
  const ids = new Set(base.map((entry) => entry.meta.id));
  const warnings: Warning[] = [];
  const added: RegistryEntry[] = [];
  for (const entry of user) {
    if (ids.has(entry.meta.id)) {
      warnings.push({ code: 'USER_MOVE_SHADOWED', message: `The user move ${entry.meta.id} has the id of a built-in move; the built-in move is used.`, details: { id: entry.meta.id } });
      continue;
    }
    ids.add(entry.meta.id);
    added.push(entry);
  }
  return { entries: [...base, ...added], warnings };
}

/** Test seam: moves registered in addition to the library (fixtures), as user entries would be. */
export function registerMoves(entries: RegistryEntry[]): void {
  extra = entries.map((entry) => ({ ...entry, meta: validateMeta(entry.meta, `move ${entry.meta.id}`) }));
}

/** Every registered move, library first. */
export function allMoves(): { entries: RegistryEntry[]; warnings: Warning[] } {
  return mergeUser(libraryMoves(), extra);
}

/** One move by id, or MOVE_NOT_FOUND. */
export function findMove(id: string): RegistryEntry {
  const found = allMoves().entries.find((entry) => entry.meta.id === id);
  if (!found) throw new MfmError('MOVE_NOT_FOUND', { id }, { message: `No move with the id ${id} exists.`, next: ['mf-motion catalog search <words> --json'] });
  return found;
}

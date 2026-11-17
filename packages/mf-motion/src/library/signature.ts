// Signature distance and uniqueness (signatures-and-uniqueness.md): how many
// fields two signatures differ in, the nearest neighbours of a candidate, the
// neighbours a publish-time check must compare by eye, and the spec-time
// spread rule. Vocabularies come from the signature schema (MFM-005).
import * as v from 'valibot';
import { MfmError } from '../cli/errors';
import { MOVE_SIGNATURE, MoveSignature, type MoveSignatureValue, THEME_SIGNATURE, ThemeSignature, type ThemeSignatureValue } from '../schemas/signature';

export type Signature = MoveSignatureValue | ThemeSignatureValue;
export type SignatureKind = 'move' | 'theme';

export const MOVE_FIELDS = Object.keys(MOVE_SIGNATURE) as Array<keyof MoveSignatureValue>;
export const THEME_FIELDS = Object.keys(THEME_SIGNATURE) as Array<keyof ThemeSignatureValue>;

export interface Unit {
  id: string;
  category: string;
  signature: Signature;
}

/** Spec-time spread minimums per 10 concepts of a category. */
export const SPREAD_PER_TEN = { layout: 4, motion: 5, use: 3 } as const;
/** Distance-2 neighbours compared by eye. */
export const DISTANCE_TWO_COMPARE = 3;

/** Move or theme, validated against the closed vocabularies. */
export function signatureKind(signature: unknown): SignatureKind {
  if (v.is(MoveSignature, signature)) return 'move';
  if (v.is(ThemeSignature, signature)) return 'theme';
  const issues = [...v.safeParse(MoveSignature, signature).issues ?? [], ...v.safeParse(ThemeSignature, signature).issues ?? []];
  throw new MfmError('SCHEMA_INVALID', { signature, issues: issues.slice(0, 6).map((issue) => issue.message) }, {
    message: 'This is neither a move nor a theme signature from the closed vocabularies.',
    hint: 'Use the values listed in signatures-and-uniqueness.md; `mf-motion schema signature --json` shows them.',
  });
}

const fieldsOf = (kind: SignatureKind): string[] => (kind === 'move' ? MOVE_FIELDS : THEME_FIELDS);

/** Number of fields that differ: moves 0-5, themes 0-6. */
export function distance(a: Signature, b: Signature): number {
  const kind = signatureKind(a);
  if (signatureKind(b) !== kind) {
    throw new MfmError('USAGE', { a, b }, { message: 'A move signature and a theme signature cannot be compared.' });
  }
  const left = a as unknown as Record<string, string>;
  const right = b as unknown as Record<string, string>;
  return fieldsOf(kind).filter((field) => left[field] !== right[field]).length;
}

export interface Neighbour {
  id: string;
  category: string;
  distance: number;
}

const byNearness = (a: Neighbour, b: Neighbour) => a.distance - b.distance || a.category.localeCompare(b.category) || a.id.localeCompare(b.id);

/** The n units nearest the candidate (itself excluded), by distance, then category, then id. */
export function nearest(candidate: Unit, units: Unit[], n: number): Neighbour[] {
  return units
    .filter((unit) => unit.id !== candidate.id)
    .map((unit) => ({ id: unit.id, category: unit.category, distance: distance(candidate.signature, unit.signature) }))
    .sort(byNearness)
    .slice(0, Math.max(0, n));
}

export interface ComparisonPlan {
  /** Units at distance 0: a hard SIGNATURE_DUPLICATE failure. */
  duplicates: Neighbour[];
  /** Units to compare by eye: every distance-1 unit and the 3 nearest distance-2 units. */
  compare: Neighbour[];
}

/** What the publish-time check does with a candidate against the shipped and specified units. */
export function comparisonPlan(candidate: Unit, units: Unit[]): ComparisonPlan {
  const all = nearest(candidate, units, units.length);
  return {
    duplicates: all.filter((unit) => unit.distance === 0),
    compare: [...all.filter((unit) => unit.distance === 1), ...all.filter((unit) => unit.distance === 2).slice(0, DISTANCE_TWO_COMPARE)],
  };
}

/** Throw SIGNATURE_DUPLICATE when the candidate shares its signature with any unit. */
export function assertUnique(candidate: Unit, units: Unit[]): void {
  const { duplicates } = comparisonPlan(candidate, units);
  if (duplicates.length > 0) {
    const ids = [candidate.id, ...duplicates.map((unit) => unit.id)];
    throw new MfmError('SIGNATURE_DUPLICATE', { ids, signature: candidate.signature }, { message: `${candidate.id} has the same signature as ${duplicates.map((unit) => unit.id).join(', ')}.` });
  }
}

export type SpreadProblem =
  | { code: 'SIGNATURE_DUPLICATE'; ids: string[]; signature: Signature; message: string }
  | { code: 'SPREAD'; category: string; ids: string[]; field: keyof typeof SPREAD_PER_TEN; distinct: number; min: number; message: string };

export interface SpreadReport {
  ok: boolean;
  problems: SpreadProblem[];
}

/**
 * Spec-time check: signatures pairwise distinct across all concepts, and in
 * each category every run of 10 concepts (in the given order) has at least
 * 4 layouts, 5 motions and 3 uses; a shorter last run needs its share,
 * rounded up.
 */
export function specSpread(concepts: Unit[]): SpreadReport {
  const problems: SpreadProblem[] = [];
  const groups = new Map<string, Unit[]>();
  for (const concept of concepts) {
    signatureKind(concept.signature);
    const key = JSON.stringify(Object.entries(concept.signature).sort(([a], [b]) => a.localeCompare(b)));
    groups.set(key, [...(groups.get(key) ?? []), concept]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = group.map((concept) => concept.id);
    problems.push({ code: 'SIGNATURE_DUPLICATE', ids, signature: (group[0] as Unit).signature, message: `${ids.join(', ')} share one signature.` });
  }

  const categories = new Map<string, Unit[]>();
  for (const concept of concepts) {
    if (signatureKind(concept.signature) !== 'move') continue;
    categories.set(concept.category, [...(categories.get(concept.category) ?? []), concept]);
  }
  for (const [category, members] of categories) {
    for (let start = 0; start < members.length; start += 10) {
      const run = members.slice(start, start + 10);
      for (const [field, perTen] of Object.entries(SPREAD_PER_TEN) as Array<[keyof typeof SPREAD_PER_TEN, number]>) {
        const min = Math.ceil((perTen * run.length) / 10);
        const distinct = new Set(run.map((concept) => (concept.signature as MoveSignatureValue)[field])).size;
        if (distinct < min) {
          const ids = run.map((concept) => concept.id);
          problems.push({
            code: 'SPREAD',
            category,
            ids,
            field,
            distinct,
            min,
            message: `${category} ${ids[0]}..${ids[ids.length - 1]}: ${distinct} distinct ${field} value(s); the rule needs ${min}.`,
          });
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

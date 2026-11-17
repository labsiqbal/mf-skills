// `mf-motion migrate`: find documents below their kind's current version in
// the data home (and a project when asked), back each one up as
// <file>.bak-v<n>, write the migrated document, and log a `migrate` event in
// every touched project. events.jsonl is never rewritten.
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../../cli/errors';
import { type Kind, parseDoc, schemas, writeDoc } from '../index';

export interface MigrationItem {
  path: string;
  kind: Kind;
  from: number;
  to: number;
  backup: string;
  /** Project root whose log records the change, if any. */
  project: string | null;
}

interface Candidate {
  file: string;
  kind: Kind;
  project: string | null;
}

function candidates(home: string, project: string | null): Candidate[] {
  const list: Candidate[] = [{ file: path.join(home, 'profile.json'), kind: 'profile', project: null }];
  const brands = path.join(home, 'brands');
  if (existsSync(brands)) {
    for (const id of readdirSync(brands).sort()) {
      list.push({ file: path.join(brands, id, 'brand.json'), kind: 'brand', project: null });
    }
  }
  if (project) {
    list.push({ file: path.join(project, 'project.json'), kind: 'project', project });
    list.push({ file: path.join(project, 'plan', 'brief.json'), kind: 'brief', project });
  }
  return list.filter((candidate) => existsSync(candidate.file));
}

function backupPath(file: string, from: number): string {
  const base = `${file}.bak-v${from}`;
  if (!existsSync(base)) return base;
  for (let n = 2; ; n += 1) {
    const next = `${base}-${n}`;
    if (!existsSync(next)) return next;
  }
}

/** Documents that need migration; throws SCHEMA_TOO_NEW or SCHEMA_INVALID for unreadable ones. */
export function planMigrations(home: string, project: string | null): MigrationItem[] {
  const items: MigrationItem[] = [];
  for (const candidate of candidates(home, project)) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(candidate.file, 'utf8'));
    } catch {
      throw new MfmError('SCHEMA_INVALID', { file: candidate.file }, { message: `${candidate.file} is not valid JSON.` });
    }
    const parsed = parseDoc(candidate.kind, value, candidate.file);
    if (!parsed.migrated) continue;
    items.push({
      path: candidate.file,
      kind: candidate.kind,
      from: parsed.from,
      to: schemas[candidate.kind].version,
      backup: backupPath(candidate.file, parsed.from),
      project: candidate.project,
    });
  }
  return items;
}

/** Back up and rewrite one document at its current version. */
export function applyMigration(item: MigrationItem): void {
  const { doc } = parseDoc(item.kind, JSON.parse(readFileSync(item.path, 'utf8')), item.path);
  copyFileSync(item.path, item.backup);
  writeDoc(item.kind, item.path, doc);
}

// The brand library: one folder per brand id under <home>/brands/, each with
// its own lock. List, show, use (copy into a project) and remove.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import type { Warning } from '../cli/output';
import { confine, homeLayout, lockFile, withLock } from '../paths/index';
import type { BrandDoc } from '../schemas/brand';
import { readDoc, writeDoc } from '../schemas/index';

/** What `brand use` copies into <project>/brand/: the picked brand, not the capture or candidates. */
const SYNCED = /^(brand\.json|brand\.md|(logo|mark)\.(svg|png|jpg|mp4)|shots|fonts)$/;

/** Every file brand.json points at (captured fonts stay under capture/), relative to the brand folder. */
export function referencedFiles(doc: BrandDoc): string[] {
  const files = [
    ...(doc.logo ? [doc.logo.path] : []),
    ...(doc.mark ? [doc.mark.path] : []),
    ...doc.shots.map((shot) => shot.path),
    ...Object.values(doc.type).flatMap((role) => role?.files.map((file) => file.path) ?? []),
  ];
  return [...new Set(files)].sort();
}

export interface BrandSummary {
  id: string;
  name: string;
  status: BrandDoc['status'];
  source: BrandDoc['source'];
  updatedAt: string;
}

function brandDir(home: string, id: string): string {
  return confine(homeLayout(home).brands, id);
}

/** The brand folder; BRAND_NOT_FOUND when it has no brand.json. */
export function existingBrand(home: string, id: string): { dir: string; file: string } {
  const dir = brandDir(home, id);
  const file = path.join(dir, 'brand.json');
  if (!existsSync(file)) throw new MfmError('BRAND_NOT_FOUND', { brand: id }, { next: ['mf-motion brand list --json'] });
  return { dir, file };
}

const updatedAt = (file: string) => statSync(file).mtime.toISOString();

/** Every brand in the library, most recently updated first; unreadable entries are reported, not listed. */
export function listBrands(home: string): { brands: BrandSummary[]; problems: Array<{ id: string; message: string }> } {
  const root = homeLayout(home).brands;
  const brands: BrandSummary[] = [];
  const problems: Array<{ id: string; message: string }> = [];
  if (!existsSync(root)) return { brands, problems };
  for (const id of readdirSync(root).sort()) {
    const file = path.join(root, id, 'brand.json');
    if (!existsSync(file)) continue;
    try {
      const { doc } = readDoc('brand', file);
      brands.push({ id: doc.id, name: doc.name, status: doc.status, source: doc.source, updatedAt: updatedAt(file) });
    } catch (error) {
      problems.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  brands.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { brands, problems };
}

/** One brand document with its folder and update time. */
export function showBrand(home: string, id: string): BrandDoc & { dir: string; updatedAt: string } {
  const { dir, file } = existingBrand(home, id);
  const { doc } = readDoc('brand', file);
  return { ...doc, dir, updatedAt: updatedAt(file) };
}

/** Copy a file tree, regular files only; anything resolving outside `root` is refused. */
function copyTree(root: string, from: string, to: string): number {
  let files = 0;
  const stat = lstatSync(from);
  const real = confine(root, stat.isSymbolicLink() ? realpathSync(from) : from);
  if (statSync(real).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(real).sort()) files += copyTree(root, path.join(real, name), path.join(to, name));
  } else {
    copyFileSync(real, to);
    files += 1;
  }
  return files;
}

export interface UseOptions {
  home: string;
  id: string;
  project: string;
  command: string;
  onWarn?: (message: string) => void;
}

/**
 * Copy the brand into <project>/brand/ (copies, never links) and set
 * project.json brand, under the project lock and then the brand lock.
 */
export async function useBrand(
  options: UseOptions,
): Promise<{ project: string; brand: { id: string; status: BrandDoc['status']; dir: string; files: number }; warnings: Warning[] }> {
  const { dir, file } = existingBrand(options.home, options.id);
  const lock = { command: options.command, ...(options.onWarn ? { onStale: options.onWarn } : {}) };
  return withLock(
    lockFile(options.project),
    () =>
      withLock(
        lockFile(dir),
        () => {
          const { doc } = readDoc('brand', file);
          const target = confine(options.project, path.join(options.project, 'brand'));
          const staging = `${target}.partial-${process.pid}`;
          rmSync(staging, { recursive: true, force: true });
          mkdirSync(staging, { recursive: true });
          let files = 0;
          try {
            for (const name of readdirSync(dir).sort()) if (SYNCED.test(name)) files += copyTree(dir, path.join(dir, name), path.join(staging, name));
            for (const rel of referencedFiles(doc)) {
              const to = confine(staging, path.join(staging, rel));
              if (existsSync(to)) continue;
              mkdirSync(path.dirname(to), { recursive: true });
              files += copyTree(dir, confine(dir, path.join(dir, rel)), to);
            }
          } catch (error) {
            rmSync(staging, { recursive: true, force: true });
            throw error;
          }
          rmSync(target, { recursive: true, force: true });
          renameSync(staging, target);
          const projectFile = path.join(options.project, 'project.json');
          const { doc: project } = readDoc('project', projectFile);
          writeDoc('project', projectFile, { ...project, brand: options.id });
          const warnings: Warning[] =
            doc.status === 'draft'
              ? [{ code: 'BRAND_NOT_PICKED', message: `Brand ${options.id} is a draft: moves can use it now; films need a picked brand with 3-6 shots.`, details: { brand: options.id } }]
              : [];
          return { project: options.project, brand: { id: options.id, status: doc.status, dir: target, files }, warnings };
        },
        lock,
      ),
    lock,
  );
}

function folderBytes(dir: string): number {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = lstatSync(file);
    bytes += stat.isDirectory() ? folderBytes(file) : stat.size;
  }
  return bytes;
}

/** Delete a brand folder; LOCKED while anyone holds the brand's lock. */
export async function removeBrand(home: string, id: string, options: { command: string; onWarn?: (message: string) => void }): Promise<{ removed: { id: string; bytes: number } }> {
  const { dir } = existingBrand(home, id);
  return withLock(
    lockFile(dir),
    () => {
      const bytes = folderBytes(dir);
      // Move the folder aside first so a half-finished delete never looks like a brand.
      const doomed = path.join(path.dirname(dir), `.removing-${id}-${process.pid}`);
      renameSync(dir, doomed);
      rmSync(doomed, { recursive: true, force: true });
      return { removed: { id, bytes } };
    },
    { command: options.command, ...(options.onWarn ? { onStale: options.onWarn } : {}) },
  );
}

/** After a new pick the previous pick kept by `capture --refresh` is no longer needed. */
export async function dropPreviousPick(home: string, id: string, options: { command: string; onWarn?: (message: string) => void }): Promise<boolean> {
  const { dir } = existingBrand(home, id);
  const previous = path.join(dir, 'brand.prev.json');
  if (!existsSync(previous)) return false;
  return withLock(
    lockFile(dir),
    () => {
      rmSync(previous, { force: true });
      return true;
    },
    { command: options.command, ...(options.onWarn ? { onStale: options.onWarn } : {}) },
  );
}

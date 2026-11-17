import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Write a file through a temporary sibling and a rename, so readers never see half a file. */
export function writeFileAtomic(target: string, content: string | Buffer): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, content);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function writeJsonAtomic(target: string, value: unknown): void {
  writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

/** Quote one argument for display in a `next` command line. */
export function shellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

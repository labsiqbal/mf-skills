// Path confinement: a path must resolve inside its root after realpath, so
// neither "../" nor a symlink can lead out of a project, brand or library entry.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';

function realpathOf(target: string): string {
  return realpathSync.native(target);
}

/** realpath of the deepest existing ancestor, plus the parts that do not exist yet. */
function realpathAllowMissing(target: string): string {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = realpathOf(current);
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...missing.reverse());
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  const first = relative.split(path.sep)[0];
  return first !== '..' && !path.isAbsolute(relative);
}

/**
 * Resolve `target` (relative to `root` unless absolute) and return its real
 * path, or throw PATH_ESCAPES_ROOT when it lands outside the real root.
 * Paths that do not exist yet are checked through their deepest existing folder.
 */
export function confine(root: string, target: string): string {
  const realRoot = realpathAllowMissing(root);
  const resolved = realpathAllowMissing(path.resolve(root, target));
  const compareRoot = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
  const compareResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  if (!inside(compareRoot, compareResolved)) {
    throw new MfmError('PATH_ESCAPES_ROOT', { root, path: target, resolved }, {
      message: `The path "${target}" resolves outside ${realRoot}.`,
    });
  }
  return resolved;
}

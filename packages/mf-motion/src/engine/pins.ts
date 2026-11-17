// Engine pins: packages/mf-motion/engine/package.json and its lockfile ship in
// the npm package and are the only source of the engine versions.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencies as pinnedDependencies } from '../../engine/package.json';
import { MfmError } from '../cli/errors';

export interface EnginePins {
  hyperframes: string;
  gsap: string;
  three: string;
}

let cachedRoot: string | undefined;

/** The mf-motion package folder (holds package.json and engine/), found from this module's location. */
export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(current, 'package.json');
    if (existsSync(manifest) && existsSync(path.join(current, 'engine', 'package.json'))) {
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name;
      if (name === 'mf-motion') {
        cachedRoot = current;
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new MfmError('ENGINE_MISSING', {}, { message: 'The engine pin file engine/package.json is missing from this mf-motion install.' });
    }
    current = parent;
  }
}

export function enginePinFiles(root = packageRoot()) {
  return { manifest: path.join(root, 'engine', 'package.json'), lock: path.join(root, 'engine', 'package-lock.json') };
}

/**
 * The pinned engine versions, from engine/package.json (bundled into the CLI
 * at build time, so a bare `dist/cli.mjs` still knows its pins).
 */
export function enginePins(): EnginePins {
  const dependencies: Record<string, string | undefined> = pinnedDependencies;
  const pin = (name: keyof EnginePins) => {
    const version = dependencies[name];
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new MfmError('ENGINE_MISSING', { package: name, version: version ?? null }, { message: `engine/package.json does not pin ${name} exactly.` });
    }
    return version;
  };
  return { hyperframes: pin('hyperframes'), gsap: pin('gsap'), three: pin('three') };
}

/** sha256 of the shipped engine lockfile; an installed engine with another hash is reinstalled. */
export function lockSha256(root = packageRoot()): string {
  return createHash('sha256').update(readFileSync(enginePinFiles(root).lock)).digest('hex');
}

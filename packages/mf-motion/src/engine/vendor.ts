// Copy the animation runtime into a build: GSAP (with its licence headers and
// a notice) and three.js only when a kit piece needs it. Projects never get
// a node_modules folder.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';

export const GSAP_PLUGINS = ['CustomEase', 'MotionPathPlugin', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin'] as const;
export type GsapPlugin = (typeof GSAP_PLUGINS)[number];

export const THREE_FILES = ['three.module.js', 'three.core.js'] as const;

export const GSAP_NOTICE = [
  'This build includes GSAP (https://gsap.com), copied unchanged with its original headers.',
  "GSAP is distributed under the GSAP Standard 'No Charge' license: https://gsap.com/standard-license",
  "GSAP is not covered by mf-motion's MIT licence.",
  '',
].join('\n');

export interface VendorOptions {
  /** Installed engine folder (its node_modules holds gsap and three). */
  engineDir: string;
  plugins?: readonly GsapPlugin[];
  needsThree?: boolean;
}

function copyInto(from: string, toDir: string): string {
  if (!existsSync(from)) throw new MfmError('ENGINE_MISSING', { file: from }, { message: `The engine install is missing ${from}.` });
  mkdirSync(toDir, { recursive: true });
  const to = path.join(toDir, path.basename(from));
  copyFileSync(from, to);
  return to;
}

/** Copy vendor files into `<build>/vendor/`; returns the build-relative paths written. */
export function copyVendor(buildDir: string, options: VendorOptions): string[] {
  const modules = path.join(options.engineDir, 'node_modules');
  const vendor = path.join(buildDir, 'vendor');
  const written: string[] = [];
  const gsapDir = path.join(vendor, 'gsap');
  const files = ['gsap.min.js', ...(options.plugins ?? []).map((plugin) => `${plugin}.min.js`)];
  for (const file of [...new Set(files)]) {
    written.push(copyInto(path.join(modules, 'gsap', 'dist', file), gsapDir));
  }
  mkdirSync(vendor, { recursive: true });
  const notice = path.join(vendor, 'GSAP-NOTICE.txt');
  writeFileSync(notice, GSAP_NOTICE);
  written.push(notice);
  if (options.needsThree) {
    // three ships no minified module build; three.module.js imports ./three.core.js.
    for (const file of THREE_FILES) written.push(copyInto(path.join(modules, 'three', 'build', file), path.join(vendor, 'three')));
  }
  return written.map((file) => path.relative(buildDir, file).split(path.sep).join('/'));
}

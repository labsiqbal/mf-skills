// A composition folder for kit render tests: GSAP from the engine, the built
// mf-runtime.js, bundled (and optionally fetched) fonts, and a page whose
// lines come from the kit's line() builder.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeCss, typeRamp } from '../../../../src/kit/build/type';
import { copyVendor } from '../../../../src/engine/vendor';
import { bundledFontsDir } from '../../../../src/fonts/index';
import type { Engine } from '../../../../src/engine/index';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export const FONTS: Record<string, { family: string; file: string }> = {
  inter: { family: 'Inter', file: path.join(bundledFontsDir(), 'inter', 'Inter[opsz,wght].ttf') },
  arabic: { family: 'Noto Sans Arabic', file: path.join(bundledFontsDir(), 'noto-sans-arabic', 'NotoSansArabic[wdth,wght].ttf') },
  devanagari: { family: 'Noto Sans Devanagari', file: path.join(bundledFontsDir(), 'noto-sans-devanagari', 'NotoSansDevanagari[wdth,wght].ttf') },
};

export function buildRuntime(): void {
  const result = spawnSync(process.execPath, ['esbuild.config.mjs'], { cwd: packageRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

/** A temp folder holding vendor/gsap, vendor/mf-runtime.js and fonts/. */
export function compositionDir(engine: Engine, extraFonts: Record<string, { family: string; file: string }> = {}): { dir: string; fonts: Record<string, { family: string; file: string }> } {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-kit-'));
  copyVendor(dir, { engineDir: engine.dir });
  copyFileSync(path.join(packageRoot, 'dist', 'vendor', 'mf-runtime.js'), path.join(dir, 'vendor', 'mf-runtime.js'));
  mkdirSync(path.join(dir, 'fonts'));
  const fonts = { ...FONTS, ...extraFonts };
  for (const font of Object.values(fonts)) copyFileSync(font.file, path.join(dir, 'fonts', path.basename(font.file)));
  return { dir, fonts };
}

export interface PageOptions {
  width?: number;
  height?: number;
  durationSec: number;
  body: string;
  /** Extra CSS. */
  css?: string;
  /** Script run before the timeline is registered (tl is in scope). */
  script?: string;
  fonts: Record<string, { family: string; file: string }>;
  /** Build the lines (default true). */
  lines?: boolean;
}

export function writePage(dir: string, name: string, options: PageOptions): string {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const faces = Object.values(options.fonts)
    .map((font) => `@font-face { font-family: "${font.family}"; src: url("fonts/${encodeURI(path.basename(font.file))}"); font-weight: 100 900; }`)
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
${faces}
:root { --mf-font-display: "Inter", sans-serif; --mf-font-heading: "Inter", sans-serif; --mf-font-body: "Inter", sans-serif; }
html, body { margin: 0; background: #0B0F17; }
#main { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #0B0F17; color: #E8EEF7; }
${typeCss(typeRamp(width >= height ? '16:9' : '9:16', { width }))}
${options.css ?? ''}
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-width="${width}" data-height="${height}" data-duration="${options.durationSec}" data-fps="30">
${options.body}
</div>
<script src="vendor/gsap/gsap.min.js"></script>
<script src="vendor/mf-runtime.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  ${options.lines === false ? '' : 'window.__schedule = mf.lines(tl).map((s) => ({ id: s.element.id, entrance: s.entrance, exit: s.exit, split: s.split, inSec: s.inSec, landSec: s.landSec, outSec: s.outSec, goneSec: s.goneSec }));'}
  ${options.script ?? ''}
  tl.set({}, {}, ${options.durationSec});
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
</script>
</body>
</html>
`;
  writeFileSync(path.join(dir, name), html);
  return name;
}

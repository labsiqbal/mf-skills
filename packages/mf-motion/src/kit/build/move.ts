// The move build context and composition document: `moveCtx` resolves the
// frame, mode, key colour, brand tokens and safe boxes a move builds against;
// `moveDocument` wraps a move's composition into the HyperFrames page with
// the inlined vars.json, the mode classes and the literal timeline
// registration; `writeMoveBuild` lays out the build folder.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../../cli/errors';
import { copyVendor } from '../../engine/vendor';
import { packageRoot } from '../../engine/pins';
import { keyColor } from '../keyColor';
import { type AspectKey, aspectSize } from '../numbers';
import { type Profile, type Rect, type SafeBoxes, safeBoxes } from '../safe';
import { type BrandTokens, type TokenBrand, brandTokens, tokensCss } from '../tokens';
import type { TrustedHtml } from './html';

export type MoveMode = 'full' | 'alpha' | 'key';
export type MoveLayer = 'overlay' | 'broll';

/** A file to copy into the build folder's assets/. */
export interface AssetRequest {
  /** Absolute source path. */
  from: string;
  /** Path under assets/ (POSIX). */
  to: string;
}

export interface AssetSink {
  readonly requests: AssetRequest[];
  /** Ask for a file; returns its build-relative URL (assets/<name>). */
  add(from: string, name?: string): string;
}

export interface MoveCtx {
  aspect: AspectKey;
  width: number;
  height: number;
  /** Pixels per u (min(W, H) / 1080). */
  u: number;
  fps: string;
  mode: MoveMode;
  /** The chroma-key colour in key mode, else null. */
  keyColor: string | null;
  brand: BrandTokens;
  safe: SafeBoxes;
  seed: number;
  durationSec: number;
  assets: AssetSink;
}

/** What a move's build returns (move-contract.md, Module shape). */
export interface Composition {
  id: string;
  html: TrustedHtml;
  css: string;
  script: string;
  assets: AssetRequest[];
  needsThree: boolean;
  holds: Array<{ from: number; to: number }>;
}

export interface MoveCtxInput {
  aspect: AspectKey;
  mode: MoveMode;
  layer: MoveLayer;
  /** brand.json colours, type and radius; `palette` (brand.colors.palette) feeds the key colour. */
  brand: TokenBrand & { colors: TokenBrand['colors'] & { palette?: string[] } };
  fps?: string;
  seed: number;
  durationSec: number;
  /** Frame width; default the aspect's base width. */
  width?: number;
  /** Overlays keep copy out of the face band (default true). */
  avoidFace?: boolean;
}

/** The safe-box profile of a move: b-roll moves use the full-frame box, overlays the overlay box. */
export function moveProfile(layer: MoveLayer, mode: MoveMode): Profile {
  if (layer === 'broll') return 'broll';
  return mode === 'key' ? 'overlay-key' : 'overlay-alpha';
}

function assetSink(): AssetSink {
  const requests: AssetRequest[] = [];
  return {
    requests,
    add(from: string, name?: string) {
      const to = (name ?? path.basename(from)).split(path.sep).join('/');
      if (to.startsWith('/') || to.split('/').includes('..')) throw new MfmError('PATH_ESCAPES_ROOT', { asset: to }, { message: `Asset name ${to} leaves assets/.` });
      if (!requests.some((request) => request.to === to)) requests.push({ from, to });
      return `assets/${to}`;
    },
  };
}

/** The palette the key colour keeps away from: brand.colors.palette plus the role colours. */
export function brandPalette(brand: MoveCtxInput['brand']): string[] {
  const colors = brand.colors;
  const roles = [colors.ground, colors.surface, colors.ink, colors.muted, colors.accent, colors.accent2].filter((hex): hex is string => typeof hex === 'string');
  return [...new Set([...(colors.palette ?? []), ...roles].map((hex) => hex.toUpperCase()))];
}

/** The build context of one move for one aspect and mode. */
export function moveCtx(input: MoveCtxInput): MoveCtx {
  if (input.layer === 'broll' && input.mode !== 'full') throw new MfmError('MODE_UNSUPPORTED', { layer: 'broll', mode: input.mode }, { message: 'B-roll moves render in full mode only.' });
  const base = aspectSize(input.aspect);
  const width = input.width ?? base.width;
  const height = Math.round((base.height * width) / base.width);
  const brand = brandTokens(input.brand, { aspect: input.aspect, width, height });
  const safe = safeBoxes(input.aspect, moveProfile(input.layer, input.mode), { width, ...(input.avoidFace === false ? { avoidFace: false } : {}) });
  return {
    aspect: input.aspect,
    width,
    height,
    u: brand.u,
    fps: input.fps ?? '30',
    mode: input.mode,
    keyColor: input.mode === 'key' ? keyColor(brandPalette(input.brand)).hex : null,
    brand,
    safe,
    seed: input.seed,
    durationSec: input.durationSec,
    assets: assetSink(),
  };
}

const orientation = (aspect: AspectKey) => (aspect === '9:16' ? 'is-portrait' : aspect === '1:1' ? 'is-square' : 'is-landscape');

/** vars.json: the resolved variables and the context the runtime reads (inlined, never fetched). */
export interface VarsDoc {
  schemaVersion: 1;
  kind: 'move-vars';
  move: string;
  vars: Record<string, unknown>;
  ctx: {
    aspect: AspectKey;
    width: number;
    height: number;
    u: number;
    fps: string;
    mode: MoveMode;
    keyColor: string | null;
    seed: number;
    durationSec: number;
    safe: { copy: Rect; frame: Rect; avoid: Rect[]; captionBand: Rect | null };
    /** Vertical offset of the content root from the 9:16 centring pass, in px. */
    centreOffsetPx: number;
  };
}

export function varsDoc(ctx: MoveCtx, id: string, vars: Record<string, unknown>, centreOffsetPx = 0): VarsDoc {
  return {
    schemaVersion: 1,
    kind: 'move-vars',
    move: id,
    vars,
    ctx: {
      aspect: ctx.aspect,
      width: ctx.width,
      height: ctx.height,
      u: ctx.u,
      fps: ctx.fps,
      mode: ctx.mode,
      keyColor: ctx.keyColor,
      seed: ctx.seed,
      durationSec: ctx.durationSec,
      safe: { copy: ctx.safe.copy, frame: ctx.safe.frame, avoid: ctx.safe.avoid, captionBand: ctx.safe.captionBand },
      centreOffsetPx,
    },
  };
}

/** JSON safe inside a <script> element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** The inline vars script tag, between markers so the centring pass can replace it. */
export const VARS_TAG = { open: '<script type="application/json" id="mf-vars">', close: '</script>' } as const;

/** Mode CSS: alpha drops the ground, key replaces it with the key colour and keeps edges hard. */
function modeCss(ctx: MoveCtx): string {
  const key = ctx.keyColor ?? 'transparent';
  return `
#mf-root { position: relative; width: ${ctx.width}px; height: ${ctx.height}px; overflow: hidden; background: var(--mf-ground); }
#mf-root.is-alpha { background: transparent; }
#mf-root.is-alpha .mf-ground { display: none; }
#mf-root.is-key { background: ${key}; }
#mf-root.is-key .mf-ground { display: none; }
/* Key mode: no soft edge may blend into the key colour. Soft shadows become solid, blur is off. */
#mf-root { --mf-shadow-box: 0 calc(var(--mf-u) * 18) calc(var(--mf-u) * 44) var(--mf-shadow); }
#mf-root.is-key { --mf-shadow-box: 0 calc(var(--mf-u) * 6) 0 0 var(--mf-shadow-solid); }
#mf-root.is-key * { filter: none !important; backdrop-filter: none !important; text-shadow: none !important; }
.mf-content { position: absolute; left: var(--mf-safe-l); top: var(--mf-safe-t); right: var(--mf-safe-r); bottom: var(--mf-safe-b); }
`;
}

/** The composition page (index.html) of a move build and its vars.json. */
export function moveDocument(ctx: MoveCtx, composition: Composition, vars: Record<string, unknown>, options: { centreOffsetPx?: number; language?: string } = {}): { html: string; vars: VarsDoc } {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(composition.id)) throw new MfmError('VARS_INVALID', { id: composition.id }, { message: `Composition id "${composition.id}" is not a lowercase slug.` });
  const doc = varsDoc(ctx, composition.id, vars, options.centreOffsetPx ?? 0);
  // An opaque, darker shadow tone for key mode (no alpha against the key colour).
  const solidShadow = ctx.brand.colors.ink;
  const safeVars = Object.entries(ctx.safe.css)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  const html = `<!doctype html>
<html lang="${options.language ?? 'en'}">
<head>
<meta charset="utf-8">
<style>
${tokensCss(ctx.brand.vars)}
:root { ${safeVars} --mf-shadow-solid: ${solidShadow}; }
html, body { margin: 0; padding: 0; background: transparent; }
${modeCss(ctx)}
${composition.css}
</style>
</head>
<body>
<div id="mf-root" class="mf-move is-${ctx.mode} ${orientation(ctx.aspect)}" data-composition-id="${composition.id}" data-width="${ctx.width}" data-height="${ctx.height}" data-duration="${ctx.durationSec}" data-fps="${ctx.fps}">
<div class="mf-ground" aria-hidden="true"></div>
<div class="mf-content">
${composition.html.value}
</div>
</div>
${VARS_TAG.open}
${scriptJson(doc)}
${VARS_TAG.close}
<script src="vendor/gsap/gsap.min.js"></script>
<script src="vendor/mf-runtime.js"></script>
<script>
const tl = gsap.timeline({ paused: true });
mf.move({ tl, onBuild: function (move) {
  const vars = move.vars;
  const ctx = move.ctx;
  const root = move.root;
${composition.script}
} });
window.__timelines = window.__timelines || {};
window.__timelines["${composition.id}"] = tl;
mf.done(tl);
</script>
</body>
</html>
`;
  return { html, vars: doc };
}

/** Replace the inline vars of a built page (the centring pass writes a new offset). */
export function replaceInlineVars(page: string, doc: VarsDoc): string {
  const start = page.indexOf(VARS_TAG.open);
  const end = start < 0 ? -1 : page.indexOf(VARS_TAG.close, start + VARS_TAG.open.length);
  if (start < 0 || end < 0) throw new MfmError('INTERNAL', {}, { message: 'The move page has no inline vars tag.' });
  return `${page.slice(0, start + VARS_TAG.open.length)}\n${scriptJson(doc)}\n${page.slice(end)}`;
}

/** The bundled composition runtime (dist/vendor/mf-runtime.js). */
export function runtimeFile(root = packageRoot()): string {
  return path.join(root, 'dist', 'vendor', 'mf-runtime.js');
}

/**
 * Lay out a move build folder: index.html, hyperframes.json, assets/vars.json,
 * the requested assets, vendor GSAP (and three when needed) and mf-runtime.js.
 */
export function writeMoveBuild(buildDir: string, ctx: MoveCtx, composition: Composition, vars: Record<string, unknown>, options: { engineDir: string; centreOffsetPx?: number }): { entry: string; varsFile: string } {
  mkdirSync(path.join(buildDir, 'assets'), { recursive: true });
  copyVendor(buildDir, { engineDir: options.engineDir, needsThree: composition.needsThree });
  const runtime = runtimeFile();
  if (!existsSync(runtime)) throw new MfmError('INTERNAL', { file: runtime }, { message: 'The composition runtime is not built (dist/vendor/mf-runtime.js).' });
  copyFileSync(runtime, path.join(buildDir, 'vendor', 'mf-runtime.js'));
  for (const request of [...ctx.assets.requests, ...composition.assets]) {
    const to = path.join(buildDir, 'assets', ...request.to.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(request.from, to);
  }
  const { html, vars: doc } = moveDocument(ctx, composition, vars, options.centreOffsetPx === undefined ? {} : { centreOffsetPx: options.centreOffsetPx });
  const varsFile = path.join(buildDir, 'assets', 'vars.json');
  writeFileSync(varsFile, `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(path.join(buildDir, 'index.html'), html);
  writeFileSync(path.join(buildDir, 'hyperframes.json'), `${JSON.stringify({ name: composition.id }, null, 2)}\n`);
  return { entry: 'index.html', varsFile };
}

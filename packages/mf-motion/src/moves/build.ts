// move render, steps 1-2 of move-contract.md (Render path) plus lint: resolve
// the move, brand, aspect, mode, duration and variables, build the
// composition into <out>/build/ with its vars inlined, and lint it. Rendering
// and encoding the master come with MFM-042.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { showBrand } from '../brand/library';
import { MfmError } from '../cli/errors';
import { packageRoot } from '../engine/index';
import { type MoveCtx, type MoveLayer, type MoveMode, moveCtx, moveProfile, writeMoveBuild } from '../kit/build/move';
import type { AspectKey } from '../kit/numbers';
import { type LintResult, lint } from '../lint/index';
import { type DemoBrand, type ResolvedVars, DEMOS, resolveVars } from '../library/contract';
import { type RegistryEntry, findMove } from '../library/registry';

export interface MoveRenderRequest {
  id: string;
  /** A library brand id, or demo:<tessarine|mossmallow|quillfen>. */
  brand: string;
  aspect: AspectKey;
  mode: MoveMode;
  vars?: ResolvedVars | null;
  durationSec?: number;
  fps?: string;
  /** Output folder; the build goes to <out>/build. */
  out: string;
  home: string;
  /** Installed engine folder (vendor GSAP and three come from it). */
  engine: { dir: string };
  seed?: number;
}

export interface MoveBuildResult {
  move: { id: string; version: string };
  build: string;
  entry: string;
  varsFile: string;
  keyColor: string | null;
  durationSec: number;
  vars: ResolvedVars;
  profile: string;
  lint: LintResult;
}

/** A brand document by id: demo brands from the package, others from the library. */
export function brandFor(home: string, id: string): { doc: Record<string, unknown> & { colors: Record<string, string> }; demo: DemoBrand | null; dir: string } {
  const demo = id.startsWith('demo:') ? id.slice(5) : null;
  if (demo !== null) {
    if (!(DEMOS as readonly string[]).includes(demo)) throw new MfmError('BRAND_NOT_FOUND', { brand: id }, { message: `${id} is not a demo brand (demo:${DEMOS.join(', demo:')}).` });
    const dir = path.join(packageRoot(), 'assets', 'demo-brands', demo);
    return { doc: JSON.parse(readFileSync(path.join(dir, 'brand.json'), 'utf8')), demo: demo as DemoBrand, dir };
  }
  const shown = showBrand(home, id) as unknown as Record<string, unknown> & { colors: Record<string, string>; dir: string };
  return { doc: shown, demo: (DEMOS as readonly string[]).includes(id) ? (id as DemoBrand) : null, dir: shown.dir };
}

interface BrandType {
  family?: string;
  files?: Array<{ path: string; weight?: string; style?: string }>;
}

/**
 * @font-face rules for the brand's own font files, under the family names the
 * font tokens name (--mf-font-*), with the files copied to assets/fonts/.
 */
export function brandFontCss(ctx: MoveCtx, brand: { doc: Record<string, unknown>; dir: string }): string {
  const type = (brand.doc.type ?? {}) as Record<string, BrandType | null>;
  const rules = new Set<string>();
  for (const entry of Object.values(type)) {
    if (!entry?.family || !entry.files) continue;
    for (const file of entry.files) {
      const source = path.resolve(brand.dir, file.path);
      if (!existsSync(source)) throw new MfmError('SCHEMA_INVALID', { file: source }, { message: `The brand font ${file.path} is missing.` });
      const url = ctx.assets.add(source, `fonts/${path.basename(file.path)}`);
      const family = entry.family.replace(/["\\]/g, '');
      rules.add(`@font-face { font-family: "${family}"; src: url('${encodeURI(url)}'); font-weight: ${file.weight ?? '400'}; font-style: ${file.style ?? 'normal'}; font-display: block; }`);
    }
  }
  return [...rules].join('\n');
}

/** The layer a move renders as in a mode: overlays in alpha and key, b-roll in full. */
function layerFor(entry: RegistryEntry, mode: MoveMode): MoveLayer {
  if (mode === 'full') return entry.meta.uses.includes('broll') ? 'broll' : 'overlay';
  return 'overlay';
}

/** Resolve, build and lint one move. */
export async function buildMove(request: MoveRenderRequest): Promise<MoveBuildResult> {
  const entry = findMove(request.id);
  const meta = entry.meta;
  if (!meta.aspects.includes(request.aspect)) {
    throw new MfmError('ASPECT_UNSUPPORTED', { move: meta.id, aspect: request.aspect, aspects: meta.aspects }, { message: `${meta.id} has no ${request.aspect} version (${meta.aspects.join(', ')}).` });
  }
  if (!meta.modes.includes(request.mode)) {
    throw new MfmError('MODE_UNSUPPORTED', { move: meta.id, mode: request.mode, modes: meta.modes }, { message: `${meta.id} renders in ${meta.modes.join(', ')}, not ${request.mode}.` });
  }
  const duration = request.durationSec ?? meta.durationSec.default;
  if (duration < meta.durationSec.min || duration > meta.durationSec.max) {
    throw new MfmError('USAGE', { flag: '--duration', value: duration, min: meta.durationSec.min, max: meta.durationSec.max }, { message: `${meta.id} lasts ${meta.durationSec.min}-${meta.durationSec.max} s, not ${duration} s.` });
  }
  const brand = brandFor(request.home, request.brand);
  const vars = resolveVars(meta, request.vars ?? null, brand.demo);
  const layer = layerFor(entry, request.mode);
  const ctx: MoveCtx = moveCtx({
    aspect: request.aspect,
    mode: request.mode,
    layer,
    brand: brand.doc as unknown as Parameters<typeof moveCtx>[0]['brand'],
    seed: request.seed ?? 1,
    durationSec: duration,
    ...(request.fps ? { fps: request.fps } : {}),
    avoidFace: meta.avoidFace,
  });
  const module = await entry.load();
  const composition = module.build(ctx, vars);
  if (composition.id !== meta.id) throw new MfmError('VARS_INVALID', { move: meta.id, compositionId: composition.id }, { message: `${meta.id} built a composition with the id ${composition.id}.` });
  const buildDir = path.join(path.resolve(request.out), 'build');
  const fonts = brandFontCss(ctx, brand);
  const written = writeMoveBuild(buildDir, ctx, { ...composition, css: fonts ? `${fonts}\n${composition.css}` : composition.css }, vars, { engineDir: request.engine.dir });
  const profile = moveProfile(layer, request.mode);
  const result = lint(buildDir, { profile });
  if (result.errors.length > 0) {
    throw new MfmError('LINT_FAILED', { move: meta.id, build: buildDir, errors: result.errors }, { message: `${meta.id} built with ${result.errors.length} lint error(s).` });
  }
  if (!existsSync(path.join(buildDir, written.entry))) throw new MfmError('INTERNAL', { build: buildDir }, { message: 'The move build wrote no index.html.' });
  return { move: { id: meta.id, version: meta.version }, build: buildDir, entry: written.entry, varsFile: written.varsFile, keyColor: ctx.keyColor, durationSec: duration, vars, profile, lint: result };
}

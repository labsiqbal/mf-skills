// The move module contract (move-contract.md, Module shape): what every library
// and user move exports, how its variables resolve and validate, and the static
// checks of rules 2 (no literal colours, pixel sizes or font names) and 7
// (asset credits). Rules 1, 3-6 run in the contract test suite with a build,
// lint and the frame audit.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type * as v from 'valibot';
import { MfmError } from '../cli/errors';
import type { AssetRequest, Composition, MoveCtx } from '../kit/build/move';
import { parseDoc } from '../schemas/index';
import { DEMO_BRANDS, type moveMetaSchema } from '../schemas/move-meta';

export type MoveMeta = v.InferOutput<typeof moveMetaSchema>;
export type VarSpec = MoveMeta['vars'][string];
export type DemoBrand = (typeof DEMO_BRANDS)[number];
export type ResolvedVars = Record<string, unknown>;

/** What a move module exports. */
export interface MoveModule {
  meta: MoveMeta;
  vars: MoveMeta['vars'];
  build(ctx: MoveCtx, vars: ResolvedVars): Composition;
}

/** Validate a move's meta (schema plus the cross-field rules of move-contract.md). */
export function validateMeta(value: unknown, source: string): MoveMeta {
  const { doc } = parseDoc('move-meta', value, source);
  const problems: string[] = [];
  for (const [name, spec] of Object.entries(doc.vars)) {
    if (spec.type === 'text' && spec.maxChars === undefined) problems.push(`text variable ${name} declares no maxChars`);
    if (spec.type === 'list' && spec.items?.type === 'text' && spec.items.maxChars === undefined) problems.push(`list variable ${name} declares no maxChars for its text items`);
  }
  if (doc.uses.includes('broll') && !doc.uses.includes('overlay') && doc.modes.some((mode) => mode !== 'full')) problems.push('a b-roll move renders in full mode only');
  if (problems.length > 0) throw new MfmError('SCHEMA_INVALID', { source, problems }, { message: `The move meta of ${source} breaks the contract: ${problems.join('; ')}.` });
  return doc;
}

/** JSON Schema of a move's variables (for `move info`). */
export function varsJsonSchema(meta: MoveMeta): Record<string, unknown> {
  const one = (spec: Omit<VarSpec, 'items'> & { items?: VarSpec['items'] }): Record<string, unknown> => {
    const base: Record<string, unknown> = { description: spec.describe, default: spec.default };
    switch (spec.type) {
      case 'text':
        return { ...base, type: 'string', ...(spec.maxChars ? { maxLength: spec.maxChars } : {}) };
      case 'number':
        return { ...base, type: 'number', ...(spec.min !== undefined ? { minimum: spec.min } : {}), ...(spec.max !== undefined ? { maximum: spec.max } : {}) };
      case 'boolean':
        return { ...base, type: 'boolean' };
      case 'enum':
        return { ...base, enum: spec.values ?? [] };
      case 'color-role':
        return { ...base, enum: ['ground', 'surface', 'ink', 'muted', 'accent', 'accent2'] };
      case 'image':
        return { ...base, type: 'string', description: `${spec.describe} (a file path)` };
      case 'list':
        return { ...base, type: 'array', ...(spec.maxItems ? { maxItems: spec.maxItems } : {}), items: spec.items ? one(spec.items) : {} };
    }
    return base;
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${meta.id} vars`,
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(meta.vars).map(([name, spec]) => [name, one(spec)])),
  };
}

/** Problems of one value against its spec (empty when it fits). */
function checkValue(name: string, spec: Omit<VarSpec, 'items'> & { items?: VarSpec['items'] }, value: unknown): string[] {
  switch (spec.type) {
    case 'text':
      if (typeof value !== 'string') return [`${name} must be text`];
      return spec.maxChars !== undefined && [...value].length > spec.maxChars ? [`${name} is ${[...value].length} characters; at most ${spec.maxChars}`] : [];
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${name} must be a number`];
      if (spec.min !== undefined && value < spec.min) return [`${name} is below ${spec.min}`];
      if (spec.max !== undefined && value > spec.max) return [`${name} is above ${spec.max}`];
      return [];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${name} must be true or false`];
    case 'enum':
      return typeof value === 'string' && (spec.values ?? []).includes(value) ? [] : [`${name} must be one of ${(spec.values ?? []).join(', ')}`];
    case 'color-role':
      return typeof value === 'string' && ['ground', 'surface', 'ink', 'muted', 'accent', 'accent2'].includes(value) ? [] : [`${name} must be a colour role`];
    case 'image':
      return typeof value === 'string' && value.length > 0 ? [] : [`${name} must be an image file`];
    case 'list': {
      if (!Array.isArray(value)) return [`${name} must be a list`];
      const problems = spec.maxItems !== undefined && value.length > spec.maxItems ? [`${name} has ${value.length} items; at most ${spec.maxItems}`] : [];
      return spec.items ? [...problems, ...value.flatMap((item, i) => checkValue(`${name}[${i}]`, spec.items as VarSpec, item))] : problems;
    }
  }
  return [];
}

/** Problems of a variable set against the meta: unknown names and values that do not fit. */
export function checkVars(meta: MoveMeta, values: ResolvedVars): string[] {
  const problems = Object.keys(values).filter((name) => !(name in meta.vars)).map((name) => `${name} is not a variable of ${meta.id}`);
  for (const [name, spec] of Object.entries(meta.vars)) if (name in values) problems.push(...checkValue(name, spec, values[name]));
  return problems;
}

/**
 * Resolve variables: the defaults, then the demo brand's example when the
 * brand is a demo brand and no variables were given, then the given ones.
 */
export function resolveVars(meta: MoveMeta, given: ResolvedVars | null, demo: DemoBrand | null): ResolvedVars {
  const defaults = Object.fromEntries(Object.entries(meta.vars).map(([name, spec]) => [name, spec.default]));
  const example = demo && !given ? meta.examples[demo] : {};
  const resolved = { ...defaults, ...example, ...(given ?? {}) };
  const problems = checkVars(meta, resolved);
  if (problems.length > 0) throw new MfmError('VARS_INVALID', { move: meta.id, problems }, { message: `The variables do not fit ${meta.id}: ${problems.join('; ')}.` });
  return resolved;
}

/** Variables with every text at its maxChars, as a string of W (rule 5). */
export function maxCharsVars(meta: MoveMeta): ResolvedVars {
  const widest = (spec: Omit<VarSpec, 'items'> & { items?: VarSpec['items'] }, value: unknown): unknown => {
    if (spec.type === 'text') return 'W'.repeat(spec.maxChars ?? 1);
    if (spec.type === 'list' && spec.items && Array.isArray(value)) {
      const count = spec.maxItems ?? value.length;
      return Array.from({ length: count }, (_, i) => widest(spec.items as VarSpec, value[i % Math.max(1, value.length)]));
    }
    return value;
  };
  return Object.fromEntries(Object.entries(meta.vars).map(([name, spec]) => [name, widest(spec, spec.default)]));
}

export interface ScanHit {
  rule: 2;
  where: 'css' | 'script';
  match: string;
  reason: 'hex colour' | 'rgb colour' | 'pixel size' | 'font name';
}

/** Rule 2: no literal colours, pixel sizes (other than 0 px and 1 px) or font family names outside var(--mf-font-*). */
export function scanComposition(composition: Pick<Composition, 'css' | 'script'>): ScanHit[] {
  const hits: ScanHit[] = [];
  const scan = (where: 'css' | 'script', text: string) => {
    for (const match of text.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) hits.push({ rule: 2, where, match: match[0], reason: 'hex colour' });
    for (const match of text.matchAll(/\brgba?\(/g)) hits.push({ rule: 2, where, match: match[0], reason: 'rgb colour' });
    for (const match of text.matchAll(/(\d*\.?\d+)px\b/g)) if (!['0', '1'].includes(match[1] ?? '')) hits.push({ rule: 2, where, match: match[0], reason: 'pixel size' });
    for (const match of text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      if (!/^\s*var\(--mf-font-[a-z]+\)\s*$/.test(match[1] ?? '')) hits.push({ rule: 2, where, match: match[0].trim(), reason: 'font name' });
    }
    for (const match of text.matchAll(/fontFamily\s*:\s*(['"][^'"]+['"])/g)) hits.push({ rule: 2, where, match: match[0], reason: 'font name' });
  };
  // In CSS only declarations hold values; selectors such as #id stay out of the scan.
  scan('css', [...composition.css.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '').join('\n'));
  scan('script', composition.script);
  return hits;
}

export const ALLOWED_LICENCES = ['MIT', 'CC0-1.0', 'public-domain'] as const;

/**
 * Rule 7: assets come from the kit, the brand, or the move's own `assets/`
 * folder listed in its `credits.json` (each file's origin and an allowed licence).
 */
export function checkAssets(assets: AssetRequest[], moveDir: string | null, allowedRoots: string[]): string[] {
  const problems: string[] = [];
  const own = moveDir ? path.join(moveDir, 'assets') : null;
  let credits: Record<string, { origin?: string; licence?: string }> = {};
  if (own && existsSync(path.join(own, 'credits.json'))) credits = JSON.parse(readFileSync(path.join(own, 'credits.json'), 'utf8')) as typeof credits;
  for (const asset of assets) {
    const from = path.resolve(asset.from);
    if (own && from.startsWith(`${path.resolve(own)}${path.sep}`)) {
      const name = path.relative(own, from).split(path.sep).join('/');
      const credit = credits[name];
      if (!credit?.origin) problems.push(`${name} has no origin in assets/credits.json`);
      else if (!(ALLOWED_LICENCES as readonly string[]).includes(credit.licence ?? '')) problems.push(`${name} is licensed ${credit.licence ?? 'unknown'}; only ${ALLOWED_LICENCES.join(', ')} are allowed`);
      continue;
    }
    if (!allowedRoots.some((root) => from.startsWith(`${path.resolve(root)}${path.sep}`))) problems.push(`${asset.from} is neither a kit, brand nor move asset`);
  }
  return problems;
}

export const DEMOS: readonly DemoBrand[] = DEMO_BRANDS;

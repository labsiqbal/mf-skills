// brand manual: a brand from files and colours the user provides, for sites
// that cannot be captured or users with no site. Also the pieces brand
// from-brief shares: brand ids, the library write, font roles and assets.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { FAMILY_SPECS, bundledFontsDir, nearestOfl, readFont } from '../fonts/index';
import { attr, elements, parseHtml } from '../lint/dom';
import { probe } from '../media/probe';
import { confine, homeLayout, lockFile, withLock } from '../paths/index';
import { run } from '../proc/run';
import { BRAND_VERSION, type BrandDoc } from '../schemas/brand';
import { readDoc, writeDoc } from '../schemas/index';
import { type BrandColors, type Evidence, ROLE_NUMBERS, contrast, hsl, luminance, parseColor, shiftLuminance, toHex } from './colors';
import type { FontFile, FontRole, FontRoles } from './fonts';
import { rgbToOklch } from './moods';
import { rightsNotice } from './rights';

type Rgb = [number, number, number];

/** brand manual takes 2-5 colours; shots follow brand.shots (3-6). */
export const MANUAL_COLORS = { min: 2, max: 5 } as const;
export const MANUAL_SHOTS = { min: 3, max: 6 } as const;

const BRAND_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

export function checkBrandId(id: string): string {
  if (!BRAND_ID.test(id) || id.length > 128) {
    throw new MfmError('USAGE', { flag: '--name', value: id }, {
      message: `--name ${JSON.stringify(id)} is not a brand id.`,
      hint: 'Use lowercase letters, digits and single hyphens, for example --name acme-coffee.',
    });
  }
  return id;
}

/** "acme-coffee" -> "Acme Coffee". */
export function displayName(id: string): string {
  return id
    .split(/[.-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Mix `from` toward `to` until the contrast against `against` drops to `ratio` (the capture fallback for muted). */
export function towardContrast(from: Rgb, to: Rgb, against: Rgb, ratio: number): Rgb {
  const mix = (t: number) => from.map((v, i) => Math.round(v + ((to[i] ?? 0) - v) * t)) as Rgb;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(mid), against) > ratio) lo = mid;
    else hi = mid;
  }
  return mix(lo);
}

export function parseHexList(values: string[], flag: string): Rgb[] {
  return values.map((value) => {
    const rgb = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim()) ? parseColor(value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`) : null;
    if (!rgb) {
      throw new MfmError('USAGE', { flag, value }, { message: `${flag} ${JSON.stringify(value)} is not a hex colour.`, hint: `Pass hex colours such as ${flag} "#101820,#F2AA4C,#FFFFFF".` });
    }
    return rgb;
  });
}

export interface ManualRoles {
  colors: BrandColors;
  warnings: string[];
}

/**
 * Colour roles for 2-5 user colours: the luminance extreme is ground, the
 * highest contrast against it ink, the most saturated of the rest accent;
 * accent2, surface and muted then follow the capture rules.
 */
export function manualRoles(input: Rgb[]): ManualRoles {
  if (input.length < MANUAL_COLORS.min || input.length > MANUAL_COLORS.max) {
    throw new MfmError('USAGE', { flag: '--colors', count: input.length }, {
      message: `Pass ${MANUAL_COLORS.min} to ${MANUAL_COLORS.max} colours; got ${input.length}.`,
      hint: 'For example --colors "#101820,#F2AA4C,#FFFFFF".',
    });
  }
  const n = ROLE_NUMBERS;
  const warnings: string[] = [];
  const evidence = (rgb: Rgb, against: Rgb, method: Evidence['method']): Evidence => ({ method, share: null, contrast: round3(contrast(rgb, against)) });

  // ground: of the darkest and lightest colour, the one further from mid lightness (lightest on a tie).
  const lightness = input.map((rgb) => rgbToOklch(rgb).l);
  const order = input.map((_, i) => i).sort((a, b) => (lightness[a] ?? 0) - (lightness[b] ?? 0) || a - b);
  const darkest = order[0] ?? 0;
  const lightest = order[order.length - 1] ?? 0;
  const groundIndex = Math.abs((lightness[darkest] ?? 0) - 0.5) > Math.abs((lightness[lightest] ?? 0) - 0.5) ? darkest : lightest;
  const ground = input[groundIndex] as Rgb;
  let rest = input.filter((_, i) => i !== groundIndex);

  // ink: the highest contrast against ground; below the floor, black or white as in capture.
  const inkPick = [...rest].sort((a, b) => contrast(b, ground) - contrast(a, ground))[0] as Rgb;
  let ink: Rgb;
  let inkEvidence: Evidence;
  if (contrast(inkPick, ground) >= n.inkContrastMin) {
    ink = inkPick;
    inkEvidence = evidence(ink, ground, 'manual');
    rest = rest.filter((rgb) => rgb !== inkPick);
  } else {
    const black: Rgb = [0, 0, 0];
    const white: Rgb = [255, 255, 255];
    ink = contrast(black, ground) >= contrast(white, ground) ? black : white;
    inkEvidence = evidence(ink, ground, 'generated');
    warnings.push(`No colour reaches ${n.inkContrastMin}:1 against ground ${toHex(ground)}; ink is ${toHex(ink)}.`);
  }

  // accent: the most saturated of the rest; with nothing left, ink (as capture does).
  const accentPick = [...rest].sort((a, b) => hsl(b).s - hsl(a).s)[0];
  const accent = accentPick ?? ink;
  const accentEvidence = evidence(accent, ground, accentPick ? 'manual' : 'generated');
  rest = rest.filter((rgb) => rgb !== accentPick);

  // accent2: a remaining saturated colour at least 40 degrees of hue from accent.
  const accent2 =
    rest.find((rgb) => distance(rgb, accent) >= n.mergeDistance && hsl(rgb).s >= n.accentSaturationMin && hueDistance(hsl(rgb).h, hsl(accent).h) >= n.accent2HueMinDeg) ?? null;
  if (accent2) rest = rest.filter((rgb) => rgb !== accent2);

  // surface: a remaining colour a little off ground; else ground shifted toward ink.
  const groundL = luminance(ground);
  const surfacePick = rest.find((rgb) => {
    const delta = Math.abs(luminance(rgb) - groundL);
    return delta >= n.surfaceDeltaLuminance[0] && delta <= n.surfaceDeltaLuminance[1] && distance(rgb, accent) >= n.mergeDistance;
  });
  const surface = surfacePick ?? shiftLuminance(ground, ink, n.surfaceFallbackShift);
  const surfaceEvidence = evidence(surface, ground, surfacePick ? 'manual' : 'generated');
  if (surfacePick) rest = rest.filter((rgb) => rgb !== surfacePick);

  // muted: a remaining low-saturation colour with moderate contrast; else ink eased toward ground.
  const mutedPick = rest.find((rgb) => {
    const c = contrast(rgb, ground);
    return hsl(rgb).s <= n.mutedSaturationMax && c >= n.mutedContrast[0] && c <= n.mutedContrast[1];
  });
  const muted = mutedPick ?? towardContrast(ink, ground, ground, 4.0);
  const mutedEvidence = evidence(muted, ground, mutedPick ? 'manual' : 'generated');

  const palette: Rgb[] = [];
  for (const rgb of [ground, ink, accent, ...(accent2 ? [accent2] : []), surface, muted, ...input]) {
    if (palette.length >= n.paletteMax) break;
    if (!palette.some((existing) => distance(existing, rgb) < n.mergeDistance)) palette.push(rgb);
  }
  return {
    colors: {
      ground: toHex(ground),
      ink: toHex(ink),
      accent: toHex(accent),
      accent2: accent2 ? toHex(accent2) : null,
      surface: toHex(surface),
      muted: toHex(muted),
      palette: palette.map(toHex),
      evidence: { ground: evidence(ground, ink, 'manual'), ink: inkEvidence, accent: accentEvidence, surface: surfaceEvidence, muted: mutedEvidence },
    },
    warnings,
  };
}

export interface Asset {
  path: string;
  kind: 'svg' | 'png' | 'jpg' | 'mp4';
  w: number;
  h: number;
}

export function svgSize(file: string): { w: number; h: number } {
  const svg = elements(parseHtml(readFileSync(file, 'utf8'))).find((element) => element.tagName === 'svg');
  const number = (value: string | undefined) => {
    const n = Number.parseFloat(value ?? '');
    return Number.isFinite(n) && n > 0 && !/%$/.test(value ?? '') ? n : null;
  };
  const box = (svg ? attr(svg, 'viewbox') ?? attr(svg, 'viewBox') : undefined)?.split(/[\s,]+/).map(Number);
  const w = number(svg ? attr(svg, 'width') : undefined) ?? (box && box.length === 4 ? (box[2] ?? 0) : 0);
  const h = number(svg ? attr(svg, 'height') : undefined) ?? (box && box.length === 4 ? (box[3] ?? 0) : 0);
  return { w: Math.max(1, Math.round(w || 100)), h: Math.max(1, Math.round(h || 100)) };
}

/** Copy a user file in under a stable name; rasters other than PNG/JPEG become PNG. Paths are relative to `dir`. */
export async function copyAsset(source: string, dir: string, base: string, allowVideo: boolean): Promise<Asset> {
  if (!existsSync(source)) throw new MfmError('USAGE', { file: source }, { message: `${source} does not exist.` });
  const ext = path.extname(source).toLowerCase();
  const target = (kind: string) => path.join(dir, `${base}.${kind}`);
  const rel = (file: string) => path.relative(dir, file).split(path.sep).join('/');
  mkdirSync(path.dirname(target('x')), { recursive: true });
  if (ext === '.svg') {
    copyFileSync(source, target('svg'));
    return { path: rel(target('svg')), kind: 'svg', ...svgSize(source) };
  }
  let kind: Asset['kind'];
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    kind = ext === '.png' ? 'png' : 'jpg';
    copyFileSync(source, target(kind));
  } else if (ext === '.mp4' && allowVideo) {
    kind = 'mp4';
    copyFileSync(source, target(kind));
  } else {
    kind = 'png';
    const converted = await run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-frames:v', '1', target(kind)], { timeoutMs: 120_000 });
    if (converted.code !== 0) {
      throw new MfmError('USAGE', { file: source }, { message: `${path.basename(source)} is not an image mf-motion can read.`, hint: 'Use SVG, PNG or JPEG files.' });
    }
  }
  const info = await probe(target(kind));
  return { path: rel(target(kind)), kind, w: info.video?.width ?? 1, h: info.video?.height ?? 1 };
}

const ROLE_WEIGHTS = { display: 700, heading: 600, body: 400, mono: 400 } as const;

function fontFile(dir: string, file: string, source: FontFile['source']): FontFile {
  const info = readFont(readFileSync(path.join(dir, file)));
  const wght = info.axes.find((axis) => axis.tag === 'wght');
  return {
    path: file,
    weight: wght ? `${wght.min} ${wght.max}` : String(info.weightClass),
    style: info.italic ? 'italic' : 'normal',
    axes: info.axes.length > 0 ? info.axes.map((axis) => axis.tag).join(',') : null,
    source,
    origin: null,
    licenceHint: source === 'user' ? 'user-asserted' : 'ofl',
  };
}

/** The weight a role gets from its files: the role's usual weight when a file covers it, else the nearest. */
function roleWeight(files: FontFile[], want: number): number {
  const ranges = files.filter((file) => file.style === 'normal').map((file) => file.weight.split(' ').map(Number) as [number, number?]);
  let best = want;
  let gap = Number.POSITIVE_INFINITY;
  for (const [lo, hi = lo] of ranges) {
    const pick = Math.min(hi, Math.max(lo, want));
    if (Math.abs(pick - want) < gap) {
      gap = Math.abs(pick - want);
      best = pick;
    }
  }
  return Math.round(best);
}

/** A role set in a bundled family; its files are copied into <brand>/fonts/. */
export function bundledRole(brandDir: string, familyId: string, role: keyof typeof ROLE_WEIGHTS): FontRole {
  const spec = FAMILY_SPECS.find((family) => family.id === familyId && family.source === 'bundled');
  if (!spec) {
    const ids = FAMILY_SPECS.filter((family) => family.source === 'bundled').map((family) => family.id);
    throw new MfmError('USAGE', { flag: '--family', value: familyId, families: ids }, { message: `${familyId} is not a bundled font family.`, hint: `Use one of: ${ids.join(', ')}.` });
  }
  mkdirSync(path.join(brandDir, 'fonts'), { recursive: true });
  const files = spec.files.map((file) => {
    copyFileSync(path.join(bundledFontsDir(), spec.id, file), path.join(brandDir, 'fonts', file));
    return fontFile(brandDir, `fonts/${file}`, 'bundled');
  });
  return { family: spec.name, weight: roleWeight(files, ROLE_WEIGHTS[role]), sizePx: null, letterSpacingEm: null, lineHeight: null, files, fallback: spec.id };
}

/** Roles from user font files: the first family sets display and heading, the second (else the first) body, a fixed-pitch family mono. */
export function userRoles(brandDir: string, sources: string[]): FontRoles {
  mkdirSync(path.join(brandDir, 'fonts'), { recursive: true });
  const families = new Map<string, { files: FontFile[]; fallback: string; mono: boolean }>();
  const used = new Set<string>();
  for (const source of sources) {
    if (!existsSync(source)) throw new MfmError('USAGE', { flag: '--fonts', file: source }, { message: `${source} does not exist.` });
    let info;
    try {
      info = readFont(readFileSync(source));
    } catch (error) {
      throw new MfmError('USAGE', { flag: '--fonts', file: source }, {
        message: `${path.basename(source)} is not a font mf-motion can read (${error instanceof Error ? error.message : String(error)}).`,
        hint: 'Pass TTF, OTF, WOFF or WOFF2 files.',
      });
    }
    let name = path.basename(source);
    for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${path.basename(source, path.extname(source))}-${i}${path.extname(source)}`;
    used.add(name.toLowerCase());
    copyFileSync(source, path.join(brandDir, 'fonts', name));
    const file = fontFile(brandDir, `fonts/${name}`, 'user');
    const family = info.typographicFamily || info.family || name;
    const fallback = nearestOfl(source).id;
    const entry = families.get(family) ?? { files: [], fallback, mono: fallback === 'noto-sans-mono' };
    entry.files.push(file);
    families.set(family, entry);
  }
  const list = [...families];
  const text = list.filter(([, entry]) => !entry.mono);
  const role = ([family, entry]: [string, { files: FontFile[]; fallback: string }], name: keyof typeof ROLE_WEIGHTS): FontRole => ({
    family,
    weight: roleWeight(entry.files, ROLE_WEIGHTS[name]),
    sizePx: null,
    letterSpacingEm: null,
    lineHeight: null,
    files: entry.files,
    fallback: entry.fallback,
  });
  const first = text[0] ?? list[0];
  const second = text[1] ?? first;
  const mono = list.find(([, entry]) => entry.mono);
  return {
    display: first ? role(first, 'display') : null,
    heading: first ? role(first, 'heading') : null,
    body: second ? role(second, 'body') : null,
    mono: mono ? role(mono, 'mono') : null,
  };
}

export interface LibraryWrite {
  home: string;
  id: string;
  /** Fills the brand folder (logo, fonts, shots) and returns the document fields that depend on it. */
  fill: (dir: string) => Promise<Omit<BrandDoc, 'schemaVersion' | 'kind' | 'id' | 'rights' | 'candidates' | 'copy' | 'radiusPx' | 'buttons' | 'mark'> & { copy?: BrandDoc['copy'] }>;
  project?: string | null;
  onWarn?: (message: string) => void;
  command: string;
}

/**
 * Write a manual or from-brief brand into the library, replacing an earlier
 * manual or from-brief brand of the same id. A captured brand is never replaced.
 */
export async function writeLibraryBrand(request: LibraryWrite): Promise<{ doc: BrandDoc; dir: string; notice: string | null }> {
  const brands = homeLayout(request.home).brands;
  const dir = confine(brands, checkBrandId(request.id));
  mkdirSync(dir, { recursive: true });
  return withLock(
    lockFile(dir),
    async () => {
      const file = path.join(dir, 'brand.json');
      if (existsSync(file)) {
        const { doc } = readDoc('brand', file);
        if (doc.source.mode === 'capture-url' || doc.source.mode === 'capture-local') {
          throw new MfmError('USAGE', { brand: request.id, mode: doc.source.mode }, {
            message: `Brand ${request.id} already exists as a captured brand.`,
            hint: 'Choose another --name, or remove the captured brand first with `mf-motion brand rm <id> --yes`.',
          });
        }
      }
      for (const old of ['logo', 'mark']) for (const ext of ['svg', 'png', 'jpg', 'mp4']) rmSync(path.join(dir, `${old}.${ext}`), { force: true });
      for (const old of ['shots', 'fonts']) rmSync(path.join(dir, old), { recursive: true, force: true });
      const notice = rightsNotice(request.home, 'brand', { project: request.project ?? null });
      const filled = await request.fill(dir);
      const doc: BrandDoc = {
        schemaVersion: BRAND_VERSION,
        kind: 'brand',
        id: request.id,
        candidates: { sheet: null, logoSheet: null, logos: [], shots: [] },
        mark: null,
        radiusPx: null,
        buttons: [],
        copy: { headline: null, cta: null, domain: null },
        rights: { noticeShownAt: notice.shownAt, oflSubstituted: false },
        ...filled,
      } as BrandDoc;
      writeDoc('brand', file, doc);
      const md = [
        `# Brand ${request.id}`,
        '',
        `- Name: ${doc.name}`,
        `- Source: ${doc.source.mode}`,
        `- Status: ${doc.status}${doc.status === 'draft' ? ' (films need 3-6 shots; moves can use it now)' : ''}`,
        `- Colours: ground ${doc.colors.ground}, ink ${doc.colors.ink}, accent ${doc.colors.accent}`,
        '',
      ].join('\n');
      writeFileSync(path.join(dir, 'brand.md'), md);
      return { doc, dir, notice: notice.text };
    },
    { command: request.command, ...(request.onWarn ? { onStale: request.onWarn } : {}) },
  );
}

export interface ManualRequest {
  home: string;
  id: string;
  logo: string;
  colors: string[];
  fonts?: string[];
  family?: string;
  shots?: string[];
  tagline?: string;
  project?: string | null;
  onWarn?: (message: string) => void;
}

/** brand manual: picked with 3-6 shots, else draft. */
export async function manualBrand(request: ManualRequest) {
  checkBrandId(request.id);
  if (request.fonts && request.fonts.length > 0 && request.family) {
    throw new MfmError('USAGE', { flags: ['--fonts', '--family'] }, { message: 'Pass --fonts or --family, not both.' });
  }
  const shots = request.shots ?? [];
  if (shots.length > 0 && (shots.length < MANUAL_SHOTS.min || shots.length > MANUAL_SHOTS.max)) {
    throw new MfmError('USAGE', { flag: '--shots', count: shots.length }, {
      message: `Pass ${MANUAL_SHOTS.min} to ${MANUAL_SHOTS.max} shots; got ${shots.length}.`,
      hint: 'Leave --shots out for a draft brand, or pass 3 to 6 screenshots or product images.',
    });
  }
  const roles = manualRoles(parseHexList(request.colors, '--colors'));
  if (!existsSync(request.logo)) throw new MfmError('USAGE', { flag: '--logo', file: request.logo }, { message: `${request.logo} does not exist.` });
  for (const warning of roles.warnings) request.onWarn?.(warning);
  const result = await writeLibraryBrand({
    home: request.home,
    id: request.id,
    project: request.project ?? null,
    command: 'brand manual',
    ...(request.onWarn ? { onWarn: request.onWarn } : {}),
    fill: async (dir) => {
      const logo = await copyAsset(path.resolve(request.logo), dir, 'logo', false);
      const placed = [];
      for (const [i, shot] of shots.entries()) {
        const asset = await copyAsset(path.resolve(shot), dir, `shots/shot-${i + 1}`, true);
        placed.push({ ...asset, from: path.basename(shot), note: null });
      }
      let type: FontRoles;
      if (request.fonts && request.fonts.length > 0) {
        type = userRoles(dir, request.fonts.map((file) => path.resolve(file)));
      } else {
        const family = request.family ?? 'inter';
        type = { display: bundledRole(dir, family, 'display'), heading: bundledRole(dir, family, 'heading'), body: bundledRole(dir, family, 'body'), mono: null };
      }
      return {
        name: displayName(request.id),
        tagline: request.tagline ?? null,
        status: placed.length > 0 ? ('picked' as const) : ('draft' as const),
        source: { mode: 'manual' as const, url: null, capturedAt: null, engine: null },
        colors: roles.colors,
        type,
        logo,
        shots: placed,
      };
    },
  });
  return { brand: { ...result.doc, dir: result.dir }, notice: result.notice, warnings: roles.warnings };
}

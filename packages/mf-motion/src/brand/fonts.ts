// Brand font roles from a capture: display, heading, body and mono, each with
// the chosen files, where they came from, a licence hint, and a bundled OFL
// fallback. Also the swap to bundled OFL families (`brand fonts --substitute-ofl`).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { FAMILY_SPECS, bundledFontsDir, nearestOfl, readFont } from '../fonts/index';
import { attr, elements, parseHtml } from '../lint/dom';
import { commercialHost } from './fontHosts';

export const FONT_ROLES = ['display', 'heading', 'body', 'mono'] as const;
export type FontRoleName = (typeof FONT_ROLES)[number];

export type LicenceHint = 'ofl' | 'apache' | 'commercial-webfont' | 'unknown' | 'user-asserted';

export interface FontFile {
  path: string;
  weight: string;
  style: 'normal' | 'italic';
  axes: string | null;
  source: 'captured' | 'bundled' | 'user';
  origin: string | null;
  licenceHint: LicenceHint;
}

export interface FontRole {
  family: string;
  weight: number;
  sizePx: number | null;
  letterSpacingEm: number | null;
  lineHeight: number | null;
  files: FontFile[];
  fallback: string;
}

export type FontRoles = Record<FontRoleName, FontRole | null>;

export interface FontFace {
  family: string;
  /** url() values of src, in order. */
  urls: string[];
  weight: string;
  style: 'normal' | 'italic';
  unicodeRange: string | null;
}

const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, '');

/** @font-face rules of a stylesheet. */
export function fontFaces(css: string): FontFace[] {
  const faces: FontFace[] = [];
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return faces;
  }
  root.walkAtRules(/^font-face$/i, (rule) => {
    const get = (prop: string) => {
      let value: string | null = null;
      rule.walkDecls(new RegExp(`^${prop}$`, 'i'), (decl) => {
        value = decl.value;
      });
      return value as string | null;
    };
    const family = get('font-family');
    const src = get('src');
    if (!family || !src) return;
    const urls = [...src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map((m) => m[1] ?? m[2] ?? m[3] ?? '').filter(Boolean);
    faces.push({
      family: unquote(family),
      urls,
      weight: (get('font-weight') ?? '400').trim(),
      style: /italic|oblique/i.test(get('font-style') ?? '') ? 'italic' : 'normal',
      unicodeRange: get('unicode-range'),
    });
  });
  return faces;
}

/** Stylesheet text of a page: every <style> block. */
export function styleText(html: string): string {
  return elements(parseHtml(html))
    .filter((element) => element.tagName === 'style')
    .map((element) => element.childNodes.map((child) => ('value' in child ? String(child.value) : '')).join(''))
    .join('\n');
}

/** Hrefs of <link rel=preload as=font> and of every external stylesheet or script. */
export function pageLinks(html: string): { preloads: string[]; external: string[] } {
  const preloads: string[] = [];
  const external: string[] = [];
  for (const element of elements(parseHtml(html))) {
    const rel = (attr(element, 'rel') ?? '').toLowerCase();
    const href = attr(element, 'href') ?? attr(element, 'src');
    if (!href) continue;
    if (element.tagName === 'link' && rel.includes('preload') && (attr(element, 'as') ?? '').toLowerCase() === 'font') preloads.push(href);
    if ((element.tagName === 'link' || element.tagName === 'script') && /^(https?:)?\/\//i.test(href)) external.push(href);
  }
  return { preloads, external };
}

const basename = (url: string) => {
  const clean = url.split(/[?#]/)[0] ?? '';
  try {
    return decodeURIComponent(clean.split('/').pop() ?? '');
  } catch {
    return clean.split('/').pop() ?? '';
  }
};

/**
 * Original URL of each font file by file name, from the page's own HTML and
 * the stylesheets it links locally (local captures: `baseHref` is the page file).
 */
export function fontOrigins(html: string, readLocal: (href: string) => string | null): Map<string, string> {
  const origins = new Map<string, string>();
  const sheets = [styleText(html)];
  for (const element of elements(parseHtml(html))) {
    if (element.tagName !== 'link' || !/stylesheet/i.test(attr(element, 'rel') ?? '')) continue;
    const href = attr(element, 'href');
    const css = href ? readLocal(href) : null;
    if (css) sheets.push(css);
  }
  for (const face of sheets.flatMap(fontFaces)) for (const url of face.urls) origins.set(basename(url), url);
  for (const href of pageLinks(html).preloads) if (!origins.has(basename(href))) origins.set(basename(href), href);
  return origins;
}

/** Licence hint for one file: the name table first, then the URL, then the host. */
export function licenceHint(file: string, origin: string | null, pageUsesCommercialHost: boolean): LicenceHint {
  let licence = '';
  try {
    const info = readFont(readFileSync(file));
    licence = `${info.licence} ${info.licenceUrl}`;
  } catch {
    licence = '';
  }
  if (/open font licen[cs]e|\bofl\b|scripts\.sil\.org\/ofl|openfontlicense\.org/i.test(licence)) return 'ofl';
  if (/apache licen[cs]e|apache\.org\/licenses/i.test(licence)) return 'apache';
  if (origin && /\/ofl\//i.test(origin)) return 'ofl';
  if (origin && /\/apache\//i.test(origin)) return 'apache';
  if (commercialHost(origin) || (!origin && pageUsesCommercialHost)) return 'commercial-webfont';
  return 'unknown';
}

const px = (value: string | undefined) => {
  const match = value?.trim().match(/^(-?\d*\.?\d+)px$/);
  return match ? Number(match[1]) : null;
};

function emOf(value: string | undefined, sizePx: number | null): number | null {
  if (!value || value === 'normal') return null;
  const em = value.trim().match(/^(-?\d*\.?\d+)em$/);
  if (em) return Number(em[1]);
  const p = px(value);
  return p !== null && sizePx ? Math.round((p / sizePx) * 1000) / 1000 : null;
}

function lineHeightOf(value: string | undefined, sizePx: number | null): number | null {
  if (!value || value === 'normal') return null;
  if (/^\d*\.?\d+$/.test(value.trim())) return Number(value);
  const p = px(value);
  return p !== null && sizePx ? Math.round((p / sizePx) * 1000) / 1000 : null;
}

function weightMatches(faceWeight: string, weight: number): boolean {
  const value = faceWeight.trim().toLowerCase();
  if (value === 'normal') return weight === 400;
  if (value === 'bold') return weight === 700;
  const parts = value.split(/\s+/).map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return weight >= (parts[0] ?? 0) && weight <= (parts[1] ?? 1000);
  return parts[0] === weight;
}

/** A face with no unicode-range, or one that starts at U+0000 (the Latin subset). */
const isLatinSubset = (range: string | null) => range === null || /U\+0{1,4}(?![0-9A-F])/i.test(range) || /U\+0{0,2}20-/i.test(range);

export interface CapturedFontInput {
  /** brands/<id> folder; file paths in the roles are relative to it. */
  brandDir: string;
  /** The capture folder (brands/<id>/capture). */
  captureDir: string;
  /** Original font URL by file name (empty when unknown). */
  origins: Map<string, string>;
}

/** Map captured fonts to roles, choose files, and attach licence hints and fallbacks. */
export function mapFontRoles(input: CapturedFontInput): FontRoles {
  const read = (rel: string) => {
    try {
      return readFileSync(path.join(input.captureDir, rel), 'utf8');
    } catch {
      return '';
    }
  };
  const styles = JSON.parse(read('extracted/design-styles.json') || '{}') as { typography?: Array<Record<string, string>> };
  const page = read('extracted/page.html');
  const faces = fontFaces(styleText(page));
  const links = pageLinks(page);
  const pageCommercial = links.external.some((href) => commercialHost(href) !== null);
  const preloaded = new Set(links.preloads.map(basename));
  const typography = styles.typography ?? [];
  const pick = (role: string) => typography.find((entry) => entry.role === role);
  const sources: Record<FontRoleName, Record<string, string> | undefined> = {
    display: pick('display') ?? typography[0],
    heading: pick('heading') ?? pick('display'),
    body: pick('body'),
    mono: pick('code') ?? pick('mono'),
  };
  const roles = {} as FontRoles;
  for (const role of FONT_ROLES) {
    const entry = sources[role];
    if (!entry?.fontFamily) {
      roles[role] = null;
      continue;
    }
    const family = unquote(entry.fontFamily.split(',')[0] ?? '');
    const weight = Number.parseInt(entry.fontWeight ?? '400', 10) || 400;
    const sizePx = px(entry.fontSize);
    const candidates = faces
      .filter((face) => face.family.toLowerCase() === family.toLowerCase() && face.style === 'normal')
      .flatMap((face) => face.urls.map((url) => ({ face, url, file: path.join(input.captureDir, url) })))
      .filter((candidate) => existsSync(candidate.file));
    const ranked = candidates
      .map((candidate) => {
        let axes: string[] = [];
        try {
          axes = readFont(readFileSync(candidate.file)).axes.map((axis) => axis.tag);
        } catch {
          axes = [];
        }
        return {
          ...candidate,
          axes,
          variable: axes.includes('wght'),
          fits: weightMatches(candidate.face.weight, weight) || axes.includes('wght'),
          preloadedLatin: preloaded.has(basename(candidate.url)) && isLatinSubset(candidate.face.unicodeRange),
          woff2: /\.woff2$/i.test(candidate.url),
          size: statSync(candidate.file).size,
        };
      })
      .sort(
        (a, b) =>
          Number(b.fits) - Number(a.fits) ||
          Number(b.variable) - Number(a.variable) ||
          Number(b.preloadedLatin) - Number(a.preloadedLatin) ||
          Number(b.woff2) - Number(a.woff2) ||
          b.size - a.size,
      );
    const chosen = ranked[0];
    const files: FontFile[] = chosen
      ? [
          {
            path: path.relative(input.brandDir, chosen.file).split(path.sep).join('/'),
            weight: chosen.face.weight.replace(/\s+/g, ' '),
            style: chosen.face.style,
            axes: chosen.axes.length > 0 ? chosen.axes.join(',') : null,
            source: 'captured',
            origin: input.origins.get(basename(chosen.url)) ?? null,
            licenceHint: licenceHint(chosen.file, input.origins.get(basename(chosen.url)) ?? null, pageCommercial),
          },
        ]
      : [];
    let fallback: string = role === 'mono' ? 'noto-sans-mono' : /serif/i.test(entry.fontFamily) && !/sans/i.test(entry.fontFamily) ? 'noto-serif' : 'inter';
    if (chosen) {
      try {
        fallback = nearestOfl(chosen.file).id;
      } catch {
        // Keep the name-based fallback.
      }
    }
    roles[role] = {
      family,
      weight,
      sizePx,
      letterSpacingEm: emOf(entry.letterSpacing, sizePx),
      lineHeight: lineHeightOf(entry.lineHeight, sizePx),
      files,
      fallback,
    };
  }
  return roles;
}

/** Roles whose files are not known to be free for video. */
export function riskyRoles(roles: FontRoles): FontRoleName[] {
  return FONT_ROLES.filter((role) => roles[role]?.files.some((file) => file.licenceHint === 'commercial-webfont' || file.licenceHint === 'unknown'));
}

/** The FONT_LICENCE_UNKNOWN warning and its next command, when any role is risky. */
export function fontWarnings(id: string, roles: FontRoles): { warnings: Array<{ code: 'FONT_LICENCE_UNKNOWN'; message: string; details: { roles: FontRoleName[] } }>; next: string[] } {
  const risky = riskyRoles(roles);
  if (risky.length === 0) return { warnings: [], next: [] };
  return {
    warnings: [
      {
        code: 'FONT_LICENCE_UNKNOWN',
        message: `The ${risky.join(', ')} font(s) may be licensed for websites only, not for video.`,
        details: { roles: risky },
      },
    ],
    next: [`mf-motion brand fonts ${id} --substitute-ofl --json`],
  };
}

/** Replace risky roles with the nearest bundled OFL family; files are copied into brands/<id>/fonts/. */
export function substituteOfl(roles: FontRoles, brandDir: string): { roles: FontRoles; replaced: Array<{ role: FontRoleName; from: string; to: string }> } {
  const replaced: Array<{ role: FontRoleName; from: string; to: string }> = [];
  const next = { ...roles };
  for (const role of riskyRoles(roles)) {
    const current = roles[role];
    if (!current) continue;
    const firstFile = current.files[0];
    let target = current.fallback;
    if (firstFile) {
      try {
        target = nearestOfl(path.join(brandDir, firstFile.path)).id;
      } catch {
        target = current.fallback;
      }
    }
    const spec = FAMILY_SPECS.find((family) => family.id === target && family.source === 'bundled') ?? FAMILY_SPECS.find((family) => family.id === 'inter');
    if (!spec) continue;
    const fontsDir = path.join(brandDir, 'fonts');
    mkdirSync(fontsDir, { recursive: true });
    const files: FontFile[] = spec.files.map((file) => {
      copyFileSync(path.join(bundledFontsDir(), spec.id, file), path.join(fontsDir, file));
      const info = readFont(readFileSync(path.join(fontsDir, file)));
      const wght = info.axes.find((axis) => axis.tag === 'wght');
      return {
        path: `fonts/${file}`,
        weight: wght ? `${wght.min} ${wght.max}` : String(info.weightClass),
        style: info.italic ? 'italic' : 'normal',
        axes: info.axes.length > 0 ? info.axes.map((axis) => axis.tag).join(',') : null,
        source: 'bundled',
        origin: null,
        licenceHint: 'ofl',
      };
    });
    next[role] = { ...current, family: spec.name, files, fallback: spec.id };
    replaced.push({ role, from: current.family, to: spec.id });
  }
  return { roles: next, replaced };
}

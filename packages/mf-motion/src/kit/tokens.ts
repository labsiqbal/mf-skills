// Brand tokens: any brand.json as CSS custom properties and runtime values.
// Derived colours are computed in OKLab/OKLCH; every derived text colour is
// checked against contrast.textMin and swaps to ink when it falls short.
import { FAMILY_SPECS } from '../fonts/index';
import { type AspectKey, NUMBERS, aspectSize } from './numbers';
import { type Rgb, contrastRatio, mixOklab, parseHex, rotateHue, scaleLightness, toHex } from './oklch';

export const FONT_ROLE_NAMES = ['display', 'heading', 'body', 'mono'] as const;
export type FontRoleName = (typeof FONT_ROLE_NAMES)[number];

/** The parts of brand.json tokens read. */
export interface TokenBrand {
  colors: { ground: string; surface: string; ink: string; muted: string; accent: string; accent2: string | null };
  type?: Partial<Record<FontRoleName, { family: string; weight: number; fallback: string } | null>>;
  radiusPx?: number | null;
}

/** Accent2 fallback: the accent's hue turned by this many degrees. */
export const ACCENT2_HUE_ROTATION_DEG = 35;
/** Derived mixes (component-kit.md, Tokens). */
export const DERIVED = { accentSoft: 0.16, ink2: 0.72, line: 0.12, shadowLightness: 0.4, shadowAlpha: 0.45 } as const;
/** Corner radius in u when the brand has none. */
export const DEFAULT_RADIUS_U = 12;

export interface FontToken {
  family: string;
  weight: number;
  /** Bundled family id used when the brand's files are missing. */
  fallback: string;
  /** CSS font-family value. */
  stack: string;
}

export interface TextPair {
  text: 'ink-2';
  on: 'ground' | 'surface';
  contrast: number;
}

export interface BrandTokens {
  colors: {
    ground: string;
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    accent2: string;
    accentSoft: string;
    ink2: string;
    line: string;
    /** CSS colour with alpha. */
    shadow: string;
  };
  fonts: Record<FontRoleName, FontToken>;
  /** Corner radius in u. */
  radiusU: number;
  /** Pixels per u for the frame size (min(W, H) / 1080). */
  u: number;
  /** Derived text pairs as first computed, before any swap. */
  pairs: TextPair[];
  /** Derived text tokens that fell below contrast.textMin and became ink. */
  swapped: Array<'ink-2'>;
  vars: Record<string, string>;
}

const GENERIC: Record<string, string> = { serif: 'serif', sans: 'sans-serif', mono: 'monospace', emoji: 'sans-serif' };

function fontToken(role: FontRoleName, brand: TokenBrand): FontToken {
  const type = brand.type ?? {};
  const order: Record<FontRoleName, FontRoleName[]> = {
    display: ['display', 'heading', 'body'],
    heading: ['heading', 'display', 'body'],
    body: ['body', 'heading', 'display'],
    mono: ['mono'],
  };
  const found = order[role].map((name) => type[name]).find((entry) => entry);
  const fallbackId = found?.fallback ?? (role === 'mono' ? 'noto-sans-mono' : 'inter');
  const spec = FAMILY_SPECS.find((family) => family.id === fallbackId) ?? FAMILY_SPECS.find((family) => family.id === 'inter');
  const family = found?.family ?? spec?.name ?? 'Inter';
  const names = [...new Set([family, spec?.name].filter((name): name is string => Boolean(name)))];
  const stack = [...names.map((name) => `"${name.replace(/["\\]/g, '')}"`), GENERIC[spec?.classification ?? 'sans'] ?? 'sans-serif'].join(', ');
  const weight = found?.weight ?? (role === 'display' ? 700 : role === 'heading' ? 600 : 400);
  return { family, weight, fallback: fallbackId, stack };
}

const rgba = (rgb: Rgb, alpha: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

/** Tokens for a brand at a frame size (default the 16:9 base frame). */
export function brandTokens(brand: TokenBrand, frame: { aspect?: AspectKey; width?: number; height?: number } = {}): BrandTokens {
  const base = aspectSize(frame.aspect ?? '16:9');
  const width = frame.width ?? base.width;
  const height = frame.height ?? (frame.width ? Math.round((base.height * frame.width) / base.width) : base.height);
  const u = Math.min(width, height) / NUMBERS['unit.u'].base;

  const ground = parseHex(brand.colors.ground);
  const surface = parseHex(brand.colors.surface);
  const ink = parseHex(brand.colors.ink);
  const accent = parseHex(brand.colors.accent);
  const accent2 = brand.colors.accent2 ? parseHex(brand.colors.accent2) : rotateHue(accent, ACCENT2_HUE_ROTATION_DEG);

  const accentSoft = mixOklab(ground, accent, DERIVED.accentSoft);
  let ink2 = mixOklab(ground, ink, DERIVED.ink2);
  const line = mixOklab(ground, ink, DERIVED.line);
  const shadow = scaleLightness(ground, DERIVED.shadowLightness);

  const min = NUMBERS['contrast.textMin'];
  const pairs: TextPair[] = [
    { text: 'ink-2', on: 'ground', contrast: contrastRatio(ink2, ground) },
    { text: 'ink-2', on: 'surface', contrast: contrastRatio(ink2, surface) },
  ].map((pair) => ({ ...pair, contrast: Math.round(pair.contrast * 1000) / 1000 })) as TextPair[];
  const swapped: Array<'ink-2'> = [];
  if (pairs.some((pair) => pair.contrast < min)) {
    ink2 = ink;
    swapped.push('ink-2');
  }

  const fonts = Object.fromEntries(FONT_ROLE_NAMES.map((role) => [role, fontToken(role, brand)])) as Record<FontRoleName, FontToken>;
  const radiusU = brand.radiusPx ?? DEFAULT_RADIUS_U;
  const colors = {
    ground: toHex(ground),
    surface: toHex(surface),
    ink: toHex(ink),
    muted: toHex(parseHex(brand.colors.muted)),
    accent: toHex(accent),
    accent2: toHex(accent2),
    accentSoft: toHex(accentSoft),
    ink2: toHex(ink2),
    line: toHex(line),
    shadow: rgba(shadow, DERIVED.shadowAlpha),
  };
  const vars: Record<string, string> = {
    '--mf-ground': colors.ground,
    '--mf-surface': colors.surface,
    '--mf-ink': colors.ink,
    '--mf-muted': colors.muted,
    '--mf-accent': colors.accent,
    '--mf-accent2': colors.accent2,
    '--mf-accent-soft': colors.accentSoft,
    '--mf-ink-2': colors.ink2,
    '--mf-line': colors.line,
    '--mf-shadow': colors.shadow,
    '--mf-radius': `calc(${radiusU} * var(--mf-u))`,
    '--mf-font-display': fonts.display.stack,
    '--mf-font-heading': fonts.heading.stack,
    '--mf-font-body': fonts.body.stack,
    '--mf-font-mono': fonts.mono.stack,
    '--mf-u': `${Math.round(u * 10000) / 10000}px`,
  };
  return { colors, fonts, radiusU, u, pairs, swapped, vars };
}

/** The tokens (and optional extra custom properties, such as safe-box insets) as one CSS rule. */
export function tokensCss(vars: Record<string, string>, selector = ':root'): string {
  return `${selector} {\n${Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')}\n}\n`;
}

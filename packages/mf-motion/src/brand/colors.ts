// Colour roles by usage: ground, ink, accent, accent2, surface, muted and the
// palette, each with the method and evidence that chose it.
import { NUMBERS } from '../kit/numbers';
import type { Frame } from '../media/pixels';

/**
 * Thresholds: the section 10 colour roles and brand.paletteMax come from the
 * numbers module; the rest are capture-method details (brand-intake.md).
 */
export const ROLE_NUMBERS = {
  inkContrastMin: NUMBERS['role.ink.contrastMin'],
  accentSaturationMin: NUMBERS['role.accent.saturationMin'],
  accentLuminance: [NUMBERS['role.accent.luminance'].min, NUMBERS['role.accent.luminance'].max] as const,
  surfaceDeltaLuminance: [NUMBERS['role.surface.deltaLuminance'].min, NUMBERS['role.surface.deltaLuminance'].max] as const,
  surfaceFallbackShift: 0.04,
  mutedSaturationMax: NUMBERS['role.muted.saturationMax'],
  mutedContrast: [NUMBERS['role.muted.contrast'].min, NUMBERS['role.muted.contrast'].max] as const,
  accent2HueMinDeg: 40,
  paletteMax: NUMBERS['brand.paletteMax'],
  mergeDistance: 28,
  photoTilePx: 32,
  photoTileColors: 64,
} as const;

export type Method = 'area' | 'text-use' | 'button-fill' | 'interactive' | 'manual' | 'generated';

export interface Evidence {
  method: Method;
  share: number | null;
  contrast: number | null;
}

export interface BrandColors {
  ground: string;
  ink: string;
  accent: string;
  accent2: string | null;
  surface: string;
  muted: string;
  palette: string[];
  evidence: Record<'ground' | 'ink' | 'accent' | 'surface' | 'muted', Evidence>;
}

export interface ColorStat {
  hex: string;
  count?: number;
  bgCount?: number;
  interactiveBg?: number;
  areaBg?: number;
  textCount?: number;
  maxArea?: number;
}

export interface RoleInputs {
  /** The capture's extracted/tokens.json (colorStats, colors). */
  tokens: { colorStats?: ColorStat[]; colors?: string[] } & Record<string, unknown>;
  /** The capture's extracted/design-styles.json (buttons, cards, typography). */
  computedStyles: {
    buttons?: Array<{ background?: string; color?: string; height?: string; label?: string }>;
    cards?: Array<{ background?: string }>;
    typography?: Array<{ color?: string; sampleText?: string }>;
  } & Record<string, unknown>;
  /** Decoded viewport screenshots (rgba). */
  screenshots: Frame[];
}

type Rgb = [number, number, number];

export function parseColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const full = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
    if (alpha < 0.99) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

export const toHex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const unlinear = (v: number) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export function luminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL saturation (0-1) and hue (degrees). */
export function hsl(rgb: Rgb): { h: number; s: number; l: number } {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

const round3 = (value: number) => Math.round(value * 1000) / 1000;

interface Weighted {
  rgb: Rgb;
  weight: number;
}

/** Merge colours closer than the merge distance; the heaviest member names the group. */
function mergeWeighted(items: Weighted[], mergeDistance: number = ROLE_NUMBERS.mergeDistance): Weighted[] {
  const groups: Array<{ rgb: Rgb; weight: number; best: number }> = [];
  for (const item of [...items].sort((a, b) => b.weight - a.weight)) {
    const near = groups.find((group) => distance(group.rgb, item.rgb) < mergeDistance);
    if (near) near.weight += item.weight;
    else groups.push({ rgb: item.rgb, weight: item.weight, best: item.weight });
  }
  return groups.map(({ rgb, weight }) => ({ rgb, weight })).sort((a, b) => b.weight - a.weight);
}

/** Painted area per colour across screenshots, skipping photo-like tiles. */
export function paintedArea(frames: Frame[]): { colors: Weighted[]; total: number } {
  const counts = new Map<number, number>();
  let total = 0;
  const tile = ROLE_NUMBERS.photoTilePx;
  for (const frame of frames) {
    if (frame.format !== 'rgba') continue;
    for (let ty = 0; ty < frame.height; ty += tile) {
      for (let tx = 0; tx < frame.width; tx += tile) {
        const local = new Map<number, number>();
        for (let y = ty; y < Math.min(frame.height, ty + tile); y += 1) {
          for (let x = tx; x < Math.min(frame.width, tx + tile); x += 1) {
            const i = (y * frame.width + x) * 4;
            const key = ((frame.data[i] ?? 0) << 16) | ((frame.data[i + 1] ?? 0) << 8) | (frame.data[i + 2] ?? 0);
            local.set(key, (local.get(key) ?? 0) + 1);
          }
        }
        if (local.size > ROLE_NUMBERS.photoTileColors) continue;
        for (const [key, n] of local) {
          counts.set(key, (counts.get(key) ?? 0) + n);
          total += n;
        }
      }
    }
  }
  const colors = [...counts].map(([key, weight]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255] as Rgb, weight }));
  return { colors: mergeWeighted(colors), total };
}

const stats = (inputs: RoleInputs): Array<ColorStat & { rgb: Rgb }> =>
  (inputs.tokens.colorStats ?? []).map((stat) => ({ ...stat, rgb: parseColor(stat.hex) })).filter((stat): stat is ColorStat & { rgb: Rgb } => stat.rgb !== null);

/** Mix `from` toward `to` in linear light until relative luminance moved by `delta` (or `to` is reached). */
export function shiftLuminance(from: Rgb, to: Rgb, delta: number): Rgb {
  const start = luminance(from);
  const target = luminance(to) >= start ? start + delta : start - delta;
  const mix = (t: number) => from.map((v, i) => unlinear(linear(v) + (linear(to[i] ?? 0) - linear(v)) * t)) as Rgb;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const l = luminance(mix(mid));
    if ((luminance(to) >= start && l < target) || (luminance(to) < start && l > target)) lo = mid;
    else hi = mid;
  }
  return mix(hi).map((v) => Math.round(v)) as Rgb;
}

/** Mix `from` toward `to` until the contrast against `against` drops to `ratio`. */
function towardContrast(from: Rgb, to: Rgb, against: Rgb, ratio: number): Rgb {
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

/** Derive every colour role, in order, with its method and evidence. */
export function deriveRoles(inputs: RoleInputs): BrandColors {
  const n = ROLE_NUMBERS;
  const colorStats = stats(inputs);

  // ground: largest painted area across screenshots, photos excluded.
  let ground: Rgb;
  let groundEvidence: Evidence;
  const painted = paintedArea(inputs.screenshots);
  const top = painted.colors[0];
  if (top && painted.total > 0) {
    ground = top.rgb;
    groundEvidence = { method: 'area', share: round3(top.weight / painted.total), contrast: null };
  } else {
    const byArea = [...colorStats].sort((a, b) => (b.maxArea ?? 0) - (a.maxArea ?? 0))[0];
    const areaTotal = colorStats.reduce((sum, stat) => sum + (stat.maxArea ?? 0), 0);
    ground = byArea?.rgb ?? [255, 255, 255];
    groundEvidence =
      byArea && areaTotal > 0
        ? { method: 'area', share: round3((byArea.maxArea ?? 0) / areaTotal), contrast: null }
        : { method: 'generated', share: null, contrast: null };
  }

  // ink: the text colour used most that meets the contrast floor; else black or white.
  const textUse: Weighted[] = [
    ...colorStats.filter((stat) => (stat.textCount ?? 0) > 0).map((stat) => ({ rgb: stat.rgb, weight: stat.textCount ?? 0 })),
    ...(inputs.computedStyles.typography ?? [])
      .map((entry) => ({ rgb: parseColor(entry.color), weight: [...(entry.sampleText ?? '')].length }))
      .filter((entry): entry is Weighted => entry.rgb !== null && entry.weight > 0),
  ];
  const textGroups = mergeWeighted(textUse);
  const textTotal = textGroups.reduce((sum, group) => sum + group.weight, 0);
  const inkPick = textGroups.find((group) => contrast(group.rgb, ground) >= n.inkContrastMin);
  let ink: Rgb;
  let inkEvidence: Evidence;
  if (inkPick) {
    ink = inkPick.rgb;
    inkEvidence = { method: 'text-use', share: round3(inkPick.weight / textTotal), contrast: round3(contrast(ink, ground)) };
  } else {
    const black: Rgb = [0, 0, 0];
    const white: Rgb = [255, 255, 255];
    ink = contrast(black, ground) >= contrast(white, ground) ? black : white;
    inkEvidence = { method: 'generated', share: null, contrast: round3(contrast(ink, ground)) };
  }
  // A ground chosen without area data still carries evidence: its contrast with ink.
  if (groundEvidence.share === null) groundEvidence = { ...groundEvidence, contrast: round3(contrast(ground, ink)) };

  // accent: the primary filled button; else the most saturated interactive colour within limits.
  const fits = (rgb: Rgb) => {
    const l = luminance(rgb);
    return hsl(rgb).s >= n.accentSaturationMin && l >= n.accentLuminance[0] && l <= n.accentLuminance[1];
  };
  const buttons = (inputs.computedStyles.buttons ?? [])
    .map((button, index) => ({ rgb: parseColor(button.background), index, height: Number.parseFloat(button.height ?? '') || 0 }))
    .filter((button): button is { rgb: Rgb; index: number; height: number } => button.rgb !== null && distance(button.rgb, ground) >= n.mergeDistance);
  const primary = [...buttons].sort((a, b) => b.height - a.height || contrast(b.rgb, ground) - contrast(a.rgb, ground) || a.index - b.index)[0];
  const interactive: Weighted[] = mergeWeighted([
    ...colorStats.filter((stat) => (stat.interactiveBg ?? 0) > 0).map((stat) => ({ rgb: stat.rgb, weight: stat.interactiveBg ?? 0 })),
    ...buttons.map((button) => ({ rgb: button.rgb, weight: 1 })),
  ]);
  let accent: Rgb;
  let accentEvidence: Evidence;
  if (primary) {
    accent = primary.rgb;
    accentEvidence = { method: 'button-fill', share: null, contrast: round3(contrast(accent, ground)) };
  } else {
    const saturated = [...interactive].filter((item) => fits(item.rgb)).sort((a, b) => hsl(b.rgb).s - hsl(a.rgb).s)[0];
    if (saturated) {
      accent = saturated.rgb;
      accentEvidence = { method: 'interactive', share: null, contrast: round3(contrast(accent, ground)) };
    } else {
      const anyColour = [...colorStats].map((stat) => stat.rgb).filter(fits).sort((a, b) => hsl(b).s - hsl(a).s)[0];
      accent = anyColour ?? ink;
      accentEvidence = { method: 'generated', share: null, contrast: round3(contrast(accent, ground)) };
    }
  }

  // accent2: a second interactive colour at least 40 degrees of hue away, else null.
  const accentHue = hsl(accent).h;
  const second = interactive.find(
    (item) => distance(item.rgb, accent) >= n.mergeDistance && hsl(item.rgb).s >= n.accentSaturationMin && hueDistance(hsl(item.rgb).h, accentHue) >= n.accent2HueMinDeg,
  );
  const accent2 = second ? second.rgb : null;

  // surface: the most-used card or panel background a little off ground; else ground shifted toward ink.
  const groundL = luminance(ground);
  const panels = mergeWeighted([
    ...(inputs.computedStyles.cards ?? []).map((card) => ({ rgb: parseColor(card.background), weight: 1 })).filter((card): card is Weighted => card.rgb !== null),
    ...colorStats.filter((stat) => (stat.bgCount ?? 0) > 0).map((stat) => ({ rgb: stat.rgb, weight: stat.bgCount ?? 0 })),
  ]);
  const panelTotal = panels.reduce((sum, panel) => sum + panel.weight, 0);
  const surfacePick = panels.find((panel) => {
    const delta = Math.abs(luminance(panel.rgb) - groundL);
    return delta >= n.surfaceDeltaLuminance[0] && delta <= n.surfaceDeltaLuminance[1] && distance(panel.rgb, accent) >= n.mergeDistance;
  });
  let surface: Rgb;
  let surfaceEvidence: Evidence;
  if (surfacePick) {
    surface = surfacePick.rgb;
    surfaceEvidence = { method: 'area', share: round3(surfacePick.weight / panelTotal), contrast: null };
  } else {
    surface = shiftLuminance(ground, ink, n.surfaceFallbackShift);
    surfaceEvidence = { method: 'generated', share: null, contrast: round3(contrast(surface, ground)) };
  }

  // muted: the most-used low-saturation text colour with moderate contrast; else ink eased toward ground.
  const mutedPick = textGroups.find((group) => {
    const c = contrast(group.rgb, ground);
    return hsl(group.rgb).s <= n.mutedSaturationMax && c >= n.mutedContrast[0] && c <= n.mutedContrast[1];
  });
  let muted: Rgb;
  let mutedEvidence: Evidence;
  if (mutedPick) {
    muted = mutedPick.rgb;
    mutedEvidence = { method: 'text-use', share: round3(mutedPick.weight / textTotal), contrast: round3(contrast(muted, ground)) };
  } else {
    muted = towardContrast(ink, ground, ground, 4.0);
    mutedEvidence = { method: 'generated', share: null, contrast: round3(contrast(muted, ground)) };
  }

  // palette: roles first, then colours by usage, merged under the merge distance, capped.
  const usage = mergeWeighted([
    ...colorStats.map((stat) => ({ rgb: stat.rgb, weight: stat.count ?? 1 })),
    // Screenshot colours count only when they cover a real share of the page, not edge blends.
    ...painted.colors.filter((item) => painted.total > 0 && item.weight / painted.total >= 0.01),
  ]);
  const palette: Rgb[] = [];
  for (const rgb of [ground, ink, accent, ...(accent2 ? [accent2] : []), surface, muted, ...usage.map((item) => item.rgb)]) {
    if (palette.length >= n.paletteMax) break;
    if (!palette.some((existing) => distance(existing, rgb) < n.mergeDistance)) palette.push(rgb);
  }

  return {
    ground: toHex(ground),
    ink: toHex(ink),
    accent: toHex(accent),
    accent2: accent2 ? toHex(accent2) : null,
    surface: toHex(surface),
    muted: toHex(muted),
    palette: palette.map(toHex),
    evidence: { ground: groundEvidence, ink: inkEvidence, accent: accentEvidence, surface: surfaceEvidence, muted: mutedEvidence },
  };
}

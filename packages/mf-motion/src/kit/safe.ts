// Safe boxes from the numbers table: the frame margin, the copy-safe box, the
// caption band and the face band of an aspect, chosen by profile and scaled
// from the aspect's base resolution to the frame width.
import { type AspectKey, NUMBERS, aspectSize } from './numbers';

export const PROFILES = ['film', 'broll', 'overlay-alpha', 'overlay-key'] as const;
export type Profile = (typeof PROFILES)[number];

/** A rectangle in frame pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeOptions {
  /** Overlays keep copy out of the face band; default true for overlay profiles, ignored otherwise. */
  avoidFace?: boolean;
  /** Films reserve the caption band only when the brief sets captions; overlays always do. */
  captions?: boolean;
  /** Frame width in pixels; default the aspect's base width. Heights scale with it. */
  width?: number;
}

export interface SafeBoxes {
  aspect: AspectKey;
  profile: Profile;
  width: number;
  height: number;
  /** Pixels per base-resolution pixel. */
  scale: number;
  /** Every visible element stays inside (except `data-mf-bleed`). */
  frame: Rect;
  /** Readable copy stays inside; for overlays it ends above the caption band. */
  copy: Rect;
  /** The y band reserved for the user's subtitles, or null when the profile does not reserve it. */
  captionBand: Rect | null;
  /** The band overlays keep copy out of when avoiding the face, or null. */
  faceBand: Rect | null;
  /** Areas inside `copy` that copy must still avoid (the face band). */
  avoid: Rect[];
  /** CSS custom properties: the copy box as insets. */
  css: Record<'--mf-safe-l' | '--mf-safe-r' | '--mf-safe-t' | '--mf-safe-b', string>;
}

const isOverlay = (profile: Profile) => profile === 'overlay-alpha' || profile === 'overlay-key';
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The safe boxes of an aspect and profile (safe-zones-and-numbers.md section 2). */
export function safeBoxes(aspect: AspectKey, profile: Profile, options: SafeOptions = {}): SafeBoxes {
  const base = aspectSize(aspect);
  const width = options.width ?? base.width;
  const scale = width / base.width;
  const height = round(base.height * scale);
  const px = (value: number) => round(value * scale);
  const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: px(x0), y: px(y0), width: px(x1 - x0), height: px(y1 - y0) });

  const margin = NUMBERS['safe.frameMarginPx'][aspect];
  const frame = rect(margin, margin, base.width - margin, base.height - margin);

  const left = NUMBERS['safe.copy.leftPx'][aspect];
  const right = base.width - NUMBERS['safe.copy.rightPx'][aspect];
  const top = NUMBERS['safe.copy.topPx'][aspect];
  let bottom = base.height - NUMBERS['safe.copy.bottomPx'][aspect];

  const band = NUMBERS['safe.captionBand'][aspect];
  const reservesCaptions = isOverlay(profile) || (profile === 'film' && options.captions === true);
  const captionBand = reservesCaptions ? rect(0, band.y0, base.width, band.y1) : null;
  // The band spans the full width, so the copy box ends where the band begins.
  if (captionBand && band.y0 < bottom && band.y1 > top) bottom = Math.min(bottom, band.y0);

  const face = NUMBERS['safe.faceBand'][aspect];
  const faceBand = isOverlay(profile) && options.avoidFace !== false ? rect(face.x0, face.y0, face.x1, face.y1) : null;

  const copy = rect(left, top, right, bottom);
  return {
    aspect,
    profile,
    width,
    height,
    scale,
    frame,
    copy,
    captionBand,
    faceBand,
    avoid: faceBand ? [faceBand] : [],
    css: {
      '--mf-safe-l': `${copy.x}px`,
      '--mf-safe-r': `${round(width - copy.x - copy.width)}px`,
      '--mf-safe-t': `${copy.y}px`,
      '--mf-safe-b': `${round(height - copy.y - copy.height)}px`,
    },
  };
}

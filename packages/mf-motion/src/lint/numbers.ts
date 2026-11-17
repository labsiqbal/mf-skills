// Thresholds lint uses: the numbers-table keys come from src/kit/numbers.ts;
// the two rule-local values are stated in lint.md itself, not in the table.
import { NUMBERS } from '../kit/numbers';

export const LINT_NUMBERS = {
  /** type.trackingFloorEm */
  trackingFloorEm: NUMBERS['type.trackingFloorEm'],
  /** type.minReadablePx = 2.6% of the short side. */
  minReadableShare: NUMBERS['type.minReadablePx'].shortSideShare,
  /** brand.film.minRealPieces */
  filmMinRealPieces: NUMBERS['brand.film.minRealPieces'],
  /** PRF001 (lint.md): backdrop-filter on an element larger than half the frame. */
  backdropMaxFrameShare: 0.5,
  /** STR003 (lint.md): a scene may differ from its grid shot by at most 1 frame. */
  sceneToleranceFrames: 1,
} as const;

/** Entrance kinds (component-kit.md, text lines) and how long each takes to land. */
export const ENTRANCE_KINDS = ['rise', 'words', 'letters', 'ink', 'type', 'slot', 'count', 'mask', 'zoom', 'scatter', 'stroke'] as const;
export const EXIT_KINDS = ['fall', 'up', 'blur', 'wipe', 'scale', 'zoom', 'cut'] as const;

/**
 * Seconds from an entrance's start until the line has landed, from the kit
 * defaults; the kit's own timing replaces this table when it exists.
 */
export function entranceSeconds(kind: string, text: string, fps: number, options: { options?: number } = {}): number {
  const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
  const letters = Math.max(1, [...text.replace(/\s+/g, '')].length);
  switch (kind) {
    case 'rise':
      return 0.55;
    case 'words':
      return 0.16 + 0.07 * (words - 1);
    case 'letters':
      return 0.55 + (letters - 1) / fps;
    case 'ink':
      return 0.3 + 0.09 * (words - 1);
    case 'type':
      return letters / 28;
    case 'slot':
      return 0.1 * Math.max(1, options.options ?? 3);
    case 'count':
      return 0.9 + 0.35;
    case 'mask':
      return 0.6;
    case 'zoom':
      return 0.5;
    case 'scatter':
      return 0.7;
    case 'stroke':
      return 0.8;
    default:
      return 0;
  }
}

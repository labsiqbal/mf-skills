import * as v from 'valibot';
import { BrandId, Hex, IsoTime, RelPath, documentSchema } from './shared';

export const BRAND_VERSION = 1;

/** brand.paletteMax and brand.shots (safe-zones-and-numbers.md). */
export const PALETTE_MAX = 12;
export const PICKED_SHOTS = { min: 3, max: 6 } as const;

const Evidence = v.strictObject({
  method: v.picklist(['area', 'text-use', 'button-fill', 'interactive', 'manual', 'generated']),
  share: v.nullable(v.number()),
  contrast: v.nullable(v.number()),
});

const FontFile = v.strictObject({
  path: RelPath,
  weight: v.string(),
  style: v.picklist(['normal', 'italic']),
  axes: v.nullable(v.string()),
  source: v.picklist(['captured', 'bundled', 'user']),
  origin: v.nullable(v.string()),
  licenceHint: v.picklist(['ofl', 'apache', 'commercial-webfont', 'unknown', 'user-asserted']),
});

export const FontRole = v.strictObject({
  family: v.pipe(v.string(), v.minLength(1)),
  weight: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
  sizePx: v.nullable(v.number()),
  letterSpacingEm: v.nullable(v.number()),
  lineHeight: v.nullable(v.number()),
  files: v.array(FontFile),
  /** Bundled family id, always present. */
  fallback: v.pipe(v.string(), v.minLength(1)),
});

const assetEntries = {
  path: RelPath,
  kind: v.picklist(['svg', 'png', 'jpg', 'mp4']),
  w: v.pipe(v.number(), v.integer(), v.minValue(1)),
  h: v.pipe(v.number(), v.integer(), v.minValue(1)),
};
export const Asset = v.strictObject(assetEntries);
const Shot = v.strictObject({ ...assetEntries, from: v.string(), note: v.nullable(v.string()) });

const brandBase = documentSchema('brand', BRAND_VERSION, {
  id: BrandId,
  name: v.pipe(v.string(), v.minLength(1)),
  tagline: v.nullable(v.string()),
  status: v.picklist(['draft', 'picked']),
  source: v.strictObject({
    mode: v.picklist(['capture-url', 'capture-local', 'manual', 'from-brief']),
    url: v.nullable(v.string()),
    capturedAt: v.nullable(IsoTime),
    engine: v.nullable(v.string()),
  }),
  colors: v.strictObject({
    ground: Hex,
    ink: Hex,
    accent: Hex,
    accent2: v.nullable(Hex),
    surface: Hex,
    muted: Hex,
    palette: v.pipe(v.array(Hex), v.maxLength(PALETTE_MAX)),
    evidence: v.strictObject({ ground: Evidence, ink: Evidence, accent: Evidence, surface: Evidence, muted: Evidence }),
  }),
  type: v.strictObject({
    display: v.nullable(FontRole),
    heading: v.nullable(FontRole),
    body: v.nullable(FontRole),
    mono: v.nullable(FontRole),
  }),
  logo: v.nullable(Asset),
  mark: v.nullable(Asset),
  shots: v.array(Shot),
  candidates: v.strictObject({
    sheet: v.nullable(RelPath),
    logoSheet: v.nullable(RelPath),
    logos: v.array(RelPath),
    shots: v.array(RelPath),
  }),
  radiusPx: v.nullable(v.number()),
  buttons: v.pipe(
    v.array(v.strictObject({ label: v.string(), background: Hex, color: Hex, radiusPx: v.number() })),
    v.maxLength(2),
  ),
  copy: v.strictObject({ headline: v.nullable(v.string()), cta: v.nullable(v.string()), domain: v.nullable(v.string()) }),
  rights: v.strictObject({ noticeShownAt: v.nullable(IsoTime), oflSubstituted: v.boolean() }),
});

export const brandSchema = v.pipe(
  brandBase,
  v.check(
    (brand) => brand.status !== 'picked' || (brand.shots.length >= PICKED_SHOTS.min && brand.shots.length <= PICKED_SHOTS.max),
    `a picked brand has ${PICKED_SHOTS.min}-${PICKED_SHOTS.max} shots`,
  ),
);

export type BrandDoc = v.InferOutput<typeof brandSchema>;

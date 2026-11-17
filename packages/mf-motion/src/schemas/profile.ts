import * as v from 'valibot';
import { Aspect, BrandId, IsoTime, Language, documentSchema } from './shared';

export const PROFILE_VERSION = 1;

export const EDITORS = ['resolve', 'premiere', 'fcp', 'capcut', 'other', 'none'] as const;
export const OVERLAY_EXPORTS = ['mov', 'webm', 'key-mp4'] as const;
export const CLOUD_MODULES = ['voice-cloud', 'images', 'vision'] as const;

const CloudModuleState = v.strictObject({
  enabled: v.boolean(),
  provider: v.nullable(v.string()),
  /** null means the provider's default model. */
  model: v.nullable(v.string()),
});

export const profileSchema = documentSchema('profile', PROFILE_VERSION, {
  brand: v.nullable(BrandId),
  editor: v.picklist(EDITORS),
  aspect: Aspect,
  overlayExport: v.picklist(OVERLAY_EXPORTS),
  language: Language,
  rightsNoticeShownAt: v.nullable(IsoTime),
  cloud: v.strictObject({
    'voice-cloud': CloudModuleState,
    images: CloudModuleState,
    vision: CloudModuleState,
  }),
  createdAt: IsoTime,
  updatedAt: IsoTime,
});

export type ProfileDoc = v.InferOutput<typeof profileSchema>;

/**
 * Synthetic version 0 (field `export`, renamed to `overlayExport` in version 1).
 * No released CLI wrote version 0; it proves the migration machinery.
 */
export function migrateProfile0To1(doc: Record<string, unknown>): Record<string, unknown> {
  const { export: overlayExport, ...rest } = doc;
  return { ...rest, schemaVersion: 1, overlayExport };
}

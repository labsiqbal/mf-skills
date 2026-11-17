// Cloud providers per module (cloud-modules.md). Model ids and prices are
// configuration: `defaultModel`, `verifiedAt` and `priceBasis` stay null until
// MFM-090 (voice) and MFM-091 (images, vision) verify them against the live
// provider lists. A row without a verified default cannot be enabled.
import { CLOUD_MODULES } from '../schemas/profile';

export type CloudModule = (typeof CLOUD_MODULES)[number];

export interface ProviderRow {
  module: CloudModule;
  provider: string;
  /** The only host a call may reach. */
  host: string;
  /** Environment variable holding the key; read at call time, never stored. */
  keyVar: string;
  /** Verified default model id, or null until verified. */
  defaultModel: string | null;
  /** ISO date the default was checked against the provider's live list. */
  verifiedAt: string | null;
  /** How estimatedCostUsd is computed (per character, per image, ...), or null until read from the price page. */
  priceBasis: { unit: 'char' | 'image' | 'second' | 'request'; usdPerUnit: number; source: string } | null;
  limits: { maxCharsPerRequest?: number; maxBytesPerRequest?: number };
  /** What a call sends, shown on enable. */
  sends: string;
}

export const PROVIDERS: readonly ProviderRow[] = [
  { module: 'voice-cloud', provider: 'elevenlabs', host: 'api.elevenlabs.io', keyVar: 'ELEVENLABS_API_KEY', defaultModel: null, verifiedAt: null, priceBasis: null, limits: {}, sends: 'the voiceover script text, one chunk per request' },
  { module: 'voice-cloud', provider: 'openai', host: 'api.openai.com', keyVar: 'OPENAI_API_KEY', defaultModel: null, verifiedAt: null, priceBasis: null, limits: {}, sends: 'the voiceover script text, one chunk per request' },
  { module: 'voice-cloud', provider: 'gemini', host: 'generativelanguage.googleapis.com', keyVar: 'GEMINI_API_KEY', defaultModel: null, verifiedAt: null, priceBasis: null, limits: {}, sends: 'the voiceover script text, one chunk per request' },
  { module: 'images', provider: 'openai', host: 'api.openai.com', keyVar: 'OPENAI_API_KEY', defaultModel: null, verifiedAt: null, priceBasis: null, limits: {}, sends: 'the image prompt text and the requested size' },
  { module: 'images', provider: 'gemini', host: 'generativelanguage.googleapis.com', keyVar: 'GEMINI_API_KEY', defaultModel: null, verifiedAt: null, priceBasis: null, limits: {}, sends: 'the image prompt text and the requested size' },
  { module: 'vision', provider: 'gemini', host: 'generativelanguage.googleapis.com', keyVar: 'GEMINI_API_KEY', defaultModel: null, verifiedAt: null, priceBasis: null, limits: {}, sends: 'captured page screenshots and rendered frames, through the engine' },
];

export function providerRow(module: CloudModule, provider: string, rows: readonly ProviderRow[] = PROVIDERS): ProviderRow | undefined {
  return rows.find((row) => row.module === module && row.provider === provider);
}

export const hasVerifiedDefault = (row: ProviderRow) => row.defaultModel !== null && row.verifiedAt !== null;

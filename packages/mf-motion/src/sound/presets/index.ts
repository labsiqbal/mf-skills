import { ambientGlass } from './ambient-glass';
import { cinematicPulse } from './cinematic-pulse';
import { darkPulse } from './dark-pulse';
import { drivingElectronic } from './driving-electronic';
import { indiePop } from './indie-pop';
import { lofiKeys } from './lofi-keys';
import { minimalTech } from './minimal-tech';
import { orchestralHybrid } from './orchestral-hybrid';
import { playfulPluck } from './playful-pluck';
import type { GenrePreset } from './types';
import { warmHouse } from './warm-house';

export type { GenrePreset } from './types';

/** The ten genre presets of sound.md, by id. */
export const GENRE_PRESETS: Record<string, GenrePreset> = Object.fromEntries(
  [drivingElectronic, warmHouse, lofiKeys, cinematicPulse, minimalTech, playfulPluck, ambientGlass, indiePop, darkPulse, orchestralHybrid].map((preset) => [preset.id, preset]),
);

export const GENRE_IDS = Object.keys(GENRE_PRESETS);

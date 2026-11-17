// The BANNED list (film-pipeline.md): closed ids a film plan may forbid, plus
// `custom:<text>` entries. Four ids are checked mechanically by lint rules;
// the judge reads the whole list in facts.md.
import { BANNED_IDS } from '../schemas/spec';

export { BANNED_IDS };
export type BannedId = (typeof BANNED_IDS)[number];

export const BANNED_MEANING: Record<BannedId, string> = {
  'screenshot-as-picture': 'a screenshot panned as the whole picture',
  'title-over-dim-screenshot': 'a title over a dimmed screenshot',
  'centred-text-on-plain-ground': 'centred text on a plain ground',
  'small-element-empty-frame': 'a small element in an empty frame',
  'three-card-row': 'a row of three cards',
  'uniform-fade-slide': 'the same fade and slide on everything',
  'single-ease-everywhere': 'one ease for every move',
  'idle-loop': 'idle loops (breathing, floating, pulsing)',
  'creeping-scale': 'a slow creeping scale',
  'accent-on-accent': 'accent colour on accent colour',
  'stock-icons': 'stock icons',
  emoji: 'emoji',
  'lettermark-as-logo': 'a lettermark standing in for the logo',
  'invented-numbers': 'numbers the brand did not supply',
  'glass-over-void': 'glass panels over an empty void',
  'glow-everywhere': 'glow on everything',
  'layout-tweens': 'tweens of layout properties',
  'logo-docked-in-corner': 'the logo docked in a corner',
  'tilted-product-ui': 'product UI tilted in 3D',
  'dashes-in-copy': 'em or en dashes in on-screen copy',
  'placeholder-copy': 'placeholder copy',
  'icon-fonts': 'icon fonts',
};

/** The BANNED ids lint enforces, and the rule that enforces each (lint.md). */
export const BANNED_LINT_RULES: Partial<Record<BannedId, string>> = {
  emoji: 'CPY003',
  'dashes-in-copy': 'CPY001',
  'placeholder-copy': 'CPY002',
  'layout-tweens': 'STR001',
};

export function isBannedEntry(entry: string): boolean {
  return (BANNED_IDS as readonly string[]).includes(entry) || /^custom:\S.*$/.test(entry);
}

/** The lines facts.md gives the judge for a film's BANNED list. */
export function bannedFacts(entries: string[]): string[] {
  return entries.map((entry) => {
    if (entry.startsWith('custom:')) return `banned: ${entry.slice('custom:'.length).trim()}`;
    const id = entry as BannedId;
    const rule = BANNED_LINT_RULES[id];
    return `banned: ${id} (${BANNED_MEANING[id]})${rule ? `, checked by lint ${rule}` : ''}`;
  });
}

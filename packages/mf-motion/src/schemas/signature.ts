// Closed signature vocabularies (signatures-and-uniqueness.md). Adding a value
// is additive; removing one is breaking.
import * as v from 'valibot';

export const MOVE_SIGNATURE = {
  layout: ['single-hero', 'stack', 'grid', 'row', 'radial', 'path', 'split', 'frame-in-frame', 'full-bleed', 'corner-callout', 'band', 'orbit'],
  motion: ['assemble', 'reveal-wipe', 'type-on', 'count-up', 'grow', 'sort', 'draw-on', 'pop-sequence', 'flip', 'slide-through', 'zoom-through', 'morph', 'scatter-converge', 'pulse-stamp', 'pan-scan'],
  material: ['flat', 'glass', 'paper', 'ink', 'riso', 'grid-ui', 'depth-3d', 'photo-plate', 'neon-line'],
  data: ['none', 'single-number', 'series', 'ranking', 'list', 'text-quote', 'conversation', 'media', 'graph', 'geo', 'code', 'timeline'],
  use: ['proof', 'reaction', 'emphasis', 'process', 'comparison', 'announcement', 'explanation', 'identity', 'transition', 'navigation'],
} as const;

export const THEME_SIGNATURE = {
  pace: ['one-take', 'bar-cuts', 'copy-cuts', 'loop', 'slow-hold', 'rapid-montage'],
  grammar: ['product-hero', 'ui-in-use', 'object-metaphor', 'collage', 'typographic', 'data-story', 'diagram', 'character-gag', 'documentary'],
  material: ['glass-depth', 'paper-print', 'flat-ui', 'photo-collage', 'neon', 'riso-ink', 'clay-3d', 'grid-technical', 'film-grain'],
  palette: ['brand-dark', 'brand-light', 'mono-plus-accent', 'duotone', 'full-brand', 'inverted'],
  type: ['grotesk-tight', 'serif-editorial', 'mono-technical', 'display-condensed', 'rounded-friendly', 'handwritten-accent'],
  sound: ['driving', 'warm', 'playful', 'cinematic', 'minimal', 'ambient', 'lofi', 'orchestral-hybrid'],
} as const;

export const MoveSignature = v.strictObject({
  layout: v.picklist(MOVE_SIGNATURE.layout),
  motion: v.picklist(MOVE_SIGNATURE.motion),
  material: v.picklist(MOVE_SIGNATURE.material),
  data: v.picklist(MOVE_SIGNATURE.data),
  use: v.picklist(MOVE_SIGNATURE.use),
});

export const ThemeSignature = v.strictObject({
  pace: v.picklist(THEME_SIGNATURE.pace),
  grammar: v.picklist(THEME_SIGNATURE.grammar),
  material: v.picklist(THEME_SIGNATURE.material),
  palette: v.picklist(THEME_SIGNATURE.palette),
  type: v.picklist(THEME_SIGNATURE.type),
  sound: v.picklist(THEME_SIGNATURE.sound),
});

export type MoveSignatureValue = v.InferOutput<typeof MoveSignature>;
export type ThemeSignatureValue = v.InferOutput<typeof ThemeSignature>;

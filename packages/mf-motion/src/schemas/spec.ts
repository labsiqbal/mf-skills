// The film spec (plan/spec.json): the picked storyline, its numbers and the BANNED list.
import * as v from 'valibot';
import { documentSchema } from './shared';

/** Closed BANNED ids (film-pipeline.md); films add `custom:<text>` entries. */
export const BANNED_IDS = [
  'screenshot-as-picture',
  'title-over-dim-screenshot',
  'centred-text-on-plain-ground',
  'small-element-empty-frame',
  'three-card-row',
  'uniform-fade-slide',
  'single-ease-everywhere',
  'idle-loop',
  'creeping-scale',
  'accent-on-accent',
  'stock-icons',
  'emoji',
  'lettermark-as-logo',
  'invented-numbers',
  'glass-over-void',
  'glow-everywhere',
  'layout-tweens',
  'logo-docked-in-corner',
  'tilted-product-ui',
  'dashes-in-copy',
  'placeholder-copy',
  'icon-fonts',
] as const;

const sec = v.pipe(v.number(), v.minValue(0));
const range = v.pipe(v.array(sec), v.minLength(2), v.maxLength(2), v.check((pair) => (pair[0] ?? 0) <= (pair[1] ?? 0), 'low <= high'));

export const specSchema = documentSchema('spec', 1, {
  /** Id of a storyline in storylines.md. */
  storyline: v.pipe(v.string(), v.minLength(1)),
  numbers: v.strictObject({
    arriveSec: range,
    exitSec: range,
    cameraSec: sec,
    staggerMs: range,
    heroShare: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    transitions: v.array(v.string()),
    endCardHoldSec: sec,
  }),
  banned: v.array(
    v.pipe(
      v.string(),
      v.check(
        (entry) => (BANNED_IDS as readonly string[]).includes(entry) || /^custom:\S.*$/.test(entry),
        'a closed BANNED id or a custom:<text> entry',
      ),
    ),
  ),
});

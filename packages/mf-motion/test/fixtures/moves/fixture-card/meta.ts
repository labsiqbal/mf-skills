// Meta of the contract fixture move: an overlay card with a title and a count.
import type { MoveMeta } from '../../../../src/library/contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'fixture-card',
  version: '1.0.0',
  name: 'Fixture card',
  oneLiner: 'A small card with a number and its title rises in, holds, then leaves.',
  category: 'data',
  uses: ['overlay'],
  // 1:1 leaves no room beside the face band for a card at a readable size.
  aspects: ['16:9', '9:16'],
  modes: ['full', 'alpha', 'key'],
  durationSec: { min: 2.5, default: 3.5, max: 5 },
  holds: [{ from: 0.4, to: 0.8 }],
  avoidFace: true,
  say: ['a number worth showing', 'a short headline'],
  tags: ['fixture', 'card'],
  signature: { layout: 'single-hero', motion: 'count-up', material: 'flat', data: 'single-number', use: 'proof' },
  vars: {
    title: { type: 'text', default: 'New teams', maxChars: 12, describe: 'the card title' },
    value: { type: 'number', default: 42, min: 0, max: 9999, describe: 'the number counted to' },
    tone: { type: 'enum', default: 'accent', values: ['accent', 'ink'], describe: 'colour role of the number' },
  },
  examples: {
    tessarine: { title: 'Signals', value: 1200 },
    mossmallow: { title: 'Recipes', value: 38 },
    quillfen: { title: 'Essays', value: 12 },
  },
  kit: ['line'],
  status: 'seed',
};

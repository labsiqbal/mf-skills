import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'title-lockup',
  version: '1.0.0',
  name: 'Title lockup',
  oneLiner: 'A wipe draws the picked brand mark and headline together.',
  category: 'system',
  uses: ['overlay', 'broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full', 'alpha', 'key'],
  durationSec: { min: 3.3, default: 3.5, max: 4 },
  holds: [{ from: 0.08, to: 0.96 }],
  avoidFace: true,
  say: ['they introduce who made the film', 'they end on the company name or a short headline'],
  tags: ['brand', 'logo', 'title', 'wipe'],
  signature: { layout: 'corner-callout', motion: 'reveal-wipe', material: 'flat', data: 'text-quote', use: 'identity' },
  vars: {
    headline: { type: 'text', default: 'Meet the brand', maxChars: 18, describe: 'the headline beside the picked mark' },
  },
  examples: {
    tessarine: { headline: 'Trace every run' },
    mossmallow: { headline: 'Dinner is sorted' },
    quillfen: { headline: 'Read a little' },
  },
  kit: ['flat', 'line', 'camera'],
  status: 'seed',
};

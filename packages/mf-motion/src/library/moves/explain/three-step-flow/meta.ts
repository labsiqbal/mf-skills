import type { MoveMeta } from '../../../contract';

const step = (position: string, defaults: string) => ({
  type: 'text' as const,
  default: defaults,
  maxChars: 14,
  describe: `the ${position} step`,
});

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'three-step-flow',
  version: '1.0.0',
  name: 'Three-step flow',
  oneLiner: 'Three steps connect in order, with a highlight on the middle step.',
  category: 'explain',
  uses: ['broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full'],
  durationSec: { min: 4.25, default: 4.5, max: 5 },
  holds: [],
  avoidFace: false,
  say: ['they explain a process in three steps', 'they describe what happens between the input and the outcome'],
  tags: ['diagram', 'steps', 'sequence', 'process'],
  signature: { layout: 'path', motion: 'draw-on', material: 'flat', data: 'graph', use: 'process' },
  vars: {
    first: step('first', 'Collect inputs'),
    second: step('middle', 'Check the data'),
    third: step('last', 'Share results'),
  },
  examples: {
    tessarine: { first: 'Capture a run', second: 'Trace the call', third: 'Fix the delay' },
    mossmallow: { first: 'Pick a kit', second: 'Cook dinner', third: 'Plate it up' },
    quillfen: { first: 'Find an essay', second: 'Save a quote', third: 'Keep reading' },
  },
  kit: ['card', 'line', 'camera'],
  status: 'seed',
};

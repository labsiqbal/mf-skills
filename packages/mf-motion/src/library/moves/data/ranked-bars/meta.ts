import type { MoveMeta } from '../../../contract';

const label = (entry: string, defaults: string) => ({
  type: 'text' as const,
  default: defaults,
  maxChars: 16,
  describe: `${entry} entry name`,
});
const value = (entry: string, defaults: number) => ({
  type: 'number' as const,
  default: defaults,
  min: 1,
  max: 999,
  describe: `${entry} entry value`,
});

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'ranked-bars',
  version: '1.0.0',
  name: 'Ranked bars',
  oneLiner: 'Three horizontal bars grow, sort into rank, and stamp the leader.',
  category: 'data',
  uses: ['broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full'],
  durationSec: { min: 5.7, default: 5.8, max: 6 },
  holds: [],
  avoidFace: false,
  say: ['they rank three options by the same measure', 'they point out which item came out on top'],
  tags: ['ranking', 'comparison', 'data', 'bar-chart'],
  signature: { layout: 'stack', motion: 'sort', material: 'grid-ui', data: 'ranking', use: 'comparison' },
  vars: {
    title: { type: 'text', default: 'Weekly totals', maxChars: 19, describe: 'the measure being ranked' },
    first: label('First', 'North'),
    second: label('Second', 'Central'),
    third: label('Third', 'South'),
    firstValue: value('First', 56),
    secondValue: value('Second', 31),
    thirdValue: value('Third', 82),
  },
  examples: {
    tessarine: { title: 'Workflow runs', first: 'Summariser', second: 'Router', third: 'Tagger', firstValue: 86, secondValue: 124, thirdValue: 57 },
    mossmallow: { title: 'Kits ordered', first: 'Lentil stew', second: 'Spinach pie', third: 'Tomato pasta', firstValue: 47, secondValue: 62, thirdValue: 98 },
    quillfen: { title: 'New subscribers', first: 'Fiction', second: 'Reviews', third: 'Essays', firstValue: 44, secondValue: 38, thirdValue: 63 },
  },
  kit: ['race', 'chip', 'line', 'camera'],
  status: 'seed',
};

import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'ink-underline',
  version: '1.0.0',
  name: 'Ink underline',
  oneLiner: 'A marker underlines and circles the spoken keyword on a paper slip.',
  category: 'paper',
  uses: ['overlay'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['alpha', 'key'],
  durationSec: { min: 3.15, default: 3.3, max: 3.6 },
  holds: [{ from: 0.08, to: 0.96 }],
  avoidFace: true,
  say: ['they stress a single word in the explanation', 'they name the thing the viewer should remember'],
  tags: ['marker', 'annotation', 'underline', 'keyword'],
  signature: { layout: 'corner-callout', motion: 'draw-on', material: 'paper', data: 'text-quote', use: 'emphasis' },
  vars: {
    keyword: { type: 'text', default: 'Baseline', maxChars: 12, describe: 'the spoken keyword to underline and circle' },
  },
  examples: {
    tessarine: { keyword: 'Latency' },
    mossmallow: { keyword: 'Freshness' },
    quillfen: { keyword: 'Voice' },
  },
  kit: ['paper', 'line'],
  status: 'seed',
};

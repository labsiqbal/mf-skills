import type { MoveMeta } from '../../../contract';

const revenue = (quarter: string, defaults: number) => ({
  type: 'number' as const,
  default: defaults,
  min: 1,
  max: 999,
  describe: `${quarter} revenue in thousands of dollars`,
});

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'revenue-step',
  version: '1.0.0',
  name: 'Revenue step',
  oneLiner: 'Four quarterly revenue bars rise in sequence, ending with the change from Q3.',
  category: 'business',
  uses: ['broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full'],
  durationSec: { min: 5.4, default: 5.6, max: 6 },
  holds: [],
  avoidFace: false,
  say: ['they report a year of revenue quarter by quarter', 'they compare fourth-quarter sales with the prior quarter'],
  tags: ['revenue', 'quarters', 'bar-chart', 'growth'],
  signature: { layout: 'single-hero', motion: 'grow', material: 'grid-ui', data: 'series', use: 'comparison' },
  vars: {
    title: { type: 'text', default: 'Quarterly revenue', maxChars: 24, describe: 'the revenue series heading' },
    q1: revenue('Q1', 82),
    q2: revenue('Q2', 108),
    q3: revenue('Q3', 127),
    q4: revenue('Q4', 160),
  },
  examples: {
    tessarine: { title: 'Platform revenue', q1: 138, q2: 196, q3: 224, q4: 283 },
    mossmallow: { title: 'Meal kit sales', q1: 68, q2: 83, q3: 112, q4: 128 },
    quillfen: { title: 'Subscription revenue', q1: 39, q2: 54, q3: 61, q4: 74 },
  },
  kit: ['bars', 'chip', 'line', 'camera'],
  status: 'seed',
};

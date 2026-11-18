// Meta of follower-milestone (creator-01): a follower counter rolls to a
// milestone and stamps with a burst.
import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'follower-milestone',
  version: '1.0.0',
  name: 'Follower milestone',
  oneLiner: 'A follower count rolls up to a milestone, stamps, and bursts.',
  category: 'creator',
  uses: ['overlay', 'broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full', 'alpha', 'key'],
  // At most 5.4 s: the overlay's still after the stamp stays within still.overlayHoldMaxSec.
  durationSec: { min: 4.5, default: 5, max: 5.4 },
  // Overlays hold still once the count has stamped (and the chip has landed).
  holds: [{ from: 0.2, to: 0.95 }],
  avoidFace: true,
  say: ['they mention hitting a follower or subscriber milestone', 'they thank the audience for growing the channel', 'a number of followers, subscribers or members comes up'],
  tags: ['followers', 'milestone', 'creator', 'count', 'celebration'],
  signature: { layout: 'single-hero', motion: 'pulse-stamp', material: 'flat', data: 'single-number', use: 'announcement' },
  vars: {
    handle: { type: 'text', default: '@yourchannel', maxChars: 18, describe: 'the account name above the count' },
    value: { type: 'number', default: 10000, min: 1, max: 999999, describe: 'the milestone the count lands on' },
    from: { type: 'number', default: 9412, min: 0, max: 999999, describe: 'where the count starts' },
    label: { type: 'text', default: 'followers', maxChars: 12, describe: 'what the number counts' },
    badge: { type: 'text', default: 'New milestone', maxChars: 16, describe: 'the chip that lands after the stamp' },
  },
  examples: {
    tessarine: { handle: '@tessarine.dev', value: 25000, from: 23810, label: 'followers', badge: 'Thank you, devs' },
    mossmallow: { handle: '@mossmallow', value: 100000, from: 96240, label: 'home cooks', badge: '100K kitchens' },
    quillfen: { handle: '@quillfenreview', value: 5000, from: 4720, label: 'subscribers', badge: 'Issue 20 is out' },
  },
  kit: ['counter', 'chip', 'avatar', 'line', 'camera'],
  status: 'seed',
};

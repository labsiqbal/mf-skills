// Meta of terminal-run (dev-01): a command types, output streams line by
// line, a pass mark lands.
import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'terminal-run',
  version: '1.0.0',
  name: 'Terminal run',
  oneLiner: 'A command types in a terminal on a laptop, output streams in, and a pass mark stamps.',
  category: 'dev',
  uses: ['broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full'],
  durationSec: { min: 5.5, default: 6, max: 6 },
  holds: [],
  avoidFace: false,
  say: ['they run a command, a script or the test suite', 'a build or a deploy finishes', 'they show something working in the terminal'],
  tags: ['terminal', 'code', 'developer', 'tests', 'cli'],
  signature: { layout: 'split', motion: 'type-on', material: 'depth-3d', data: 'code', use: 'proof' },
  vars: {
    command: { type: 'text', default: 'npm test', maxChars: 30, describe: 'the command typed after the prompt' },
    output: {
      type: 'list',
      default: ['Running 48 tests', 'auth ............ ok', 'billing ......... ok', 'search .......... ok'],
      maxItems: 4,
      items: { type: 'text', default: '', maxChars: 34, describe: 'one output line' },
      describe: 'the output lines, streamed in order',
    },
    result: { type: 'text', default: '48 passed', maxChars: 18, describe: 'the pass mark label' },
  },
  examples: {
    tessarine: { command: 'tess eval run --suite refunds', output: ['Loading 120 cases', 'accuracy ........ 96.4%', 'latency p95 ..... 1.8 s', 'cost ............ $0.42'], result: 'Suite passed' },
    mossmallow: { command: 'npm run test:recipes', output: ['Checking 312 recipes', 'units ........... ok', 'allergens ....... ok', 'timings ......... ok'], result: '312 recipes ok' },
    quillfen: { command: 'make issue-20', output: ['Typesetting 14 essays', 'footnotes ....... ok', 'images .......... ok', 'proofs .......... ok'], result: 'Ready to print' },
  },
  kit: ['laptop', 'tablet', 'chip', 'line', 'camera'],
  status: 'seed',
};

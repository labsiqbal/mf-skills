// Meta of task-checkoff (productivity-01): list items tick off in turn with a
// strike-through while a progress bar fills.
import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'task-checkoff',
  version: '1.0.0',
  name: 'Task checkoff',
  oneLiner: 'Three list items tick off in turn, each struck through, as a progress bar fills.',
  category: 'productivity',
  uses: ['overlay', 'broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full', 'alpha', 'key'],
  // The 1:1 columns beside the face band are too narrow for a task line of
  // type.squareOverlayMinLineChars: 1:1 is offered as b-roll only (v1.2).
  overlayAspects: ['16:9', '9:16'],
  durationSec: { min: 4.5, default: 5, max: 5.5 },
  // Overlays hold still once the last item is struck and the bar is full.
  holds: [{ from: 0.75, to: 0.98 }],
  avoidFace: true,
  say: ['they run through a to-do list or a plan', 'they say what is already done and what is left', 'they mention finishing the steps of a project'],
  tags: ['tasks', 'checklist', 'progress', 'todo', 'productivity'],
  signature: { layout: 'stack', motion: 'draw-on', material: 'grid-ui', data: 'list', use: 'process' },
  vars: {
    title: { type: 'text', default: 'This week', maxChars: 20, describe: 'the list heading (16:9 overlay and b-roll)' },
    first: { type: 'text', default: 'Draft the launch post', maxChars: 24, describe: 'the first item, ticked first' },
    second: { type: 'text', default: 'Record the demo', maxChars: 24, describe: 'the second item' },
    third: { type: 'text', default: 'Ship the update', maxChars: 24, describe: 'the third item, ticked last' },
  },
  examples: {
    tessarine: { title: 'Release 2.4', first: 'Trace the slow runs', second: 'Cut the prompt by half', third: 'Rerun the eval set' },
    mossmallow: { title: 'Sunday prep', first: 'Roast the vegetables', second: 'Cook a pot of lentils', third: 'Pack five lunches' },
    quillfen: { title: 'Spring issue', first: 'Edit the lead essay', second: 'Check every quote', third: 'Send pages to print' },
  },
  kit: ['row', 'progress', 'line', 'camera'],
  status: 'seed',
};

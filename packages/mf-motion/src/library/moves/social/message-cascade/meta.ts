// Meta of message-cascade (social-01): chat bubbles land in turn with a typing
// indicator before each reply.
import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'message-cascade',
  version: '1.0.0',
  name: 'Message cascade',
  oneLiner: 'Three chat bubbles land in turn, a typing indicator before each one.',
  category: 'social',
  uses: ['overlay', 'broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full', 'alpha', 'key'],
  // The 1:1 columns beside the face band (194 px) wrap a bubble to 2-11 graphemes a line, under
  // type.squareOverlayMinLineChars: 1:1 is offered as b-roll only (v1.2, MFM-099).
  overlayAspects: ['16:9', '9:16'],
  // The last message needs read.lastLineMinSec before the exit window.
  durationSec: { min: 5.6, default: 6, max: 6 },
  // Overlays hold still once the last message has landed.
  holds: [{ from: 0.45, to: 0.95 }],
  avoidFace: true,
  say: ['someone reads out a text or a DM they got', 'a quick back-and-forth with a customer or a friend', 'they describe a group chat blowing up'],
  tags: ['chat', 'messages', 'dm', 'conversation', 'social'],
  signature: { layout: 'stack', motion: 'pop-sequence', material: 'flat', data: 'conversation', use: 'reaction' },
  vars: {
    contact: { type: 'text', default: 'Sam', maxChars: 16, describe: 'who the chat is with (shown in the b-roll header)' },
    first: { type: 'text', default: 'Did the demo land?', maxChars: 24, describe: 'the first message, received' },
    reply: { type: 'text', default: 'Better than we hoped', maxChars: 24, describe: 'the reply, sent' },
    last: { type: 'text', default: 'Sending the deck now', maxChars: 24, describe: 'the last message, received' },
  },
  examples: {
    tessarine: { contact: 'Priya, on call', first: 'Run 4822 just failed', reply: 'Checking the trace now', last: 'Timeout in the retriever' },
    mossmallow: { contact: 'Dad', first: 'What can I cook tonight?', reply: 'Try the lemon orzo', last: 'Saved it. Ready by 7!' },
    quillfen: { contact: 'Ines, editor', first: 'Your essay ran long', reply: 'Cutting it to 3,000', last: 'Lovely. Off to print' },
  },
  kit: ['bubble', 'avatar', 'line', 'camera'],
  status: 'seed',
};

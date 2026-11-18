// Meta of prompt-to-result (ai-01): a prompt types into an input bar, sends,
// and a result card unfolds.
import type { MoveMeta } from '../../../contract';

export const meta: MoveMeta = {
  schemaVersion: 1,
  kind: 'move-meta',
  id: 'prompt-to-result',
  version: '1.0.0',
  name: 'Prompt to result',
  oneLiner: 'A prompt types into an input bar, a cursor sends it, and the answer card unfolds.',
  category: 'ai',
  uses: ['broll'],
  aspects: ['16:9', '9:16', '1:1'],
  modes: ['full'],
  // The answer's last line needs read.lastLineMinSec before the end.
  durationSec: { min: 5.8, default: 6, max: 6 },
  holds: [],
  avoidFace: false,
  say: ['they describe asking an AI tool a question', 'they show what they typed and what came back', 'an assistant or chatbot answers a request'],
  tags: ['ai', 'prompt', 'assistant', 'answer', 'chat'],
  signature: { layout: 'frame-in-frame', motion: 'type-on', material: 'grid-ui', data: 'text-quote', use: 'process' },
  vars: {
    app: { type: 'text', default: 'Assistant', maxChars: 20, describe: 'the name in the window bar' },
    prompt: { type: 'text', default: 'Summarise this week in three points', maxChars: 48, describe: 'what is typed into the input bar' },
    send: { type: 'text', default: 'Send', maxChars: 8, describe: 'the button the cursor presses' },
    title: { type: 'text', default: 'Three things moved', maxChars: 28, describe: 'the answer card heading' },
    body: { type: 'text', default: 'Launch shipped, churn fell, hiring opened', maxChars: 64, describe: 'the answer card text' },
  },
  examples: {
    tessarine: { app: 'Tessarine Ask', prompt: 'Which runs cost more than 5 cents?', send: 'Ask', title: '14 runs over budget', body: 'All from the summariser, after the prompt grew on Tuesday' },
    mossmallow: { app: 'Mossmallow Chef', prompt: 'Dinner with spinach and feta, 20 minutes', send: 'Cook', title: 'Spinach and feta pasta', body: 'Ready in 18 minutes, one pan, serves two' },
    quillfen: { app: 'Quillfen Desk', prompt: 'Find essays on slow travel', send: 'Search', title: '6 essays on slow travel', body: 'The longest is 9,000 words, from the spring issue' },
  },
  kit: ['input', 'button', 'card', 'cursor', 'line', 'camera'],
  status: 'seed',
};

// score: the synthesised score for a film project. --track (MFM-069) and
// --voice (MFM-070, MFM-089) are wired by later tickets.
import { findProjectRoot } from '../../paths/index';
import { scoreProject } from '../../sound/score';
import { defineCommand } from '../registry';

export const scoreCommand = defineCommand({
  name: 'score',
  summary: "Render the film's score from its resolved beat grid, seed and preset to sound/score-raw.wav.",
  flags: {},
  dataSchema: {
    type: 'object',
    required: ['raw', 'seconds', 'sampleRate', 'sha256'],
    properties: {
      raw: { type: 'string' },
      seconds: { type: 'number' },
      sampleRate: { type: 'integer' },
      channels: { const: 2 },
      bitDepth: { const: 24 },
      bpm: { type: 'number' },
      seed: { type: 'integer' },
      preset: { type: 'string' },
      sha256: { type: 'string' },
    },
  },
  async handler({ cwd, global, log }) {
    const { warnings, ...data } = scoreProject(findProjectRoot(cwd, global.project));
    for (const warning of warnings) log.warn(warning);
    return { data };
  },
});

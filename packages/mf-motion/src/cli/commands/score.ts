// score: the synthesised score for a film project, or with --track the
// user's own music, analysed and fitted to the beat grid. --voice arrives with
// MFM-070 and MFM-089.
import path from 'node:path';
import { findProjectRoot } from '../../paths/index';
import { scoreProject } from '../../sound/score';
import { installedEngine, scoreTrack } from '../../sound/track';
import { defineCommand } from '../registry';

export const scoreCommand = defineCommand({
  name: 'score',
  summary: "Render the film's score from its resolved beat grid, seed and preset to sound/score-raw.wav.",
  flags: {
    track: { type: 'string', value: '<file>', description: "the user's own music: analysed (tempo, beats, downbeats, sections, drop) and fitted to the beat grid" },
  },
  dataSchema: {
    type: 'object',
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
      track: { type: 'string', description: 'with --track: the copied track' },
      analysis: { type: 'string', description: 'with --track: sound/track-analysis.json' },
      provider: { enum: ['hyperframes-local', 'fallback'] },
      drop: { type: ['object', 'null'] },
      fit: { type: 'object', description: 'with --track: bpm, beatsPerBar, bars, offsetSec, lengthSec, cues' },
      gridUpdated: { type: 'boolean' },
    },
  },
  async handler({ flags, cwd, env, global, log }) {
    const project = findProjectRoot(cwd, global.project);
    if (flags.track !== undefined) {
      const data = await scoreTrack(project, path.resolve(cwd, flags.track), { engine: installedEngine(env), onWarn: (message) => log.warn(message) });
      const next = data.gridUpdated ? ['mf-motion beatgrid check --json'] : [];
      return { data: data as unknown as Record<string, unknown>, next };
    }
    const { warnings, ...data } = scoreProject(project);
    for (const warning of warnings) log.warn(warning);
    return { data: data as unknown as Record<string, unknown> };
  },
});

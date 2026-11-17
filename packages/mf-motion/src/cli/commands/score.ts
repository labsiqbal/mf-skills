// score: the film's score. Synth mode renders sound/score-raw.wav from the
// resolved beat grid; --track analyses the user's music and fits the grid.
// Either way, once a resolved grid exists the mix (SFX, pre-hit dip, voice
// ducking, end fade) is normalised to sound/score.wav with sound/sound.json.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { findProjectRoot, readProject } from '../../paths/index';
import { readDoc } from '../../schemas/index';
import { finishScore, decodeStereo, trimWithFade } from '../../sound/mix';
import { scoreProject } from '../../sound/score';
import { installedEngine, scoreTrack } from '../../sound/track';
import { NUMBERS } from '../../kit/numbers';
import { CLI_VERSION, defineCommand } from '../registry';

const fpsOf = (fps: string) => {
  const [num = 30, den = 1] = fps.split('/').map(Number);
  return num / den;
};

export const scoreCommand = defineCommand({
  name: 'score',
  summary: "Render the film's score (or fit the user's track) and write the normalised sound/score.wav and sound/sound.json.",
  flags: {
    track: { type: 'string', value: '<file>', description: "the user's own music: analysed (tempo, beats, downbeats, sections, drop) and fitted to the beat grid" },
  },
  dataSchema: {
    type: 'object',
    properties: {
      sound: { type: ['string', 'null'], description: 'sound/score.wav once mixed and normalised' },
      lufs: { type: ['number', 'null'] },
      truePeak: { type: ['number', 'null'] },
      sfx: { type: 'array' },
      mode: { enum: ['synth', 'track'] },
      raw: { type: ['string', 'null'] },
      sha256: { type: 'string', description: 'synth: sha256 of score-raw.wav' },
      preset: { type: 'string' },
      analysis: { type: 'string', description: 'with --track: sound/track-analysis.json' },
      fit: { type: 'object', description: 'with --track: bpm, beatsPerBar, bars, offsetSec, lengthSec, cues' },
      gridUpdated: { type: 'boolean' },
    },
  },
  async handler({ flags, cwd, env, global, log }) {
    const project = findProjectRoot(cwd, global.project);
    const fps = fpsOf(readProject(project, CLI_VERSION).fps);
    const resolvedFile = path.join(project, 'plan', 'beatgrid.resolved.json');
    const sr = NUMBERS['audio.sampleRate'];
    if (flags.track !== undefined) {
      const { lufs: trackLufs, truePeak: trackTruePeak, ...fitted } = await scoreTrack(project, path.resolve(cwd, flags.track), { engine: installedEngine(env), onWarn: (message) => log.warn(message) });
      const track = { ...fitted, trackLufs, trackTruePeak };
      if (!existsSync(resolvedFile)) {
        // No resolved grid yet: the grid was fitted; the mix follows after beatgrid check.
        return { data: { mode: 'track', sound: null, lufs: null, truePeak: null, sfx: [], ...track } as Record<string, unknown>, next: fitted.gridUpdated ? ['mf-motion beatgrid check --json'] : [] };
      }
      const { doc: grid } = readDoc('beatgrid-resolved', resolvedFile);
      const offset = grid.track?.offsetSec ?? fitted.fit.offsetSec;
      const bed = trimWithFade(await decodeStereo(fitted.track, sr), sr, offset, grid.lengthSec);
      const done = await finishScore(project, { mode: 'track', bed, raw: null, bpm: grid.bpm, key: grid.key, genre: null, seed: grid.seed, sfx: grid.sfx, fps });
      return { data: { mode: 'track', ...track, ...done } as Record<string, unknown> };
    }
    const { warnings, ...rendered } = scoreProject(project);
    for (const warning of warnings) log.warn(warning);
    const { doc: grid } = readDoc('beatgrid-resolved', resolvedFile);
    const bed = await decodeStereo(rendered.raw, sr);
    const done = await finishScore(project, { mode: 'synth', bed, raw: 'sound/score-raw.wav', bpm: grid.bpm, key: grid.key, genre: grid.genre, seed: grid.seed, sfx: grid.sfx, fps });
    return { data: { mode: 'synth', ...rendered, ...done } as Record<string, unknown> };
  },
});

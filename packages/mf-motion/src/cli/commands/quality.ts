// Quality commands. measure: metrics.json from a rendered file (MFM-036);
// sheets: the review sheets of a render (MFM-037); later tickets add packet
// and gate here.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Hold, measure } from '../../quality/metrics';
import { PROFILE_LIST, type Profile } from '../../quality/profiles';
import { makeSheets } from '../../quality/sheets';
import { ensureBrowser, ensureEngine, readOk } from '../../engine/index';
import { writeDoc } from '../../schemas/index';
import { MfmError } from '../errors';
import { defineCommand } from '../registry';

function parseHolds(value: string | undefined, cwd: string): Hold[] {
  if (value === undefined) return [];
  const text = existsSync(path.resolve(cwd, value)) ? readFileSync(path.resolve(cwd, value), 'utf8') : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MfmError('USAGE', { flag: '--holds' }, { message: '--holds takes a JSON array of { fromSec, toSec } or a file holding one.' });
  }
  if (!Array.isArray(parsed) || !parsed.every((hold) => typeof hold?.fromSec === 'number' && typeof hold?.toSec === 'number')) {
    throw new MfmError('USAGE', { flag: '--holds' }, { message: '--holds takes a JSON array of { fromSec, toSec }.' });
  }
  return parsed as Hold[];
}

export const measureCommand = defineCommand({
  name: 'measure',
  summary: 'Measure a rendered file into metrics.json: duration, timestamps, frame-0 ink, overlay coverage, stills, contrast, key purity, hard results and caps.',
  positionals: [{ name: 'video', description: 'the rendered file', required: true }],
  flags: {
    profile: { type: 'string', required: true, enum: PROFILE_LIST, value: '<profile>', description: 'film, broll, overlay-alpha or overlay-key' },
    expected: { type: 'number', value: '<sec>', description: 'planned length in seconds (default the file length)' },
    sound: { type: 'string', value: '<sound.json>', description: 'sound/sound.json: SFX cues for timing and rise (films with audio)' },
    holds: { type: 'string', value: '<json>', description: 'overlay hold windows: JSON [{ "fromSec", "toSec" }] or a file' },
    out: { type: 'string', value: '<file>', description: 'where to write metrics.json (default beside the video)' },
  },
  dataSchema: { type: 'object', required: ['metrics'], properties: { metrics: { type: 'string' }, hard: { type: 'array' }, caps: { type: 'array' } } },
  async handler({ args, flags, cwd }) {
    const video = path.resolve(cwd, String(args.video));
    const metrics = await measure(video, {
      ...(flags.sound !== undefined ? { soundFile: path.resolve(cwd, flags.sound) } : {}),
      profile: flags.profile as Profile,
      ...(flags.expected !== undefined ? { expectedSec: flags.expected } : {}),
      holds: parseHolds(flags.holds, cwd),
    });
    const out = flags.out ? path.resolve(cwd, flags.out) : path.join(path.dirname(video), 'metrics.json');
    writeDoc('metrics', out, metrics as never);
    return { data: { metrics: out, hard: metrics.hard, caps: metrics.caps } };
  },
});

export const sheetsCommand = defineCommand({
  name: 'sheets',
  summary: "Sheets of a render for the judge and the user: dense frames, move phone, plates, the engine's beats, seams and phone sheets, and finding crops.",
  positionals: [{ name: 'video', description: 'the rendered file', required: true }],
  flags: {
    dense: { type: 'number', value: '<sec>', description: 'dense sheet step in seconds (default 0.5 for films; 0.25 for moves)' },
    phone: { type: 'boolean', description: 'move phone sheet: frames at 0.3 s, the middle and 0.5 s before the end, 360 px wide' },
    plates: { type: 'boolean', description: 'plates sheet: the overlay at 25%, 50% and 75% over the three fixed plates (overlay-alpha)' },
    build: { type: 'string', value: '<dir>', description: "build folder: adds the engine's beats, seams and phone sheets" },
    check: { type: 'string', value: '<check.json>', description: 'finding crops (at most 6, by severity) from this check (default <build>/check.json)' },
    out: { type: 'string', value: '<dir>', description: 'where to write the sheets (default the folder of the video)' },
  },
  dataSchema: {
    type: 'object',
    required: ['sheets'],
    properties: { sheets: { type: 'array', items: { type: 'object', required: ['role', 'path'], properties: { role: { type: 'string' }, path: { type: 'string' } } } } },
  },
  async handler({ args, flags, cwd, env, log }) {
    const video = path.resolve(cwd, String(args.video));
    if (!existsSync(video)) throw new MfmError('USAGE', { file: video }, { message: `${video} does not exist.` });
    // Sheets are drawn by the engine's Chrome; the engine also gives the review sheets.
    const engine = await ensureEngine(undefined, { env, onProgress: (message) => log.progress(message) });
    const browserPath = readOk(engine.dir)?.browserPath ?? (await ensureBrowser(engine, (chunk) => log.progress(chunk.trim())));
    const result = await makeSheets(video, {
      engine,
      browserPath,
      out: flags.out ? path.resolve(cwd, flags.out) : path.dirname(video),
      ...(flags.dense !== undefined ? { dense: flags.dense } : {}),
      phone: flags.phone === true,
      plates: flags.plates === true,
      ...(flags.build !== undefined ? { build: path.resolve(cwd, flags.build) } : {}),
      ...(flags.check !== undefined ? { check: path.resolve(cwd, flags.check) } : {}),
    });
    return { data: { sheets: result.sheets } };
  },
});

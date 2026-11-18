// Quality commands. measure: metrics.json from a rendered file (MFM-036);
// sheets: the review sheets of a render (MFM-037); packet: the judge packet
// (MFM-038); audit: the frame audit of a build (MFM-035); gate: the one
// verdict of a round (MFM-039).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Hold, measure } from '../../quality/metrics';
import { PROFILE_LIST, type Profile } from '../../quality/profiles';
import { makeSheets } from '../../quality/sheets';
import { audit, writeAudit } from '../../quality/audit';
import { gate } from '../../quality/gate';
import { JUDGE_ROUTES, buildPacket, latestRound } from '../../quality/packet';
import { appendEvent, findProjectRoot, readProject } from '../../paths/index';
import { ensureBrowser, ensureEngine, readOk } from '../../engine/index';
import { readDoc, writeDoc } from '../../schemas/index';
import { MfmError } from '../errors';
import { CLI_VERSION, defineCommand } from '../registry';

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

export const packetCommand = defineCommand({
  name: 'packet',
  summary: "Assemble the round's judge packet: the sheets under their role names, facts.md and packet.json with its content hash; prints the judge instruction.",
  flags: {
    round: { type: 'integer', value: '<n>', description: 'round number (default the latest round)' },
  },
  dataSchema: {
    type: 'object',
    required: ['dir', 'hash', 'files'],
    properties: { dir: { type: 'string' }, hash: { type: 'string' }, files: { type: 'array' }, dropped: { type: 'array' }, instruction: { type: 'string' } },
  },
  async handler({ flags, cwd, env, global, log }) {
    const project = findProjectRoot(cwd, global.project);
    const doc = readProject(project, CLI_VERSION);
    const round = flags.round ?? latestRound(project);
    const roundDir = round === null ? null : path.join(project, 'rounds', String(round));
    if (roundDir === null || !existsSync(roundDir)) {
      throw new MfmError('PACKET_MISSING', { round: round ?? null }, { message: round === null ? 'The project has no rounds yet.' : `Round ${round} does not exist.` });
    }
    const briefFile = path.join(project, 'plan', 'brief.json');
    const purpose = doc.type === 'film' && existsSync(briefFile) ? readDoc('brief', briefFile).doc.purpose : null;
    const brandDir = path.join(project, 'brand');
    // A brand card is drawn only when the round has none; that needs the engine's Chrome.
    const needsCard = !existsSync(path.join(roundDir, 'brand-card.png')) && existsSync(path.join(brandDir, 'brand.json'));
    const engine = needsCard ? await ensureEngine(undefined, { env, onProgress: (message) => log.progress(message) }) : undefined;
    const browserPath = engine ? (readOk(engine.dir)?.browserPath ?? (await ensureBrowser(engine))) : undefined;
    const result = await buildPacket({
      roundDir,
      unit: { type: doc.type === 'film' ? 'film' : 'move', id: doc.id, version: null },
      purpose,
      brandDir: existsSync(brandDir) ? brandDir : null,
      ...(engine ? { engine } : {}),
      ...(browserPath ? { browserPath } : {}),
    });
    if (result.dropped.length > 0) log.warn(`Left out of the packet to keep within the image budget: ${result.dropped.join(', ')}.`);
    return { data: { dir: result.dir, hash: result.hash, files: result.files, dropped: result.dropped, instruction: result.instruction }, next: [...JUDGE_ROUTES] };
  },
});

export const auditCommand = defineCommand({
  name: 'audit',
  summary: 'Frame audit of a composition build: frame margin, copy-safe, spill, overlap, caption and face bands, minimum size and per-line hold; writes audit.json.',
  positionals: [{ name: 'build-dir', description: 'the composition build folder (index.html)', required: true }],
  flags: {
    profile: { type: 'string', required: true, enum: PROFILE_LIST, value: '<profile>', description: 'film, broll, overlay-alpha or overlay-key' },
    aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'], value: '<aspect>', description: 'default from the composition size' },
    captions: { type: 'boolean', description: 'films: the brief sets captions, so the caption band applies' },
    'no-avoid-face': { type: 'boolean', description: 'overlays: the move does not avoid the face band' },
    out: { type: 'string', value: '<file>', description: 'where to write audit.json (default <build-dir>/audit.json)' },
  },
  dataSchema: { type: 'object', required: ['hits', 'lines'], properties: { audit: { type: 'string' }, hits: { type: 'array' }, lines: { type: 'array' }, hard: { type: 'integer' } } },
  async handler({ args, flags, cwd, env, log }) {
    const buildDir = path.resolve(cwd, String(args['build-dir']));
    if (!existsSync(path.join(buildDir, 'index.html'))) throw new MfmError('USAGE', { buildDir }, { message: `${buildDir} has no index.html.` });
    const engine = await ensureEngine(undefined, { env, onProgress: (message) => log.progress(message) });
    const browserPath = readOk(engine.dir)?.browserPath ?? (await ensureBrowser(engine));
    const result = await audit(buildDir, {
      profile: flags.profile as Profile,
      ...(flags.aspect !== undefined ? { aspect: flags.aspect as '16:9' | '9:16' | '1:1' } : {}),
      captions: flags.captions === true,
      avoidFace: flags['no-avoid-face'] !== true,
      engine,
      browserPath,
    });
    const out = flags.out ? path.resolve(cwd, flags.out) : path.join(buildDir, 'audit.json');
    writeAudit(out, result);
    // Exit 1 when a hit is hard for the profile.
    return { data: { audit: out, hits: result.hits, lines: result.lines, hard: result.hard }, exitCode: result.hard > 0 ? 1 : 0 };
  },
});

export const gateCommand = defineCommand({
  name: 'gate',
  summary: "The round's one verdict from lint, audit, check, metrics, packet and scores: PASS, PASS-SELF, PASS-MEASURED or FAIL; writes verdict.json.",
  flags: {
    round: { type: 'integer', value: '<n>', description: 'round number (default the latest round)' },
    target: { type: 'string', enum: ['8', '9'], value: '8|9', description: "target on every axis (default the packet's; library mode is 9)" },
    library: { type: 'boolean', description: 'library mode: only PASS at target 9, judge from another model family (lab)' },
    scores: { type: 'string', value: '<file>', description: 'scores.json to read (default rounds/<n>/scores.json)' },
    'no-vision': { type: 'boolean', description: 'the agent cannot see images: no scores, PASS-MEASURED at best' },
  },
  dataSchema: {
    type: 'object',
    required: ['verdict', 'level', 'summary'],
    properties: { verdict: { type: 'string' }, level: { type: 'string' }, summary: { type: 'string' }, hardFailures: { type: 'array' }, capped: { type: 'array' }, effective: {} },
  },
  async handler({ flags, cwd, global, log }) {
    const project = findProjectRoot(cwd, global.project);
    const doc = readProject(project, CLI_VERSION);
    const round = flags.round ?? latestRound(project);
    const roundDir = round === null ? null : path.join(project, 'rounds', String(round));
    if (round === null || roundDir === null || !existsSync(roundDir)) {
      throw new MfmError('PACKET_MISSING', { round: round ?? null }, { message: round === null ? 'The project has no rounds yet.' : `Round ${round} does not exist.` });
    }
    const outcome = gate({
      roundDir,
      round,
      ...(flags.target !== undefined ? { target: Number(flags.target) as 8 | 9 } : {}),
      library: flags.library === true,
      ...(flags.scores !== undefined ? { scoresFile: path.resolve(cwd, flags.scores) } : {}),
      noVision: flags['no-vision'] === true,
      engine: doc.engine.hyperframes,
      cli: CLI_VERSION,
    });
    const { verdict } = outcome;
    appendEvent(project, { type: 'gate.verdict', actor: 'cli', round, data: { level: verdict.level, target: verdict.target, library: verdict.library, hardFailures: verdict.hardFailures.map((entry) => entry.check), capped: verdict.capped.map((entry) => entry.axis), min: verdict.min, packetHash: verdict.packetHash } }, { command: 'gate' });
    log.progress(outcome.summary);
    if (outcome.failure) throw outcome.failure;
    return {
      data: { verdict: outcome.file, level: verdict.level, summary: outcome.summary, hardFailures: verdict.hardFailures, capped: verdict.capped, effective: verdict.effective },
      exitCode: verdict.level === 'FAIL' ? 1 : 0,
    };
  },
});

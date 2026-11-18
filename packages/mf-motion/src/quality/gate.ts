// The gate (gate.md): the one verdict of a round from its lint, audit, check,
// metrics, packet and scores. Hard checks and measured caps are never
// overruled by a score; the level says what kind of judgement it rests on.
// Only `mf-motion gate` writes verdict.json.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { MfmError } from '../cli/errors';
import { AXES, type Axis } from './rubric';
import { readDoc, writeDoc } from '../schemas/index';
import { axesMissingFixes } from '../schemas/scores';
import { readCheck } from './check';
import { canonicalJson, packetHash } from './packetSpec';
import { PROBLEM_CHECK, type AuditProblem } from './audit';
import { type Profile, modeOf } from './profiles';

export type Level = 'PASS' | 'PASS-SELF' | 'PASS-MEASURED' | 'FAIL';

export interface HardFailure {
  check: string;
  value: number | string;
  limit: number | string;
}

export interface Capped {
  axis: Axis;
  raw: number;
  capped: number;
  because: string;
}

export interface Verdict {
  schemaVersion: 1;
  kind: 'verdict';
  unit: { type: 'film' | 'move' | 'theme'; id: string; version: string | null };
  round: number;
  profile: Profile;
  target: 8 | 9;
  library: boolean;
  level: Level;
  hardFailures: HardFailure[];
  capped: Capped[];
  effective: Record<Axis, number> | null;
  min: number | null;
  mean: number | null;
  packetHash: string;
  scoresHash: string | null;
  rubricVersion: string;
  engine: string;
  cli: string;
  at: string;
}

export interface GateOptions {
  roundDir: string;
  round: number;
  /** Active target; default the packet's. Library mode is always 9. */
  target?: 8 | 9;
  library?: boolean;
  /** scores.json to read (default <round>/scores.json). */
  scoresFile?: string;
  /** The agent cannot see images: no scores, PASS-MEASURED at best. */
  noVision?: boolean;
  engine: string;
  cli: string;
  /** ISO time of the verdict (default now). */
  at?: string;
}

export interface GateOutcome {
  verdict: Verdict;
  /** One-line summary (gate.md, step 7). */
  summary: string;
  /** Measured caps that applied, by reason (reported even without scores). */
  caps: Array<{ axis: string; cap: number; because: string }>;
  /** Axes whose effective score is under the target. */
  belowTarget: Axis[];
  /** A named failure the CLI raises after writing the verdict (library independence). */
  failure: MfmError | null;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const LintDoc = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal('lint'),
  errors: v.array(v.object({ code: v.string() })),
  warnings: v.array(v.object({ code: v.string() })),
});

const AuditDoc = v.object({
  hits: v.array(v.object({ fromSec: v.number(), toSec: v.number(), elementId: v.string(), problem: v.string() })),
  lines: v.array(v.object({ elementId: v.string(), inSec: v.number(), outSec: v.number(), holdSec: v.number(), words: v.number(), ok: v.boolean() })),
});

function readJsonDoc<T>(file: string, schema: v.GenericSchema<unknown, T>, kind: string): T | null {
  if (!existsSync(file)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new MfmError('SCHEMA_INVALID', { kind, file }, { message: `${file} is not valid JSON.` });
  }
  const result = v.safeParse(schema, value);
  if (!result.success) throw new MfmError('SCHEMA_INVALID', { kind, file, issues: result.issues.map((issue) => issue.message) }, { message: `${file} is not a valid ${kind} document.` });
  return result.output;
}

/** scores.json validated for the active target: any schema problem, an axis under it without a fix included, is SCORES_INVALID. */
function readScores(file: string, target: 8 | 9) {
  try {
    return readDoc('scores', file).doc;
  } catch (error) {
    if (!(error instanceof MfmError) || error.code !== 'SCHEMA_INVALID') throw error;
    let axesWithoutFix: string[] = [];
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { axes?: Record<string, { score?: number; fixes?: unknown[] }> };
      axesWithoutFix = AXES.filter((axis) => (raw.axes?.[axis]?.score ?? 10) < target && (raw.axes?.[axis]?.fixes ?? []).length === 0);
    } catch {
      // Not JSON: the schema error says so.
    }
    throw new MfmError('SCORES_INVALID', { file, target, axesWithoutFix, issues: error.details.issues ?? [] }, {
      message: axesWithoutFix.length > 0 ? `Every axis under ${target} needs a fix line; missing for ${axesWithoutFix.join(', ')}.` : `${file} does not match the scores schema.`,
    });
  }
}

/** The packet as written: every file present and unchanged, the round's metrics the packet's copy, the hash recomputed. */
function verifyPacket(roundDir: string) {
  const dir = path.join(roundDir, 'packet');
  const manifestFile = path.join(dir, 'packet.json');
  if (!existsSync(manifestFile)) throw new MfmError('PACKET_MISSING', { round: roundDir }, { message: `${manifestFile} is missing.` });
  const packet = readDoc('judge-packet', manifestFile).doc;
  const stale = (detail: Record<string, unknown>, message: string) =>
    new MfmError('PACKET_MISSING', { round: roundDir, ...detail }, { message, hint: 'Run `mf-motion packet --json` again, then have the judge score the new packet.' });
  for (const file of packet.files) {
    const full = path.join(dir, file.path);
    if (!existsSync(full)) throw stale({ missing: file.path }, `The packet file ${file.path} is missing.`);
    if (sha256(readFileSync(full)) !== file.sha256) throw stale({ changed: file.path }, `The packet file ${file.path} changed after the packet was built.`);
  }
  const metricsCopy = path.join(dir, packet.metrics.path);
  if (!existsSync(metricsCopy) || sha256(readFileSync(metricsCopy)) !== packet.metrics.sha256) throw stale({ changed: packet.metrics.path }, 'The packet copy of metrics.json is missing or changed.');
  const recomputed = packetHash(packet as unknown as Record<string, unknown>);
  if (recomputed !== packet.hash) throw stale({ hash: packet.hash, recomputed }, 'packet.json does not hash to its recorded hash.');
  const roundMetrics = path.join(roundDir, 'metrics.json');
  if (!existsSync(roundMetrics)) throw new MfmError('PACKET_MISSING', { round: roundDir, missing: 'metrics.json' }, { message: `${roundMetrics} is missing.` });
  if (`${canonicalJson(JSON.parse(readFileSync(roundMetrics, 'utf8')))}\n` !== readFileSync(metricsCopy, 'utf8')) {
    throw stale({ changed: 'metrics.json' }, 'metrics.json changed after the packet was built.');
  }
  return packet;
}

/** Compute the verdict of a round (gate.md steps 1-6); the caller writes it (step 7). */
export function computeVerdict(options: GateOptions): GateOutcome {
  const library = options.library === true;
  if (library && options.target === 8) throw new MfmError('USAGE', { target: 8, library: true }, { message: 'Library mode judges at target 9 only.' });
  if (library && options.noVision) throw new MfmError('USAGE', { library: true, noVision: true }, { message: 'Library mode needs scores from a fresh judge; --no-vision is runtime only.' });

  // 1. Inputs, validated; the packet hash recomputed.
  const packet = verifyPacket(options.roundDir);
  const metrics = readDoc('metrics', path.join(options.roundDir, 'metrics.json')).doc;
  const lint = readJsonDoc(path.join(options.roundDir, 'lint.json'), LintDoc, 'lint');
  const audit = readJsonDoc(path.join(options.roundDir, 'audit.json'), AuditDoc, 'audit');
  const checkFile = path.join(options.roundDir, 'check.json');
  const check = existsSync(checkFile) ? readCheck(checkFile) : null;
  const target: 8 | 9 = library ? 9 : (options.target ?? packet.target);
  const profile = packet.profile as Profile;

  const scoresFile = options.scoresFile ?? path.join(options.roundDir, 'scores.json');
  const scoresBytes = existsSync(scoresFile) ? readFileSync(scoresFile) : null;
  const scores = scoresBytes ? readScores(scoresFile, target) : null;
  if (scores && scores.packetHash !== packet.hash) {
    throw new MfmError('SCORES_STALE', { packetHash: packet.hash, scoresPacketHash: scores.packetHash }, { message: `scores.json was written for packet ${scores.packetHash.slice(0, 12)}, not ${packet.hash.slice(0, 12)}.` });
  }
  if (!scores && !options.noVision) {
    throw new MfmError('SCORES_INVALID', { file: scoresFile }, { message: `${scoresFile} is missing: judge the packet, or pass --no-vision when you cannot see images.` });
  }
  if (scores) {
    const missing = axesMissingFixes(scores, target);
    if (missing.length > 0) throw new MfmError('SCORES_INVALID', { file: scoresFile, target, axesWithoutFix: missing }, { message: `Every axis under ${target} needs a fix line; missing for ${missing.join(', ')}.` });
  }

  // 2. Hard failures for the profile: metrics (which merged audit and check), lint, and any audit or check result metrics did not see.
  const context = { hasAudio: metrics.audio !== null, avoidFace: true };
  const hardFailures: HardFailure[] = metrics.hard.filter((entry) => !entry.pass).map(({ check: name, value, limit }) => ({ check: name, value, limit }));
  const reported = new Set(metrics.hard.map((entry) => entry.check));
  if (lint && lint.errors.length > 0 && modeOf(profile, 'lint', context) === 'hard') hardFailures.push({ check: 'lint', value: lint.errors.length, limit: 0 });
  if (check && check.errors > 0 && !reported.has('engine-errors') && modeOf(profile, 'engine-errors', context) === 'hard') hardFailures.push({ check: 'engine-errors', value: check.errors, limit: 0 });
  if (audit) {
    const counts = new Map<string, number>();
    for (const hit of audit.hits) counts.set(hit.problem, (counts.get(hit.problem) ?? 0) + 1);
    for (const [problem, count] of counts) {
      const id = PROBLEM_CHECK[problem as AuditProblem];
      if (id && !reported.has(problem) && modeOf(profile, id, context) === 'hard') hardFailures.push({ check: problem, value: count, limit: 0 });
    }
  }

  // 4. Caps: the effective score is the lowest of the score and every cap on its axis.
  const caps = metrics.caps.map(({ axis, cap, because }) => ({ axis, cap, because }));
  let effective: Record<Axis, number> | null = null;
  const capped: Capped[] = [];
  if (scores) {
    effective = Object.fromEntries(AXES.map((axis) => [axis, scores.axes[axis].score])) as Record<Axis, number>;
    for (const axis of AXES) {
      const binding = caps.filter((cap) => cap.axis === axis).sort((a, b) => a.cap - b.cap)[0];
      if (binding && binding.cap < effective[axis]) {
        capped.push({ axis, raw: effective[axis], capped: binding.cap, because: binding.because });
        effective[axis] = binding.cap;
      }
    }
  }
  const belowTarget = effective ? AXES.filter((axis) => (effective as Record<Axis, number>)[axis] < target) : [];

  // 3, 5, 6. The level.
  let level: Level;
  let failure: MfmError | null = null;
  if (hardFailures.length > 0) level = 'FAIL';
  else if (!scores) level = 'PASS-MEASURED';
  else if (belowTarget.length > 0) level = 'FAIL';
  else if (scores.judge.mode === 'self') level = library ? 'FAIL' : 'PASS-SELF';
  else if (library && scores.judge.provider !== null && scores.judge.provider === packet.builder.provider) {
    level = 'FAIL';
    failure = new MfmError('JUDGE_NOT_INDEPENDENT', { judge: scores.judge.provider, builder: packet.builder.provider }, {
      message: `The judge (${scores.judge.provider}) and the builder (${packet.builder.provider}) share a model family.`,
    });
  } else level = 'PASS';

  const values = effective ? AXES.map((axis) => (effective as Record<Axis, number>)[axis]) : [];
  const verdict: Verdict = {
    schemaVersion: 1,
    kind: 'verdict',
    unit: packet.unit,
    round: options.round,
    profile,
    target,
    library,
    level,
    hardFailures,
    capped,
    effective,
    min: effective ? Math.min(...values) : null,
    mean: effective ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null,
    packetHash: packet.hash,
    scoresHash: scoresBytes ? sha256(scoresBytes) : null,
    rubricVersion: packet.rubricVersion,
    engine: options.engine,
    cli: options.cli,
    at: options.at ?? new Date().toISOString(),
  };
  return { verdict, summary: summaryLine(verdict, caps, belowTarget, failure), caps, belowTarget, failure };
}

/** `round 2 FAIL: hard none; capped rhythm 9->6 (longest still 2.6 s); below target: rhythm` */
export function summaryLine(verdict: Verdict, caps: Array<{ axis: string; cap: number; because: string }>, belowTarget: Axis[], failure: MfmError | null = null): string {
  const hard = verdict.hardFailures.length > 0 ? verdict.hardFailures.map((entry) => entry.check).join(', ') : 'none';
  const cappedText = verdict.effective
    ? verdict.capped.map((entry) => `${entry.axis} ${entry.raw}->${entry.capped} (${entry.because})`).join(', ') || 'none'
    : caps.map((cap) => `${cap.axis} at most ${cap.cap} (${cap.because})`).join(', ') || 'none';
  let line = `round ${verdict.round} ${verdict.level}: hard ${hard}; capped ${cappedText}; below target: ${belowTarget.join(', ') || 'none'}`;
  if (verdict.library && verdict.level === 'FAIL' && verdict.hardFailures.length === 0 && belowTarget.length === 0) {
    line += failure ? '; judge not independent' : '; library needs a fresh judge';
  }
  return line;
}

/** Compute and write verdict.json (the only writer). */
export function gate(options: GateOptions): GateOutcome & { file: string } {
  const outcome = computeVerdict(options);
  const file = path.join(options.roundDir, 'verdict.json');
  writeDoc('verdict', file, outcome.verdict as never);
  return { ...outcome, file };
}

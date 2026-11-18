// The gate on its fixtures: every case returns its expected verdict, the named
// cases of gate.md hold, and the CLI writes verdict.json, logs gate.verdict and
// prints the one-line summary.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { readEvents } from '../../../../src/paths/index';
import { computeVerdict, gate } from '../../../../src/quality/gate';
import { readDoc } from '../../../../src/schemas/index';
import { runIn } from '../../cli/harness';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../../../fixtures');
const gateFixtures = path.join(fixtures, 'gate');
const cases = readdirSync(gateFixtures).filter((name) => existsSync(path.join(gateFixtures, name, 'expect.json')));

interface Run {
  args?: { library?: boolean; noVision?: boolean; target?: 8 | 9 };
  level?: string;
  code?: string;
  hardFailures?: string[];
  capped?: Array<{ axis: string; raw: number; capped: number }>;
}

/** A film project (test/fixtures/projects/film) whose round 1 is the fixture. */
function project(name: string): { root: string; round: string } {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-gate-')), 'film');
  cpSync(path.join(fixtures, 'projects', 'film'), root, { recursive: true });
  const round = path.join(root, 'rounds', '1');
  cpSync(path.join(gateFixtures, name), round, { recursive: true });
  return { root, round };
}

const options = (round: string, args: Run['args'] = {}) => ({ roundDir: round, round: 1, engine: '0.9.61', cli: '1.0.0', at: '2026-11-18T10:00:00.000Z', ...args });

describe('gate fixtures', () => {
  it('covers the six named cases, every hard check and every cap', () => {
    for (const name of ['high-scores-measured-defect', 'hard-failure-perfect-scores', 'no-vision', 'self-judge', 'stale-scores', 'same-family-library']) expect(cases).toContain(name);
    expect(cases.filter((name) => name.startsWith('hard-') && name !== 'hard-failure-perfect-scores')).toHaveLength(13);
    expect(cases.filter((name) => name.startsWith('cap-'))).toHaveLength(11);
  });

  for (const name of cases) {
    const expected = JSON.parse(readFileSync(path.join(gateFixtures, name, 'expect.json'), 'utf8')) as { about: string; runs: Run[] };
    for (const [i, run] of expected.runs.entries()) {
      it(`${name} #${i + 1}: ${expected.about}`, () => {
        const { round } = project(name);
        if (run.code && !run.level) {
          expect(() => computeVerdict(options(round, run.args))).toThrowError(expect.objectContaining({ code: run.code }));
          return;
        }
        const outcome = computeVerdict(options(round, run.args));
        if (run.code) expect(outcome.failure?.code).toBe(run.code);
        else expect(outcome.failure).toBeNull();
        expect(outcome.verdict.level).toBe(run.level);
        if (run.hardFailures) expect(outcome.verdict.hardFailures.map((entry) => entry.check)).toEqual(run.hardFailures);
        if (run.capped) expect(outcome.verdict.capped.map(({ axis, raw, capped }) => ({ axis, raw, capped }))).toEqual(run.capped);
      });
    }
  }
});

describe('gate rules', () => {
  it('high-scores-measured-defect: FAIL with rhythm capped to 6 and the one-line summary', () => {
    const { round } = project('high-scores-measured-defect');
    const outcome = gate(options(round));
    expect(outcome.verdict).toMatchObject({ level: 'FAIL', effective: { rhythm: 6, hook: 10 }, min: 6, target: 8 });
    expect(outcome.summary).toBe('round 1 FAIL: hard none; capped rhythm 10->6 (Longest still 3.1 s over its limit (2 s)); below target: rhythm');
    expect(readDoc('verdict', outcome.file).doc.level).toBe('FAIL');
  });

  it('hard failures stand even with perfect scores, which are still recorded', () => {
    const { round } = project('hard-failure-perfect-scores');
    const { verdict, summary } = computeVerdict(options(round));
    expect(verdict.hardFailures).toEqual([{ check: 'copy-safe', value: 3, limit: 0 }]);
    expect(verdict.effective?.hook).toBe(10);
    expect(verdict.scoresHash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary).toBe('round 1 FAIL: hard copy-safe; capped none; below target: none');
  });

  it('library mode is target 9 and refuses --no-vision and --target 8', () => {
    const { round } = project('clean-pass');
    expect(computeVerdict(options(round, { library: true })).verdict).toMatchObject({ level: 'PASS', target: 9, library: true });
    expect(() => computeVerdict(options(round, { library: true, target: 8 }))).toThrowError(expect.objectContaining({ code: 'USAGE' }));
    expect(() => computeVerdict(options(round, { library: true, noVision: true }))).toThrowError(expect.objectContaining({ code: 'USAGE' }));
    // Scores of 9 pass target 9 at runtime too; 8 would not.
    expect(computeVerdict(options(round, { target: 9 })).verdict.level).toBe('PASS');
  });

  it('a changed packet file or metrics after the packet fail PACKET_MISSING', () => {
    const changed = project('clean-pass').round;
    writeFileSync(path.join(changed, 'packet', 'dense.png'), 'changed');
    expect(() => computeVerdict(options(changed))).toThrowError(expect.objectContaining({ code: 'PACKET_MISSING', details: expect.objectContaining({ changed: 'dense.png' }) }));
    const remeasured = project('clean-pass').round;
    const metrics = JSON.parse(readFileSync(path.join(remeasured, 'metrics.json'), 'utf8'));
    writeFileSync(path.join(remeasured, 'metrics.json'), JSON.stringify({ ...metrics, longestStillSec: 9 }));
    expect(() => computeVerdict(options(remeasured))).toThrowError(expect.objectContaining({ code: 'PACKET_MISSING' }));
    // Formatting alone does not matter: the packet keeps canonical JSON.
    const reformatted = project('clean-pass').round;
    writeFileSync(path.join(reformatted, 'metrics.json'), JSON.stringify(JSON.parse(readFileSync(path.join(reformatted, 'metrics.json'), 'utf8'))));
    expect(computeVerdict(options(reformatted)).verdict.level).toBe('PASS');
  });

  it('no-vision without scores and a cap reports the cap in the summary', () => {
    const { round } = project('cap-still');
    rmSync(path.join(round, 'scores.json'));
    const outcome = computeVerdict(options(round, { noVision: true }));
    expect(outcome.verdict).toMatchObject({ level: 'PASS-MEASURED', effective: null, min: null, scoresHash: null });
    expect(outcome.summary).toBe('round 1 PASS-MEASURED: hard none; capped rhythm at most 6 (Longest still 3.1 s over its limit (2 s)); below target: none');
  });
});

describe('gate command', () => {
  it('writes verdict.json, appends gate.verdict and exits 1 on FAIL', async () => {
    const { root, round } = project('high-scores-measured-defect');
    const result = await runIn(['gate', '--project', root, '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(1);
    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: { level: string; summary: string; verdict: string } };
    expect(envelope.data).toMatchObject({ level: 'FAIL', verdict: path.join(round, 'verdict.json') });
    expect(envelope.data.summary).toMatch(/^round 1 FAIL: hard none; capped rhythm 10->6/);
    expect(result.stderr).toContain('round 1 FAIL');
    const events = readEvents(root).filter((event) => event.type === 'gate.verdict');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ round: 1, actor: 'cli', data: { level: 'FAIL', capped: ['rhythm'] } });
  });

  it('exits 0 for PASS-MEASURED and PASS-SELF', async () => {
    const measured = project('no-vision');
    expect((await runIn(['gate', '--project', measured.root, '--no-vision', '--json'], COMMANDS, {})).code).toBe(0);
    const self = project('self-judge');
    const result = await runIn(['gate', '--project', self.root, '--round', '1', '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).data.level).toBe('PASS-SELF');
  });

  it('library mode with a same-family judge fails JUDGE_NOT_INDEPENDENT after writing a FAIL verdict', async () => {
    const { root, round } = project('same-family-library');
    const result = await runIn(['gate', '--project', root, '--library', '--json'], COMMANDS, {});
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stdout).error.code).toBe('JUDGE_NOT_INDEPENDENT');
    expect(readDoc('verdict', path.join(round, 'verdict.json')).doc).toMatchObject({ level: 'FAIL', library: true, target: 9 });
  });

  it('stale scores and missing fixes fail with their codes and write no verdict', async () => {
    const stale = project('stale-scores');
    const staleRun = await runIn(['gate', '--project', stale.root, '--json'], COMMANDS, {});
    expect(JSON.parse(staleRun.stdout).error.code).toBe('SCORES_STALE');
    expect(existsSync(path.join(stale.round, 'verdict.json'))).toBe(false);
    const missing = project('missing-fix');
    const missingRun = await runIn(['gate', '--project', missing.root, '--json'], COMMANDS, {});
    expect(JSON.parse(missingRun.stdout).error).toMatchObject({ code: 'SCORES_INVALID', details: { axesWithoutFix: ['rhythm'] } });
  });
});

// Seed acceptance (move-contract.md, Seed moves): for every demo brand, aspect
// and declared mode, the move builds and lints clean, the frame audit has no
// hit, every hard metric passes for its profile, and the gate with the fixture
// scores (all axes 8, judge self) returns PASS-SELF. Shared by the seed tickets.
// The cases come from test/helpers/seed-matrix.ts: every case by default, one
// rotating case per seed with MFM_SEED_MATRIX=sample (testing.md, Seed matrix in CI).
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLI_VERSION } from '../../../../../src/cli/registry';
import { type Engine, enginePins, packageRoot } from '../../../../../src/engine/index';
import { NUMBERS } from '../../../../../src/kit/numbers';
import { DEMOS } from '../../../../../src/library/contract';
import { findMove, libraryMoves } from '../../../../../src/library/registry';
import { renderMove } from '../../../../../src/moves/render';
import { gate } from '../../../../../src/quality/gate';
import { testBrowser } from '../../../../helpers/engine';
import { casesToRegister } from '../../../../helpers/seed-matrix';

const SCORES = path.join(packageRoot(), 'test', 'fixtures', 'scores', 'seed-self-8.json');

export function seedAcceptance(id: string, expected: { category: string; uses: string[] }): void {
  const meta = findMove(id).meta;
  const home = realpathSync.native(mkdtempSync(path.join(tmpdir(), `mfm-seed-${id}-home-`)));
  let engine: Engine;
  let browserPath = '';

  beforeAll(async () => {
    ({ engine, browserPath } = await testBrowser());
  }, 900_000);

  describe(`${id}: meta`, () => {
    it('is a seed of its category with its uses, every aspect and the demo examples', () => {
      expect(meta.status).toBe('seed');
      expect(meta.category).toBe(expected.category);
      expect([...meta.uses].sort()).toEqual([...expected.uses].sort());
      expect([...meta.aspects].sort()).toEqual(['16:9', '1:1', '9:16']);
      const range = NUMBERS['move.durationSec'];
      expect(meta.durationSec.min).toBeGreaterThanOrEqual(range.min);
      expect(meta.durationSec.max).toBeLessThanOrEqual(range.max);
      expect(meta.say.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(meta.examples).sort()).toEqual([...DEMOS].sort());
      expect(meta.kit.length).toBeGreaterThan(0);
    });

    it("has a signature no other seed has", () => {
      const others = libraryMoves().filter((entry) => entry.meta.id !== id && entry.meta.status === 'seed');
      for (const other of others) expect(other.meta.signature, other.meta.id).not.toEqual(meta.signature);
    });
  });

  for (const { brand, aspect, mode } of casesToRegister(meta)) {
    it(`${id}: ${brand} ${aspect} ${mode} lints, audits, measures clean and gates PASS-SELF`, async () => {
      const out = realpathSync.native(mkdtempSync(path.join(tmpdir(), `mfm-seed-${id}-`)));
      // png keeps the master and skips the delivery encodes; the gate measures its own encode.
      const result = await renderMove({ id, brand: `demo:${brand}`, aspect, mode, out, home, engine, browserPath, formats: ['png'], gate: true, cli: CLI_VERSION });
      const round = path.join(out, 'round');
      const read = (name: string) => JSON.parse(readFileSync(path.join(round, name), 'utf8'));
      expect(read('lint.json').errors).toEqual([]);
      expect(read('audit.json').hits).toEqual([]);
      const metrics = read('metrics.json');
      expect(metrics.hard.filter((check: { pass: boolean }) => !check.pass)).toEqual([]);
      expect(metrics.caps).toEqual([]);
      const scores = JSON.parse(readFileSync(SCORES, 'utf8'));
      scores.packetHash = result.gate?.packet.hash;
      writeFileSync(path.join(round, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
      const outcome = gate({ roundDir: round, round: 1, target: 8, engine: enginePins().hyperframes, cli: CLI_VERSION });
      expect(outcome.verdict.hardFailures).toEqual([]);
      expect(outcome.verdict.level).toBe('PASS-SELF');
    }, 600_000);
  }
}

// The frame audit on seeded-defect compositions: one per problem, a clean one,
// a short hold and a moving headline that is exempt from the frame margin. An
// entry's alsoAt renders the same composition at another aspect (short-line:
// 1:1 and 16:9).
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import type { Engine } from '../../../../src/engine/index';
import { trusted } from '../../../../src/kit/build/html';
import { moveCtx, writeMoveBuild } from '../../../../src/kit/build/move';
import { type AuditResult, audit } from '../../../../src/quality/audit';
import type { Profile } from '../../../../src/quality/profiles';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../../unit/cli/harness';
import { buildRuntime, packageRoot } from '../../kit/type/page';

type FixtureAspect = '16:9' | '9:16' | '1:1';

interface FixtureExpect {
  problems: string[];
  elements?: string[];
  /** Exact number of merged hits. */
  hits?: number;
  range?: { elementId: string; problem: string; fromMin: number; fromMax: number; toMin: number; toMax: number };
  line?: { elementId: string; holdSec: number; words: number; needSec: number; ok: boolean };
}

interface Fixture {
  about: string;
  aspect: FixtureAspect;
  layer: 'overlay' | 'broll';
  mode: 'full' | 'alpha';
  profile: Profile;
  html: string;
  css: string;
  script: string;
  expect: FixtureExpect;
  alsoAt?: Array<{ aspect: FixtureAspect; expect: FixtureExpect }>;
}

const raw = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'fixtures', 'audit', 'fixtures.json'), 'utf8')) as Record<string, Fixture>;
// One case per fixture and per alsoAt aspect ("short-line@16:9").
const fixtures: Record<string, Fixture> = Object.fromEntries(
  Object.entries(raw).flatMap(([name, fixture]) => [
    [name, fixture] as const,
    ...(fixture.alsoAt ?? []).map((variant) => [`${name}@${variant.aspect}`, { ...fixture, aspect: variant.aspect, expect: variant.expect }] as const),
  ]),
);
const mossmallow = JSON.parse(readFileSync(path.join(packageRoot, 'assets', 'demo-brands', 'mossmallow', 'brand.json'), 'utf8'));

let engine: Engine;
let browserPath = '';
const builds: Record<string, string> = {};
const results: Record<string, AuditResult> = {};

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
  for (const [name, fixture] of Object.entries(fixtures)) {
    const ctx = moveCtx({ aspect: fixture.aspect, mode: fixture.mode, layer: fixture.layer, brand: mossmallow, seed: 1, durationSec: 4 });
    const dir = mkdtempSync(path.join(tmpdir(), `mfm-audit-${name.replace(/[^a-z0-9-]/gi, '-')}-`));
    writeMoveBuild(dir, ctx, { id: name.split('@')[0] as string, html: trusted(fixture.html), css: fixture.css, script: fixture.script, assets: [], needsThree: false, holds: [] }, {}, { engineDir: engine.dir });
    builds[name] = dir;
  }
}, 900_000);

const run = async (name: string) => {
  results[name] ??= await audit(builds[name] as string, { profile: (fixtures[name] as Fixture).profile, engine, browserPath });
  return results[name] as AuditResult;
};
const problems = (result: AuditResult) => [...new Set(result.hits.map((hit) => hit.problem))].sort();

describe('frame audit', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name}: ${fixture.about}`, async () => {
      const result = await run(name);
      expect(problems(result), JSON.stringify(result.hits)).toEqual([...fixture.expect.problems].sort());
      if (fixture.expect.hits !== undefined) expect(result.hits, JSON.stringify(result.hits)).toHaveLength(fixture.expect.hits);
      if (fixture.expect.elements) {
        expect([...new Set(result.hits.map((hit) => hit.elementId))].sort()).toEqual([...fixture.expect.elements].sort());
      }
      if (fixture.expect.range) {
        const want = fixture.expect.range;
        const ranges = result.hits.filter((hit) => hit.elementId === want.elementId && hit.problem === want.problem);
        // Consecutive steps merge into one range.
        expect(ranges, JSON.stringify(result.hits)).toHaveLength(1);
        const hit = ranges[0];
        expect(hit?.fromSec).toBeGreaterThanOrEqual(want.fromMin);
        expect(hit?.fromSec).toBeLessThanOrEqual(want.fromMax);
        expect(hit?.toSec).toBeGreaterThanOrEqual(want.toMin);
        expect(hit?.toSec).toBeLessThanOrEqual(want.toMax);
      }
      if (fixture.expect.line) {
        const { holdSec, ...rest } = fixture.expect.line;
        const line = result.lines.find((entry) => entry.elementId === rest.elementId);
        expect(line).toMatchObject(rest);
        // Cue times snap to frames: the hold is within one frame of the planned one.
        expect(Math.abs((line?.holdSec ?? 0) - holdSec)).toBeLessThanOrEqual(1 / 30 + 1e-6);
      }
      // Every line reports its hold, and every held line its ink box and colour.
      for (const line of result.lines) {
        expect(line.holdSec).toBeCloseTo(line.outSec - line.inSec, 3);
        if (line.holdSec > 0 && name !== 'moving') expect(line.box && line.color).toBeTruthy();
      }
    }, 300_000);
  }

  it('audit writes audit.json and exits 1 only on a hard hit for the profile', async () => {
    const clean = await runIn(['audit', builds.clean as string, '--profile', 'broll', '--json'], COMMANDS, { MF_MOTION_CACHE: testCacheRoot() });
    expect(clean.code, clean.stdout).toBe(0);
    const data = JSON.parse(clean.stdout).data as { audit: string; hits: unknown[]; lines: unknown[]; hard: number };
    expect(data).toMatchObject({ hits: [], hard: 0 });
    expect(existsSync(data.audit)).toBe(true);
    expect(JSON.parse(readFileSync(data.audit, 'utf8'))).toEqual({ hits: data.hits, lines: data.lines });
    const edge = await runIn(['audit', builds['frame-margin'] as string, '--profile', 'broll', '--json'], COMMANDS, { MF_MOTION_CACHE: testCacheRoot() });
    expect(edge.code).toBe(1);
    // Face-band and min-size are caps, not hard: exit 0.
    const face = await runIn(['audit', builds['face-band'] as string, '--profile', 'overlay-alpha', '--json'], COMMANDS, { MF_MOTION_CACHE: testCacheRoot() });
    expect(face.code, face.stdout).toBe(0);
    expect(JSON.parse(face.stdout).data.hits.length).toBeGreaterThan(0);
  }, 600_000);
});

// The same time module, bundled for the browser and run in the engine's
// Chrome, resolves 10,000 seeded random specs on random grids to the same
// frame (or the same error code) as Node.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { withPage } from '../../../src/media/chrome';
import { type TimeGrid, resolveSpec } from '../../../src/time/index';
import { testBrowser } from '../../helpers/engine';

const CASES = 10_000;
const FPS = ['24', '25', '30', '50', '60', '24000/1001', '30000/1001', '60000/1001'];

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case {
  spec: string | number;
  grid: TimeGrid | null;
}

function makeCases(seed: number): Case[] {
  const random = prng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const dec = (max: number) => (Math.round(random() * max * 1000) / 1000).toString();
  const cases: Case[] = [];
  for (let i = 0; i < CASES; i += 1) {
    const kind = random();
    let grid: TimeGrid | null;
    if (kind < 0.75) {
      const bars = int(1, 16);
      const beatsPerBar = pick([3, 4]);
      const cues: Record<string, string | number> = {};
      cues.drop = `bar${int(1, bars)}.${int(1, beatsPerBar)}`;
      cues.logo = `@drop+${dec(1)}b`;
      cues['end-card'] = random() < 0.5 ? `end-${dec(2)}` : Number(dec(3));
      cues.hit2 = random() < 0.1 ? '@hit2+1f' : `@logo-${int(0, 4)}f`;
      grid = { fps: pick(FPS), bpm: Math.round((60 + random() * 120) * 10) / 10, beatsPerBar, bars, tailSec: Number(dec(2)), cues };
    } else if (kind < 0.95) {
      grid = { fps: pick(FPS), lengthSec: Number(dec(8)) + 0.5 };
    } else {
      grid = null;
    }
    const base = pick([
      () => dec(20),
      () => `${dec(20)}s`,
      () => `${int(0, 600)}f`,
      () => `bar${int(1, 18)}`,
      () => `bar${int(1, 18)}.${int(1, 5)}`,
      () => `b${int(1, 70)}`,
      () => `@${pick(['drop', 'logo', 'end-card', 'hit2', 'nope'])}`,
      () => 'start',
      () => 'end',
      () => Number(dec(10)),
      () => pick(['bar0', 'b0', 'bar3 .2', '1.5f', 'x', '3.', '@Up']),
    ])();
    let spec: string | number = base;
    if (typeof spec === 'string' && random() < 0.6) {
      const count = int(1, 3);
      for (let k = 0; k < count; k += 1) {
        spec += `${random() < 0.5 ? '+' : '-'}${pick([`${dec(2)}`, `${dec(2)}s`, `${int(0, 40)}f`, `${dec(2)}b`])}`;
      }
    }
    cases.push({ spec, grid });
  }
  return cases;
}

const outcome = (c: Case): number | string => {
  try {
    return resolveSpec(c.spec, c.grid).frame;
  } catch (error) {
    return `E:${(error as { code?: string }).code ?? 'unknown'}`;
  }
};

let page: { dir: string };
let engineSetup: Awaited<ReturnType<typeof testBrowser>>;

beforeAll(async () => {
  engineSetup = await testBrowser();
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-time-'));
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/time/index.ts');
  await build({ entryPoints: [entry], bundle: true, format: 'iife', globalName: 'mfmTime', platform: 'browser', target: 'chrome120', outfile: path.join(dir, 'time.js'), logLevel: 'silent' });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><script src="time.js"></script>');
  page = { dir };
}, 900_000);

describe('time grammar in Node and in Chrome', () => {
  it(`agrees on every frame for ${CASES} seeded random cases`, async () => {
    const cases = makeCases(20261118);
    const node = cases.map(outcome);
    const browser = await withPage(
      { dir: page.dir, width: 64, height: 64, composition: false, engine: engineSetup.engine, browserPath: engineSetup.browserPath },
      (driver) =>
        driver.evaluate((all: Case[]) => {
          const time = (window as unknown as { mfmTime: { resolveSpec: (spec: string | number, grid: TimeGrid | null) => { frame: number } } }).mfmTime;
          return all.map((c) => {
            try {
              return time.resolveSpec(c.spec, c.grid).frame;
            } catch (error) {
              return `E:${(error as { code?: string }).code ?? 'unknown'}`;
            }
          });
        }, cases),
    );
    expect(browser).toHaveLength(CASES);
    const mismatches = cases.map((c, i) => ({ c, node: node[i], browser: browser[i] })).filter((row) => row.node !== row.browser);
    expect(mismatches.slice(0, 5)).toEqual([]);
    const frames = node.filter((value) => typeof value === 'number').length;
    const errors = new Set(node.filter((value) => typeof value === 'string'));
    // The generator exercises both resolutions and every kind of refusal.
    expect(frames).toBeGreaterThan(4000);
    expect([...errors].sort()).toEqual(['E:GRID_INVALID', 'E:GRID_REQUIRED']);
  }, 300_000);
});

// The move contract suite (move-contract.md, rules 1-7) for every library move
// and the fixture move, the registry, and the move info / move render commands.
// Negative fixtures prove the checks bite: a literal #FF0000 breaks rule 2 and
// Math.random fails lint (rule 6).
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { isMfmError } from '../../../../src/cli/errors';
import type { Engine } from '../../../../src/engine/index';
import { type MoveMode, moveCtx, moveProfile, VARS_TAG } from '../../../../src/kit/build/move';
import type { AspectKey } from '../../../../src/kit/numbers';
import { NUMBERS } from '../../../../src/kit/numbers';
import { DEMOS, type MoveModule, checkAssets, checkVars, maxCharsVars, resolveVars, scanComposition, validateMeta, varsJsonSchema } from '../../../../src/library/contract';
import { type RegistryEntry, allMoves, findMove, libraryMoves, mergeUser, registerMoves } from '../../../../src/library/registry';
import { brandFor, buildMove } from '../../../../src/moves/build';
import { audit } from '../../../../src/quality/audit';
import { packageRoot } from '../../../../src/engine/index';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';
import { runIn } from '../../cli/harness';
import * as badColor from '../../../fixtures/moves/bad-color/index';
import * as badRandom from '../../../fixtures/moves/bad-random/index';
import * as fixtureCard from '../../../fixtures/moves/fixture-card/index';

const FIXTURES = path.join(packageRoot(), 'test', 'fixtures', 'moves');
const entry = (module: MoveModule, folder: string): RegistryEntry => ({ meta: module.meta, source: 'user', dir: path.join(FIXTURES, folder), load: async () => module });
const FIXTURE_ENTRIES = [entry(fixtureCard, 'fixture-card'), entry(badColor, 'bad-color'), entry(badRandom, 'bad-random')];

let engine: Engine;
let browserPath = '';
const home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-contract-home-')));
const temp = (name: string) => realpathSync.native(mkdtempSync(path.join(tmpdir(), `mfm-contract-${name}-`)));

beforeAll(async () => {
  registerMoves(FIXTURE_ENTRIES);
  ({ engine, browserPath } = await testBrowser());
}, 900_000);

afterAll(() => registerMoves([]));

/** The moves the contract runs over: every library move and the good fixture. */
const subjects = () => [...libraryMoves(), ...FIXTURE_ENTRIES.slice(0, 1)];

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('move contract', () => {
  it('runs over every library move and the fixture move', () => {
    const ids = subjects().map((subject) => subject.meta.id);
    expect(ids).toContain('fixture-card');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rule 1: build is pure (the same ctx and vars give the same composition)', async () => {
    for (const subject of subjects()) {
      const module = await subject.load();
      const brand = brandFor(home, 'demo:tessarine');
      const vars = resolveVars(subject.meta, null, 'tessarine');
      for (const aspect of subject.meta.aspects) {
        const ctx = () => moveCtx({ aspect, mode: subject.meta.modes[0] as MoveMode, layer: subject.meta.uses.includes('overlay') ? 'overlay' : 'broll', brand: brand.doc as never, seed: 1, durationSec: subject.meta.durationSec.default });
        const once = module.build(ctx(), vars);
        const twice = module.build(ctx(), vars);
        expect(sha(JSON.stringify({ ...once, html: once.html.value })), `${subject.meta.id} ${aspect}`).toBe(sha(JSON.stringify({ ...twice, html: twice.html.value })));
        expect(once.id).toBe(subject.meta.id);
      }
    }
  });

  it('rule 2: no literal colours, pixel sizes or font names in CSS or script', async () => {
    for (const subject of subjects()) {
      const module = await subject.load();
      const brand = brandFor(home, 'demo:mossmallow');
      for (const aspect of subject.meta.aspects) {
        for (const mode of subject.meta.modes) {
          const ctx = moveCtx({ aspect, mode, layer: subject.meta.uses.includes('overlay') ? 'overlay' : 'broll', brand: brand.doc as never, seed: 1, durationSec: subject.meta.durationSec.default });
          expect(scanComposition(module.build(ctx, resolveVars(subject.meta, null, 'mossmallow'))), `${subject.meta.id} ${aspect} ${mode}`).toEqual([]);
        }
      }
    }
  });

  it('rules 4 and 6: every declared aspect and mode builds and passes lint (no network, clocks or unseeded randomness)', async () => {
    for (const subject of subjects()) {
      for (const aspect of subject.meta.aspects) {
        for (const mode of subject.meta.modes) {
          const out = temp('aspects');
          const result = await buildMove({ id: subject.meta.id, brand: 'demo:tessarine', aspect, mode, out, home, engine });
          expect(result.lint.errors, `${subject.meta.id} ${aspect} ${mode}`).toEqual([]);
          // Full mode renders the b-roll when the move offers one; alpha and key render the overlay.
          expect(result.profile).toBe(moveProfile(mode === 'full' && subject.meta.uses.includes('broll') ? 'broll' : 'overlay', mode));
          expect(result.keyColor === null).toBe(mode !== 'key');
        }
      }
    }
  }, 300_000);

  it('rule 4: the examples for all three demo brands build', async () => {
    for (const subject of subjects()) {
      for (const demo of DEMOS) {
        const out = temp(`demo-${demo}`);
        const result = await buildMove({ id: subject.meta.id, brand: `demo:${demo}`, aspect: subject.meta.aspects[0] as AspectKey, mode: subject.meta.modes[0] as MoveMode, out, home, engine });
        expect(result.vars).toMatchObject(subject.meta.examples[demo]);
        expect(result.lint.errors).toEqual([]);
      }
    }
  }, 300_000);

  it('rules 3 and 5: the maxChars W string fits at every aspect, and every text line enters and leaves before the exit window', async () => {
    for (const subject of subjects()) {
      const longest = maxCharsVars(subject.meta);
      for (const aspect of subject.meta.aspects) {
        const mode = subject.meta.modes.includes('alpha') ? 'alpha' : (subject.meta.modes[0] as MoveMode);
        const result = await buildMove({ id: subject.meta.id, brand: 'demo:tessarine', aspect, mode, vars: longest, out: temp('maxchars'), home, engine });
        const report = await audit(result.build, { profile: result.profile as never, aspect, avoidFace: subject.meta.avoidFace, engine, browserPath });
        expect(report.hits, `${subject.meta.id} ${aspect}`).toEqual([]);
        expect(report.lines.length).toBeGreaterThan(0);
        for (const lineReport of report.lines) {
          // Lines enter (nothing readable on frame 0); first ink by overlay.firstInkSec is measured on the render (MFM-042 --gate).
          expect(lineReport.inSec, `${subject.meta.id} ${lineReport.elementId}`).toBeGreaterThan(0);
          expect(lineReport.outSec).toBeLessThanOrEqual(result.durationSec - NUMBERS['overlay.exitWindowSec'].min);
        }
      }
    }
  }, 600_000);

  it('rule 5: text variables declare maxChars and longer text fails VARS_INVALID', () => {
    for (const subject of subjects()) {
      for (const [name, spec] of Object.entries(subject.meta.vars)) {
        if (spec.type !== 'text') continue;
        expect(spec.maxChars, `${subject.meta.id}.${name}`).toBeGreaterThan(0);
        expect(checkVars(subject.meta, { [name]: 'W'.repeat((spec.maxChars ?? 0) + 1) })).not.toEqual([]);
      }
    }
    const meta = { ...fixtureCard.meta, vars: { ...fixtureCard.meta.vars, note: { type: 'text' as const, default: '', describe: 'a note' } } };
    expect(() => validateMeta(meta, 'fixture')).toThrowError(/declares no maxChars/);
  });

  it('rule 7: assets come from the kit, the brand or the move folder with credits', async () => {
    const kit = path.join(packageRoot(), 'assets', 'kit');
    for (const subject of subjects()) {
      const module = await subject.load();
      const brand = brandFor(home, 'demo:quillfen');
      const ctx = moveCtx({ aspect: subject.meta.aspects[0] as AspectKey, mode: subject.meta.modes[0] as MoveMode, layer: subject.meta.uses.includes('overlay') ? 'overlay' : 'broll', brand: brand.doc as never, seed: 1, durationSec: subject.meta.durationSec.default });
      const composition = module.build(ctx, resolveVars(subject.meta, null, 'quillfen'));
      expect(checkAssets([...ctx.assets.requests, ...composition.assets], subject.dir, [kit, brand.dir])).toEqual([]);
    }
    const own = path.join(FIXTURES, 'fixture-card');
    expect(checkAssets([{ from: path.join(own, 'assets', 'mark.svg'), to: 'mark.svg' }], own, [kit])).toEqual(['mark.svg has no origin in assets/credits.json']);
    expect(checkAssets([{ from: path.join(tmpdir(), 'elsewhere.png'), to: 'elsewhere.png' }], own, [kit])[0]).toMatch(/neither a kit, brand nor move asset/);
  });

  it('rule 2 bites: a literal #FF0000 is reported', async () => {
    const brand = brandFor(home, 'demo:tessarine');
    const ctx = moveCtx({ aspect: '16:9', mode: 'alpha', layer: 'overlay', brand: brand.doc as never, seed: 1, durationSec: 3.5 });
    const hits = scanComposition(badColor.build(ctx, resolveVars(badColor.meta, null, 'tessarine')));
    expect(hits).toEqual([{ rule: 2, where: 'css', match: '#FF0000', reason: 'hex colour' }]);
    expect(scanComposition({ css: '#fc-card { width: calc(var(--mf-u) * 4); border: 1px solid var(--mf-line); }', script: '' })).toEqual([]);
    expect(scanComposition({ css: '.a { font-family: "Inter", sans-serif; margin: 12px; background: rgb(0, 0, 0); }', script: "tl.to(x, { color: '#fff' })" }).map((hit) => hit.reason).sort()).toEqual(['font name', 'hex colour', 'pixel size', 'rgb colour']);
  });

  it('rule 6 bites: Math.random fails lint', async () => {
    const error = await buildMove({ id: 'fixture-bad-random', brand: 'demo:tessarine', aspect: '16:9', mode: 'alpha', out: temp('random'), home, engine }).catch((caught: unknown) => caught);
    expect(isMfmError(error) && error.code).toBe('LINT_FAILED');
    const errors = (error as { details: { errors: Array<{ code: string; message: string }> } }).details.errors;
    expect(errors.some((finding) => finding.code.startsWith('DET') && /random/i.test(finding.message))).toBe(true);
  });
});

describe('move registry', () => {
  it('finds registered moves and fails unknown ids with MOVE_NOT_FOUND', () => {
    expect(findMove('fixture-card').meta.name).toBe('Fixture card');
    const error = (() => {
      try {
        findMove('no-such-move');
      } catch (caught) {
        return caught;
      }
    })();
    expect(isMfmError(error) && error.code).toBe('MOVE_NOT_FOUND');
    expect(allMoves().warnings).toEqual([]);
  });

  it('keeps the library move when a user move has the same id', () => {
    const library: RegistryEntry = { ...FIXTURE_ENTRIES[0] as RegistryEntry, source: 'library' };
    const user: RegistryEntry = { ...(FIXTURE_ENTRIES[0] as RegistryEntry), source: 'user' };
    const merged = mergeUser([library], [user]);
    expect(merged.entries).toEqual([library]);
    expect(merged.warnings.map((warning) => warning.code)).toEqual(['USER_MOVE_SHADOWED']);
  });

  it('resolves vars: defaults, then the demo example, then the given vars', () => {
    expect(resolveVars(fixtureCard.meta, null, null)).toEqual({ title: 'New teams', value: 42, tone: 'accent' });
    expect(resolveVars(fixtureCard.meta, null, 'mossmallow')).toEqual({ title: 'Recipes', value: 38, tone: 'accent' });
    expect(resolveVars(fixtureCard.meta, { value: 7 }, 'mossmallow')).toEqual({ title: 'New teams', value: 7, tone: 'accent' });
    expect(() => resolveVars(fixtureCard.meta, { colour: 'red' }, null)).toThrowError(/colour is not a variable/);
    expect(() => resolveVars(fixtureCard.meta, { tone: 'muted' }, null)).toThrowError(/tone must be one of accent, ink/);
  });
});

describe('move info and move render', () => {
  const env = () => ({ MF_MOTION_CACHE: testCacheRoot(), MF_MOTION_HOME: home });

  it('move info returns the meta, the vars schema and the examples', async () => {
    const result = await runIn(['move', 'info', 'fixture-card', '--json'], COMMANDS, env());
    expect(result.code).toBe(0);
    const { data } = JSON.parse(result.stdout);
    expect(data.meta.id).toBe('fixture-card');
    expect(data.varsSchema).toEqual(varsJsonSchema(fixtureCard.meta));
    expect(data.varsSchema.properties.title).toMatchObject({ type: 'string', maxLength: 12 });
    expect(data.varsSchema.properties.tone).toMatchObject({ enum: ['accent', 'ink'] });
    expect(data.examples.quillfen).toEqual({ title: 'Essays', value: 12 });
  });

  // Rendering and encoding (MFM-042) run in the serial render project: test/render/moves/encode.
  it('the move render build path writes a linted build/index.html with the vars inlined', async () => {
    const out = temp('render');
    const result = await buildMove({ id: 'fixture-card', brand: 'demo:mossmallow', aspect: '9:16', mode: 'alpha', vars: { value: 64 }, out, home, engine });
    expect(result.build).toBe(path.join(out, 'build'));
    expect(result.keyColor).toBeNull();
    const page = readFileSync(path.join(out, 'build', 'index.html'), 'utf8');
    const inline = page.slice(page.indexOf(VARS_TAG.open) + VARS_TAG.open.length, page.indexOf(VARS_TAG.close, page.indexOf(VARS_TAG.open)));
    const vars = JSON.parse(inline);
    expect(vars).toEqual(JSON.parse(readFileSync(path.join(out, 'build', 'assets', 'vars.json'), 'utf8')));
    expect(JSON.stringify(vars)).toContain('"value":64');
    expect(page).toContain('class="mf-move is-alpha is-portrait"');
    expect(page).toMatch(/@font-face \{ font-family: "Noto Sans"; src: url\('assets\/fonts\/NotoSans\.woff2'\)/);
    expect(existsSync(path.join(out, 'build', 'assets', 'fonts', 'NotoSans.woff2'))).toBe(true);
    const lint = await runIn(['lint', path.join(out, 'build'), '--profile', 'overlay-alpha', '--json'], COMMANDS, env());
    expect(JSON.parse(lint.stdout).data.errors).toEqual([]);
  }, 120_000);

  it('key mode has a key colour; an undeclared aspect fails ASPECT_UNSUPPORTED', async () => {
    const key = await buildMove({ id: 'fixture-card', brand: 'demo:quillfen', aspect: '16:9', mode: 'key', out: temp('key'), home, engine });
    expect(key.keyColor).toMatch(/^#[0-9A-F]{6}$/);
    const square = await runIn(['move', 'render', 'fixture-card', '--brand', 'demo:quillfen', '--aspect', '1:1', '--mode', 'key', '--out', temp('square'), '--json'], COMMANDS, env());
    expect(square.code).toBe(2);
    expect(JSON.parse(square.stdout).error.code).toBe('ASPECT_UNSUPPORTED');
  }, 120_000);

  it('fails an unknown id with MOVE_NOT_FOUND, bad vars with VARS_INVALID and an unknown demo brand with BRAND_NOT_FOUND', async () => {
    const unknown = await runIn(['move', 'render', 'no-such-move', '--brand', 'demo:tessarine', '--aspect', '16:9', '--mode', 'alpha', '--json'], COMMANDS, env());
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.stdout).error.code).toBe('MOVE_NOT_FOUND');
    const info = await runIn(['move', 'info', 'no-such-move', '--json'], COMMANDS, env());
    expect(JSON.parse(info.stdout).error.code).toBe('MOVE_NOT_FOUND');
    const long = await runIn(['move', 'render', 'fixture-card', '--brand', 'demo:tessarine', '--aspect', '16:9', '--mode', 'alpha', '--vars', JSON.stringify({ title: 'W'.repeat(13) }), '--out', temp('long'), '--json'], COMMANDS, env());
    expect(JSON.parse(long.stdout).error.code).toBe('VARS_INVALID');
    const notJson = await runIn(['move', 'render', 'fixture-card', '--brand', 'demo:tessarine', '--aspect', '16:9', '--mode', 'alpha', '--vars', '{title', '--out', temp('json'), '--json'], COMMANDS, env());
    expect(JSON.parse(notJson.stdout).error.code).toBe('VARS_INVALID');
    const brand = await runIn(['move', 'render', 'fixture-card', '--brand', 'demo:nobody', '--aspect', '16:9', '--mode', 'alpha', '--out', temp('brand'), '--json'], COMMANDS, env());
    expect(JSON.parse(brand.stdout).error.code).toBe('BRAND_NOT_FOUND');
  }, 120_000);
});

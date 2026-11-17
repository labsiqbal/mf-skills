// plan check: storylines (three, ids a-c, 3-6 lines, a pick) and the spec
// (numbers inside the numbers table, BANNED ids or custom entries).
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { BANNED_IDS, BANNED_LINT_RULES, BANNED_MEANING, bannedFacts, isBannedEntry } from '../../../../src/film/banned';
import { parseStorylines } from '../../../../src/film/plan';
import { runIn } from '../../../unit/cli/harness';

const here = path.dirname(fileURLToPath(import.meta.url));
const filmFixture = path.resolve(here, '../../../fixtures/projects/film');

function project(): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-plan-')), 'film');
  cpSync(filmFixture, dir, { recursive: true });
  cpSync(path.join(here, 'fixture', 'plan'), path.join(dir, 'plan'), { recursive: true });
  return dir;
}

async function check(dir: string) {
  const result = await runIn(['plan', 'check', '--project', dir, '--json'], COMMANDS, {});
  return { code: result.code, json: JSON.parse(result.stdout) as Record<string, any> };
}

const editSpec = (dir: string, change: (spec: Record<string, any>) => void) => {
  const file = path.join(dir, 'plan', 'spec.json');
  const spec = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
  change(spec);
  writeFileSync(file, JSON.stringify(spec));
};

const messages = (json: Record<string, any>) => (json.data.problems as Array<{ message: string }>).map((problem) => problem.message);

describe('plan check', () => {
  it('the fixture plan validates', async () => {
    const result = await check(project());
    expect(result.code).toBe(0);
    expect(result.json.data).toMatchObject({ storylines: ['a', 'b', 'c'], pick: { id: 'a' }, problems: [] });
    expect(result.json.data.spec.numbers.arriveSec).toEqual([0.5, 0.8]);
    expect(result.json.next).toEqual(['mf-motion beatgrid check --json']);
  });

  it('two storylines fail', async () => {
    const dir = project();
    const file = path.join(dir, 'plan', 'storylines.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/## c[\s\S]*?(?=\nPick:)/, ''));
    expect(messages((await check(dir)).json)).toContain('found 2 storylines; write exactly three (## a, ## b, ## c)');
  });

  it('a pick naming d fails', async () => {
    const dir = project();
    const file = path.join(dir, 'plan', 'storylines.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Pick: a -', 'Pick: d -'));
    const problems = messages((await check(dir)).json);
    expect(problems).toContain('Pick names "d", which is not one of the storylines (a, b, c)');
    expect(problems).toContain('spec.storyline is "a" but storylines.md picks "d"');
  });

  it('arriveSec [0.2, 0.3] fails the numbers range', async () => {
    const dir = project();
    editSpec(dir, (spec) => {
      spec.numbers.arriveSec = [0.2, 0.3];
    });
    expect(messages((await check(dir)).json)).toEqual(['numbers.arriveSec [0.2,0.3] is outside motion.arriveSec 0.45-0.9']);
  });

  it('an unknown BANNED id fails while custom:no lens flares passes', async () => {
    const dir = project();
    editSpec(dir, (spec) => {
      spec.banned = ['custom:no lens flares', 'lens-flare'];
    });
    expect(messages((await check(dir)).json)).toContain('banned "lens-flare" is not a BANNED id or a custom:<text> entry');
    expect(isBannedEntry('custom:no lens flares')).toBe(true);
    expect(isBannedEntry('custom:')).toBe(false);
  });

  it('checks the other numbers, line counts and missing files', async () => {
    const dir = project();
    editSpec(dir, (spec) => {
      spec.numbers.exitSec = [0.1, 0.3];
      spec.numbers.heroShare = 0.3;
      spec.numbers.endCardHoldSec = 5;
      spec.numbers.transitions = ['cut', 'cut'];
      spec.numbers.staggerMs = [20, 60];
    });
    expect(messages((await check(dir)).json)).toEqual([
      'numbers.exitSec [0.1,0.3] is outside motion.exitSec 0.2-0.35',
      'numbers.staggerMs [20,60] is outside motion.stagger.itemsMs-wordsMs 40-120',
      'numbers.heroShare 0.3 is outside type.heroHeightShare 0.09-0.21',
      'numbers.endCardHoldSec 5 is outside endCard.holdSec 2-3.5',
      'numbers.transitions has 1 kind(s); motion.transitionsPerFilm asks for 3-5',
    ]);
    expect(parseStorylines('## a\none\n## b\n1\n2\n3\n## c\n1\n2\n3\nPick: b - it is the clearest').problems.map((p) => p.message)).toEqual(['storyline a has 1 line(s); write 3-6']);
    const empty = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-plan-')), 'film');
    cpSync(filmFixture, empty, { recursive: true });
    expect(messages((await check(empty)).json)).toEqual(['plan/storylines.md is missing', 'plan/spec.json is missing']);
  });
});

describe('BANNED list', () => {
  it('holds the closed ids, maps four to lint rules and renders facts lines', () => {
    expect(BANNED_IDS).toHaveLength(22);
    expect(Object.keys(BANNED_MEANING).sort()).toEqual([...BANNED_IDS].sort());
    expect(BANNED_LINT_RULES).toEqual({ emoji: 'CPY003', 'dashes-in-copy': 'CPY001', 'placeholder-copy': 'CPY002', 'layout-tweens': 'STR001' });
    expect(bannedFacts(['emoji', 'three-card-row', 'custom:no lens flares'])).toEqual([
      'banned: emoji (emoji), checked by lint CPY003',
      'banned: three-card-row (a row of three cards)',
      'banned: no lens flares',
    ]);
  });
});

// plan check: three storylines with a pick (plan/storylines.md) and the numeric
// spec with its BANNED list (plan/spec.json), validated before any beat grid.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { NUMBERS } from '../kit/numbers';
import { specSchema } from '../schemas/spec';
import { isBannedEntry } from './banned';

export const STORYLINE_IDS = ['a', 'b', 'c'] as const;
export const STORYLINE_LINES = { min: 3, max: 6 } as const;

export interface PlanProblem {
  file: 'storylines.md' | 'spec.json';
  message: string;
}

export interface Storylines {
  ids: string[];
  pick: { id: string; reason: string } | null;
  problems: PlanProblem[];
}

/** Parse storylines.md: `## <id>` sections of 3-6 lines and a final `Pick: <id> - <reason>`. */
export function parseStorylines(text: string): Storylines {
  const problems: PlanProblem[] = [];
  const add = (message: string) => problems.push({ file: 'storylines.md', message });
  const lines = text.split(/\r?\n/);
  const sections: Array<{ id: string; lines: string[] }> = [];
  let pick: { id: string; reason: string } | null = null;
  const last = [...lines].reverse().find((line) => line.trim() !== '') ?? '';
  const pickMatch = last.trim().match(/^Pick:\s*([A-Za-z0-9-]+)\s+-\s+(\S.*)$/);
  if (pickMatch) pick = { id: pickMatch[1] ?? '', reason: (pickMatch[2] ?? '').trim() };
  else add('the last line must be "Pick: <id> - <one-sentence reason>"');
  for (const line of lines) {
    const heading = line.match(/^##\s+(\S+)/);
    if (heading) {
      sections.push({ id: (heading[1] ?? '').replace(/[:.]$/, '').toLowerCase(), lines: [] });
      continue;
    }
    if (/^Pick:/.test(line.trim())) continue;
    if (line.trim() !== '' && sections.length > 0) sections[sections.length - 1]?.lines.push(line);
  }
  const ids = sections.map((section) => section.id);
  if (sections.length !== 3) add(`found ${sections.length} storylines; write exactly three (## a, ## b, ## c)`);
  if (sections.length === 3 && ids.join(',') !== STORYLINE_IDS.join(',')) add(`storyline ids are ${ids.join(', ')}; use a, b and c`);
  for (const section of sections) {
    if (section.lines.length < STORYLINE_LINES.min || section.lines.length > STORYLINE_LINES.max) {
      add(`storyline ${section.id} has ${section.lines.length} line(s); write ${STORYLINE_LINES.min}-${STORYLINE_LINES.max}`);
    }
  }
  if (pick && !ids.includes(pick.id)) add(`Pick names "${pick.id}", which is not one of the storylines (${ids.join(', ')})`);
  if (pick && pick.reason.split(/\s+/).length < 3) add('the pick reason must be one sentence');
  return { ids, pick, problems };
}

type Spec = v.InferOutput<typeof specSchema>;

const within = (value: number, range: { min: number; max: number }) => value >= range.min && value <= range.max;

/** Spec numbers against the numbers table (only where the table gives a range). */
export function specProblems(spec: Spec, pickId: string | null): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const add = (message: string) => problems.push({ file: 'spec.json', message });
  const n = spec.numbers;
  const pair = (name: string, value: number[], range: { min: number; max: number }, key: string) => {
    if (!value.every((item) => within(item, range))) add(`numbers.${name} ${JSON.stringify(value)} is outside ${key} ${range.min}-${range.max}`);
  };
  pair('arriveSec', n.arriveSec, NUMBERS['motion.arriveSec'], 'motion.arriveSec');
  pair('exitSec', n.exitSec, NUMBERS['motion.exitSec'], 'motion.exitSec');
  const stagger = { min: NUMBERS['motion.stagger.itemsMs'].min, max: NUMBERS['motion.stagger.wordsMs'].max };
  pair('staggerMs', n.staggerMs, stagger, 'motion.stagger.itemsMs-wordsMs');
  if (!(n.cameraSec > 0)) add('numbers.cameraSec must be positive (motion.cameraSec is 0.6 typical)');
  if (!within(n.heroShare, NUMBERS['type.heroHeightShare'])) add(`numbers.heroShare ${n.heroShare} is outside type.heroHeightShare ${NUMBERS['type.heroHeightShare'].min}-${NUMBERS['type.heroHeightShare'].max}`);
  if (!within(n.endCardHoldSec, NUMBERS['endCard.holdSec'])) add(`numbers.endCardHoldSec ${n.endCardHoldSec} is outside endCard.holdSec ${NUMBERS['endCard.holdSec'].min}-${NUMBERS['endCard.holdSec'].max}`);
  const kinds = new Set(n.transitions);
  const range = NUMBERS['motion.transitionsPerFilm'].kinds;
  if (!within(kinds.size, range)) add(`numbers.transitions has ${kinds.size} kind(s); motion.transitionsPerFilm asks for ${range.min}-${range.max}`);
  for (const entry of spec.banned) if (!isBannedEntry(entry)) add(`banned "${entry}" is not a BANNED id or a custom:<text> entry`);
  if (pickId && spec.storyline !== pickId) add(`spec.storyline is "${spec.storyline}" but storylines.md picks "${pickId}"`);
  return problems;
}

export interface PlanCheck {
  storylines: string[];
  pick: { id: string; reason: string } | null;
  spec: Spec | null;
  problems: PlanProblem[];
}

/** Validate plan/storylines.md and plan/spec.json. */
export function checkPlan(project: string): PlanCheck {
  const dir = path.join(project, 'plan');
  const problems: PlanProblem[] = [];
  const storyFile = path.join(dir, 'storylines.md');
  const stories = existsSync(storyFile) ? parseStorylines(readFileSync(storyFile, 'utf8')) : { ids: [], pick: null, problems: [{ file: 'storylines.md' as const, message: 'plan/storylines.md is missing' }] };
  problems.push(...stories.problems);
  let spec: Spec | null = null;
  const specFile = path.join(dir, 'spec.json');
  if (!existsSync(specFile)) problems.push({ file: 'spec.json', message: 'plan/spec.json is missing' });
  else {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(specFile, 'utf8'));
    } catch (error) {
      problems.push({ file: 'spec.json', message: `not JSON: ${(error as Error).message}` });
    }
    if (raw !== undefined) {
      const parsed = v.safeParse(specSchema, raw);
      if (parsed.success) {
        spec = parsed.output;
        problems.push(...specProblems(spec, stories.pick?.id ?? null));
      } else {
        for (const issue of parsed.issues) problems.push({ file: 'spec.json', message: `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}` });
        // Report BANNED entries by name even when the schema already refused them.
        const banned = (raw as { banned?: unknown }).banned;
        if (Array.isArray(banned)) for (const entry of banned) if (typeof entry === 'string' && !isBannedEntry(entry)) problems.push({ file: 'spec.json', message: `banned "${entry}" is not a BANNED id or a custom:<text> entry` });
      }
    }
  }
  return { storylines: stories.ids, pick: stories.pick, spec, problems };
}

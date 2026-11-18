import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../engine/pins';
import { type AspectKey, NUMBERS } from '../kit/numbers';
import { CATEGORIES } from '../schemas/move-meta';
import { type MoveMeta, overlayAspectsOf } from './contract';
import type { RegistryEntry } from './registry';

type Category = MoveMeta['category'];
type Use = MoveMeta['uses'][number];
type Page = 'index' | Category;

const USES = ['overlay', 'broll'] as const;
const MODES = ['alpha', 'key', 'full'] as const;
const TOPICS: Record<Category, string> = {
  social: 'messages, comments, follows, polls, shares',
  creator: 'subscribers, uploads, sponsors, milestones, analytics',
  ai: 'prompts, answers, models, generated results',
  dev: 'commands, code, debugging, test results',
  productivity: 'tasks, progress, schedules, habits',
  business: 'revenue, growth, products, customers',
  data: 'rankings, trends, comparisons, metrics',
  paper: 'underlines, quotes, notes, annotations',
  system: 'titles, logos, identities, transitions',
  explain: 'processes, relationships, sequences, diagrams',
};

export interface CatalogueFilter {
  category?: Category;
  use?: Use;
  aspect?: AspectKey;
}

export const catalogueTokens = (text: string): number => Math.ceil(Array.from(text).length / 4);

function indexText(moves: readonly MoveMeta[]): string {
  const counts = new Map<Category, number>();
  for (const { category } of moves) counts.set(category, (counts.get(category) ?? 0) + 1);
  return [
    `mf-motion catalogue: ${moves.length} moves in ${CATEGORIES.length} categories. Read one category, then \`mf-motion move info <id>\`.`,
    ...CATEGORIES.map((category) => `${category} (${counts.get(category) ?? 0}): ${TOPICS[category]}.`),
    'Pick by what the speaker says.',
    '',
  ].join('\n');
}

export function categoryLine(meta: MoveMeta): string {
  const say = meta.say.slice(0, 2).map((text) => JSON.stringify(text));
  const uses = USES.filter((use) => meta.uses.includes(use));
  const modes = MODES.filter((mode) => meta.modes.includes(mode));
  const aspects = meta.overlayAspects ? ` | overlay ${meta.overlayAspects.join(', ')}` : '';
  return `- ${meta.id} | when the speaker says ${say.join(', ')} | ${uses.join(', ')} | ${modes.join(', ')}${aspects}`;
}

function categoryText(moves: readonly MoveMeta[]): string {
  const ordered = [...moves].sort((a, b) => {
    const use = Number(b.uses.includes('overlay')) - Number(a.uses.includes('overlay'));
    return use || (a.id < b.id ? -1 : Number(a.id !== b.id));
  });
  return ordered.length ? `${ordered.map(categoryLine).join('\n')}\n` : '';
}

/** Assemble and check every page before the generator writes any of them. */
export function catalogueFiles(moves: readonly MoveMeta[]): Record<Page, string> {
  const files = { index: indexText(moves) } as Record<Page, string>;
  for (const category of CATEGORIES) {
    files[category] = categoryText(moves.filter((meta) => meta.category === category));
  }
  for (const [page, text] of Object.entries(files)) {
    const limit = page === 'index' ? NUMBERS['catalogue.indexTokens'] : NUMBERS['catalogue.categoryTokens'];
    const tokens = catalogueTokens(text);
    if (tokens > limit) throw new Error(`Catalogue ${page} uses ${tokens} tokens (limit ${limit}).`);
  }
  return files;
}

function matches(meta: MoveMeta, { category, aspect, use }: CatalogueFilter): boolean {
  if (category && meta.category !== category) return false;
  if (use && !meta.uses.includes(use)) return false;
  if (!aspect) return true;
  const broll = use !== 'overlay' && meta.uses.includes('broll') && meta.aspects.includes(aspect);
  const overlay = use !== 'broll' && meta.uses.includes('overlay') && overlayAspectsOf(meta).includes(aspect);
  return broll || overlay;
}

/** Read the built-in catalogue from disk, filtering it or adding user moves in memory. */
export function readCatalogue(entries: readonly RegistryEntry[], filter: CatalogueFilter = {}, dir = path.join(packageRoot(), 'dist', 'catalog')) {
  const { category, use, aspect } = filter;
  const built = readFileSync(path.join(dir, `${category ?? 'index'}.md`), 'utf8');
  const filtered = entries.filter(({ meta }) => matches(meta, filter));
  const user = filtered.filter(({ source }) => source === 'user').map(({ meta }) => meta);

  let text = built;
  if (!category && (use || aspect || user.length)) {
    text = indexText(filtered.map(({ meta }) => meta));
  } else if (category) {
    if (use || aspect) {
      const ids = new Set(filtered.map(({ meta }) => meta.id));
      text = built.split('\n').filter((line) => ids.has(line.slice(2, line.indexOf(' | ')))).join('\n');
      if (text) text += '\n';
    }
    text += categoryText(user);
  }
  return { text, tokens: catalogueTokens(text) };
}

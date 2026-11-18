import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { safeParse, type InferOutput } from 'valibot';
import { MfmError } from '../cli/errors';
import { profileFile, readProfile } from '../cloud/consent';
import { NUMBERS } from '../kit/numbers';
import type { MoveMode } from '../kit/build/move';
import { checkVars, overlayAspectsOf } from '../library/contract';
import { allMoves } from '../library/registry';
import { probe } from '../media/probe';
import { appendEvent, confine, lastShown, planHash, readEvents, writeFileAtomic } from '../paths/index';
import { parseDoc, readDoc } from '../schemas/index';
import { placementSchema } from '../schemas/placement';
import type { ProfileDoc } from '../schemas/profile';
import type { ProjectDoc } from '../schemas/project';

export type Placement = InferOutput<typeof placementSchema>;
export type PlacementItem = Placement['items'][number];
export type OverlayExport = ProfileDoc['overlayExport'];

export interface PlacementProblem {
  id: string;
  code: 'P001' | 'P002' | 'P003' | 'P004' | 'P005' | 'P006' | 'P007' | 'P008' | 'P009';
  message: string;
}

export const placementFile = (root: string) => confine(root, 'plan/placement.json');

export function overlayExportFor(home: string): OverlayExport {
  return existsSync(profileFile(home)) ? readProfile(home).overlayExport : 'mov';
}

export function itemMode(plan: Placement, item: PlacementItem): MoveMode {
  return item.layer === 'broll' ? 'full' : plan.mode === 'key' ? 'key' : 'alpha';
}

export function readPlacement(file: string): Placement {
  if (!existsSync(file)) throw new MfmError('PLACEMENT_INVALID', { file }, { message: 'Write plan/placement.json before checking placements.' });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new MfmError('SCHEMA_INVALID', { kind: 'placement', file }, { message: `${file} is not valid JSON.` });
  }
  // Parse the structural schema here so duplicate ids can be returned as P008.
  // The document registry still owns error messages for invalid structure or version.
  const structural = safeParse(placementSchema.pipe[0], raw);
  return structural.success ? structural.output : parseDoc('placement', raw, file).doc;
}

function tokens(text: string, segmenter: Intl.Segmenter): string[] {
  return Array.from(segmenter.segment(text.normalize('NFC').toLowerCase()))
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

function tokenOverlap(quote: string[], nearby: string[]): number {
  if (quote.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of nearby) counts.set(token, (counts.get(token) ?? 0) + 1);
  let matches = 0;
  for (const token of quote) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      counts.set(token, count - 1);
      matches += 1;
    }
  }
  return matches / quote.length;
}

export async function validatePlacement(root: string, project: ProjectDoc, plan: Placement, format: OverlayExport): Promise<PlacementProblem[]> {
  const { items } = plan;
  const quoteWindow = NUMBERS['placement.sayWindowSec'];
  const overlapMinimum = NUMBERS['placement.sayMatchMin'];
  const startGap = NUMBERS['placement.minStartGapSec'];
  const clearGap = NUMBERS['placement.minClearGapSec'];
  const transcript = readDoc('transcript', confine(root, plan.source.transcript)).doc;
  const segmenter = new Intl.Segmenter(transcript.language, { granularity: 'word' });
  const words = transcript.words.map((word) => ({ ...word, tokens: tokens(word.w, segmenter) }));
  const source = path.isAbsolute(plan.source.media) ? plan.source.media : confine(root, plan.source.media);
  const media = await probe(source);
  if (!media.video) throw new MfmError('PLACEMENT_INVALID', { file: source }, { message: 'Placement source must contain a video stream.' });
  const footageDuration = Math.min(plan.source.durationSec, media.durationSec);
  const expectedMode = format === 'key-mp4' ? 'key' : 'alpha';
  const moves = new Map(allMoves().entries.map(({ meta }) => [meta.id, meta]));
  const problems: PlacementProblem[] = [];
  const add = (id: string, code: PlacementProblem['code'], message: string) => problems.push({ id, code, message });
  if (plan.aspect !== project.aspect) add('placement', 'P002', `Placement aspect ${plan.aspect} must match project aspect ${project.aspect}.`);

  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const { id } = item;
    const meta = moves.get(item.move);
    const mode = itemMode(plan, item);
    if (!meta || meta.version !== item.version) add(id, 'P001', `No catalogue entry for ${item.move} ${item.version}.`);
    if (item.layer === 'overlay' && plan.mode !== expectedMode) {
      add(id, 'P002', `Profile export ${format} requires placement mode ${expectedMode} for overlays.`);
    }
    if (meta) {
      const aspects = item.layer === 'overlay' ? overlayAspectsOf(meta) : meta.aspects;
      if (!meta.uses.includes(item.layer) || !meta.modes.includes(mode) || !aspects.includes(project.aspect)) {
        add(id, 'P002', `${meta.id} does not support ${project.aspect} ${item.layer} in ${mode} mode.`);
      }
      for (const problem of checkVars(meta, item.vars)) add(id, 'P003', problem);
      if (item.durSec < meta.durationSec.min || item.durSec > meta.durationSec.max) {
        add(id, 'P004', `${meta.id} requires a duration from ${meta.durationSec.min} to ${meta.durationSec.max} s.`);
      }
    }
    if (item.at + item.durSec > footageDuration + 1e-9) {
      add(id, 'P006', `The move ends after the footage duration of ${footageDuration} s.`);
    }
    const nearby = words.filter((word) => word.end >= item.at - quoteWindow && word.start <= item.at + quoteWindow);
    const overlap = tokenOverlap(tokens(item.say, segmenter), nearby.flatMap((word) => word.tokens));
    if (overlap < overlapMinimum) {
      add(id, 'P007', `“${item.say}” matches ${Math.round(overlap * 100)}% of the required words near ${item.at} s. At least ${overlapMinimum * 100}% must match.`);
    }
    const previous = items[index - 1];
    if (seen.has(id) || (previous && (previous.at >= item.at || BigInt(previous.id.slice(1)) >= BigInt(id.slice(1))))) {
      add(id, 'P008', 'Placement ids must be unique and increase in time order.');
    }
    seen.add(id);
  }
  const chronological = [...items].sort((a, b) => a.at - b.at);
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1]!;
    const item = chronological[index]!;
    if (item.at - previous.at < startGap - 1e-9 || item.at - previous.at - previous.durSec < clearGap - 1e-9) {
      add(item.id, 'P005', `Leave at least ${startGap} s between starts and ${clearGap} s clear of ${previous.id}.`);
    }
    if (item.move === previous.move) add(item.id, 'P009', `Consecutive placements repeat ${item.move}.`);
  }
  return problems;
}

function markdownCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\|`*_{}\[\]]/g, '\\$&');
}

function displayTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${(tenths % 600 / 10).toFixed(1).padStart(4, '0')}`;
}

export async function checkPlacement(root: string, project: ProjectDoc, format: OverlayExport) {
  const file = placementFile(root);
  const hash = existsSync(file) ? planHash(file) : null;
  const plan = readPlacement(file);
  const problems = await validatePlacement(root, project, plan, format);
  if (hash === null || !existsSync(file) || planHash(file) !== hash) throw new MfmError('APPROVAL_STALE', { file }, { message: 'The plan changed during placement check. Run placement check again.' });
  if (problems.length === 0) {
    const table = [
      '| # | At | Move | Shows | Because they say |',
      '|---|---|---|---|---|',
      ...plan.items.map((item) => `| ${item.id} | ${displayTime(item.at)} | ${item.move} | ${markdownCell(item.reason)} | "${markdownCell(item.say)}" |`),
      '',
      'Reply yes to render these, or tell me what to change.',
      '',
    ].join('\n');
    writeFileAtomic(confine(root, 'plan/placement.md'), table);
    appendEvent(root, { type: 'plan.shown', actor: 'cli', data: { subject: 'placement', planHash: hash } });
  }
  return { items: plan.items, problems, planHash: hash };
}

export function approvedPlacementHash(root: string): string {
  const events = readEvents(root);
  const approved = events.findLast((event) => event.type === 'approval.recorded' && event.data.subject === 'placement');
  const next = ['mf-motion placement check --json', 'mf-motion approve --subject placement --text "<their words>" --json'];
  if (!approved) throw new MfmError('APPROVAL_MISSING', { subject: 'placement' }, { next });
  const file = placementFile(root);
  const hash = existsSync(file) ? planHash(file) : null;
  const shown = lastShown(root, 'placement', events);
  if (hash === null || hash !== approved.data.planHash || hash !== shown?.data.planHash) {
    throw new MfmError('APPROVAL_STALE', { subject: 'placement', shownHash: shown?.data.planHash ?? null, approvedHash: approved.data.planHash, currentHash: hash }, { next });
  }
  return hash;
}

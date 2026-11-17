// The film brief: interview answers collected key by key with `film brief
// --set`, checked against the brief schema with `--check`, and rendered to
// plan/brief.md. A brief may be partial while the interview runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { MfmError } from '../cli/errors';
import { NUMBERS } from '../kit/numbers';
import { lockFile, readProject, withLock } from '../paths/index';
import { BRIEF_VERSION, type BriefDoc, briefSchema } from '../schemas/brief';
import { parseDoc } from '../schemas/index';

/** The interview (film-pipeline.md), at most interview.maxQuestions, asked in one message. */
export const INTERVIEW_QUESTIONS = [
  { id: 'purpose', text: 'What should this film make people do or feel? One sentence.', fills: ['purpose'] },
  { id: 'length', text: 'How long: 10, 15, 20 or 30 seconds? (20 if you are not sure.)', fills: ['lengthSec'] },
  { id: 'aspect', text: 'Wide, vertical or square?', fills: ['aspect'], skipWhen: 'the profile or the request already says' },
  { id: 'moment', text: 'Is there one moment it must have, such as a number, a screen or a line?', fills: ['signatureMoment'] },
  { id: 'look', text: 'Pick a look now, or see the theme board with your brand first?', fills: ['theme'] },
] as const;

export const BRIEF_KEYS = ['purpose', 'audience', 'lengthSec', 'aspect', 'theme', 'signatureMoment', 'cta', 'mustSay', 'mustNotSay', 'captions', 'voiceover', 'music', 'reference'] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];

/** Fields with a default; the rest must be answered. theme stays null until picked from the board. */
const DEFAULTS: Partial<Record<BriefKey, unknown>> = {
  theme: null,
  cta: null,
  mustSay: [],
  mustNotSay: [],
  captions: false,
  voiceover: 'none',
  music: 'synth',
  reference: null,
};

const LIST_KEYS = new Set<BriefKey>(['mustSay', 'mustNotSay']);
const NULLABLE_KEYS = new Set<BriefKey>(['theme', 'cta', 'reference']);

export type DraftBrief = Partial<Record<BriefKey, unknown>> & { schemaVersion: number; kind: 'brief'; answeredAt?: string };

export const briefFile = (project: string) => path.join(project, 'plan', 'brief.json');
export const briefMdFile = (project: string) => path.join(project, 'plan', 'brief.md');

export function readDraft(project: string): DraftBrief {
  const file = briefFile(project);
  if (!existsSync(file)) return { schemaVersion: BRIEF_VERSION, kind: 'brief' };
  const value = JSON.parse(readFileSync(file, 'utf8')) as DraftBrief;
  if (value.kind !== 'brief') throw new MfmError('SCHEMA_INVALID', { file }, { message: `${file} is not a brief.` });
  return value;
}

/** Turn one --set value into the field's type. */
export function parseValue(key: BriefKey, raw: string): unknown {
  const text = raw.trim();
  if (NULLABLE_KEYS.has(key) && (text === 'null' || text === '')) return null;
  if (key === 'lengthSec') {
    const n = Number(text.replace(/s$/i, ''));
    return Number.isFinite(n) && text !== '' ? n : text;
  }
  if (key === 'captions') return text === 'true' ? true : text === 'false' ? false : text;
  if (LIST_KEYS.has(key)) {
    if (text.startsWith('[')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text === '' ? [] : [text];
  }
  return raw;
}

/** Validate one field against the brief schema. */
export function checkField(key: BriefKey, value: unknown): unknown {
  const schema = (briefSchema.entries as Record<string, v.GenericSchema>)[key];
  if (!schema) throw new MfmError('USAGE', { key, keys: BRIEF_KEYS }, { message: `"${key}" is not a brief field.`, hint: `Use one of: ${BRIEF_KEYS.join(', ')}.` });
  const result = v.safeParse(schema, value);
  if (!result.success) {
    const range = key === 'lengthSec' ? ` (${NUMBERS['film.lengthSec'].min}-${NUMBERS['film.lengthSec'].max} s, default ${NUMBERS['film.lengthSec'].default})` : '';
    throw new MfmError('SCHEMA_INVALID', { key, value, issues: result.issues.map((issue) => issue.message) }, { message: `brief ${key}=${JSON.stringify(value)} is not valid${range}: ${result.issues[0]?.message ?? ''}` });
  }
  return result.output;
}

/** Required fields the brief does not have yet. */
export function missingFields(draft: DraftBrief): BriefKey[] {
  return BRIEF_KEYS.filter((key) => !(key in DEFAULTS) && draft[key] === undefined);
}

/** The draft with defaults filled; a full BriefDoc when nothing is missing. */
export function completeBrief(draft: DraftBrief): BriefDoc | null {
  if (missingFields(draft).length > 0) return null;
  const doc = { ...DEFAULTS, ...draft, schemaVersion: BRIEF_VERSION, kind: 'brief', answeredAt: draft.answeredAt ?? new Date().toISOString() };
  return parseDoc('brief', doc).doc;
}

const show = (value: unknown) => (value === null || value === undefined ? '-' : Array.isArray(value) ? (value.length === 0 ? '-' : value.map((item) => `"${item}"`).join(', ')) : String(value));

export function renderBriefMd(draft: DraftBrief, missing: BriefKey[]): string {
  const value = (key: BriefKey) => (draft[key] !== undefined ? draft[key] : key in DEFAULTS ? DEFAULTS[key] : undefined);
  const lines = [
    '# Brief',
    '',
    `- Purpose: ${show(value('purpose'))}`,
    `- Audience: ${show(value('audience'))}`,
    `- Length: ${value('lengthSec') === undefined ? '-' : `${value('lengthSec')} s`}`,
    `- Aspect: ${show(value('aspect'))}`,
    `- Signature moment: ${show(value('signatureMoment'))}`,
    `- Theme: ${value('theme') === null ? 'not picked yet (theme board)' : show(value('theme'))}`,
    `- Call to action: ${show(value('cta'))}`,
    `- Must say: ${show(value('mustSay'))}`,
    `- Must not say: ${show(value('mustNotSay'))}`,
    `- Captions: ${value('captions') ? 'yes' : 'no'}`,
    `- Voiceover: ${show(value('voiceover'))}`,
    `- Music: ${show(value('music'))}`,
    `- Reference: ${show(value('reference'))}`,
    '',
    missing.length === 0 ? 'Status: complete.' : `Status: missing ${missing.join(', ')}.`,
    '',
  ];
  return lines.join('\n');
}

export interface BriefResult {
  brief: DraftBrief | BriefDoc;
  missing: BriefKey[];
  md: string;
}

/** film brief --set k=v ... [--check]: apply the answers, write brief.json and brief.md. */
export async function editBrief(project: string, sets: string[], options: { cliVersion: string; onWarn?: (message: string) => void }): Promise<BriefResult> {
  const doc = readProject(project, options.cliVersion);
  if (doc.type !== 'film') throw new MfmError('USAGE', { project, type: doc.type }, { message: 'film brief needs a film project.', hint: 'Create one with `mf-motion new "<title>" --type film`.' });
  return withLock(
    lockFile(project),
    () => {
      const draft = readDraft(project);
      if (draft.aspect === undefined) draft.aspect = doc.aspect;
      for (const pair of sets) {
        const at = pair.indexOf('=');
        if (at <= 0) throw new MfmError('USAGE', { set: pair }, { message: `--set ${pair} is not key=value.`, hint: 'For example --set lengthSec=20.' });
        const key = pair.slice(0, at).trim() as BriefKey;
        if (!(BRIEF_KEYS as readonly string[]).includes(key)) {
          throw new MfmError('USAGE', { key, keys: BRIEF_KEYS }, { message: `"${key}" is not a brief field.`, hint: `Use one of: ${BRIEF_KEYS.join(', ')}.` });
        }
        draft[key] = checkField(key, parseValue(key, pair.slice(at + 1)));
      }
      const missing = missingFields(draft);
      if (sets.length > 0 && missing.length === 0) draft.answeredAt = new Date().toISOString();
      const complete = completeBrief(draft);
      const brief = complete ?? draft;
      mkdirSync(path.dirname(briefFile(project)), { recursive: true });
      writeFileSync(briefFile(project), `${JSON.stringify(brief, null, 2)}\n`);
      const md = renderBriefMd(brief as DraftBrief, missing);
      writeFileSync(briefMdFile(project), md);
      return { brief, missing, md: briefMdFile(project) };
    },
    { command: 'film brief', ...(options.onWarn ? { onStale: options.onWarn } : {}) },
  );
}

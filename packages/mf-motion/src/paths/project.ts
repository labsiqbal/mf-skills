// Projects: ids, project.json, discovery from the current folder, and the
// phase a project is in, derived from its event log.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import type { ProjectEvent } from './events';
import { APPROVAL_SUBJECTS, type ApprovalSubject, PLAN_FILES, planHash } from './plan';

export const PROJECT_SCHEMA_VERSION = 1;
export const ID_MAX = 48;
const ID_SUFFIX = 4;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const ASPECTS = ['16:9', '9:16', '1:1'] as const;
export type Aspect = (typeof ASPECTS)[number];
export const PROJECT_TYPES = ['film', 'moves'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export const DEFAULT_FPS = '30';

/** Engine pins a new project records (masterplan tech stack: HyperFrames, GSAP, three). */
export const PROJECT_ENGINE = { hyperframes: '0.9.61', gsap: '3.15.0', three: '0.187.0' } as const;

export interface ProjectDoc {
  schemaVersion: number;
  kind: 'project';
  id: string;
  title: string;
  type: ProjectType;
  aspect: Aspect;
  width: number;
  height: number;
  fps: string;
  brand: string | null;
  theme: string | null;
  language: string;
  engine: { hyperframes: string; gsap: string; three: string };
  cli: string;
  createdAt: string;
}

export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Kebab-case slug of a title; "project" when nothing usable remains. */
export function slugify(title: string, max = ID_MAX - ID_SUFFIX - 1): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug === '' ? 'project' : slug;
}

/** `<slug>-<4 base32 chars>` from a hash of the title and the creation time (with a nanosecond salt). */
export function projectId(title: string, createdAt: string, salt: string = process.hrtime.bigint().toString()): string {
  const digest = createHash('sha256').update(`${title}\n${createdAt}\n${salt}`).digest();
  let bits = 0;
  let value = 0;
  let suffix = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && suffix.length < ID_SUFFIX) {
      suffix += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (suffix.length === ID_SUFFIX) break;
  }
  return `${slugify(title)}-${suffix}`;
}

export function projectFile(root: string): string {
  return path.join(root, 'project.json');
}

function cliMajor(version: string): number {
  return Number(version.split('.')[0] ?? '0');
}

/** Minimal shape guard for project.json until the schema registry provides `project`. */
function projectProblems(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['not an object'];
  const doc = value as Record<string, unknown>;
  const problems: string[] = [];
  if (doc.kind !== 'project') problems.push('kind must be "project"');
  if (!Number.isInteger(doc.schemaVersion)) problems.push('schemaVersion must be an integer');
  if (typeof doc.id !== 'string' || !ID_PATTERN.test(doc.id)) problems.push('id must be kebab-case');
  if (!(PROJECT_TYPES as readonly unknown[]).includes(doc.type)) problems.push('type must be film or moves');
  if (typeof doc.cli !== 'string') problems.push('cli must be a version string');
  return problems;
}

/** Read and check project.json; refuses projects from a newer schema or CLI major. */
export function readProject(root: string, cliVersion: string): ProjectDoc {
  const file = projectFile(root);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MfmError('PROJECT_NOT_FOUND', { root });
    throw new MfmError('SCHEMA_INVALID', { file }, { message: `${file} is not valid JSON.` });
  }
  const problems = projectProblems(value);
  if (problems.length > 0) throw new MfmError('SCHEMA_INVALID', { file, problems }, { message: `${file} is not a valid project.` });
  const doc = value as ProjectDoc;
  if (doc.schemaVersion > PROJECT_SCHEMA_VERSION) throw new MfmError('SCHEMA_TOO_NEW', { file, schemaVersion: doc.schemaVersion });
  if (cliMajor(doc.cli) > cliMajor(cliVersion)) {
    throw new MfmError('PROJECT_TOO_NEW', { file, createdBy: doc.cli, cli: cliVersion }, {
      message: `This project was created by mf-motion ${doc.cli}, a newer major version than ${cliVersion}.`,
    });
  }
  return doc;
}

/** The project root: `--project`, else the nearest folder with project.json walking up from cwd. */
export function findProjectRoot(cwd: string, flag?: string): string {
  if (flag !== undefined && flag !== '') {
    const root = path.resolve(cwd, flag);
    if (!existsSync(projectFile(root))) {
      throw new MfmError('PROJECT_NOT_FOUND', { project: root }, { message: `No project.json in ${root}.` });
    }
    return root;
  }
  let current = path.resolve(cwd);
  for (;;) {
    if (existsSync(projectFile(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new MfmError('PROJECT_NOT_FOUND', { cwd }, { message: `No project.json in ${cwd} or any folder above it.` });
    }
    current = parent;
  }
}

export type Phase =
  | 'created'
  | 'awaiting-approval'
  | 'approved'
  | 'built'
  | 'rendering'
  | 'rendered'
  | 'gated'
  | 'delivered';

/** Commands an approval of each subject unlocks; a stale approval locks them again. */
export const APPROVAL_GATES: Record<ApprovalSubject, readonly string[]> = {
  beatgrid: ['score', 'film build'],
  placement: ['moves render'],
  theme: ['film build'],
  'extra-round': ['film round'],
  'library-add': [],
};

/** The command that shows a subject's plan again for approval. */
const RECHECK: Partial<Record<ApprovalSubject, string>> = { beatgrid: 'beatgrid check', placement: 'placement check', theme: 'film themes' };

/**
 * Approved subjects whose plan file no longer has the hash the latest
 * approval.recorded holds (edited or removed since). Subjects without a single
 * plan file are never stale here.
 */
export function staleApprovals(root: string, events: ProjectEvent[]): ApprovalSubject[] {
  const stale: ApprovalSubject[] = [];
  for (const subject of APPROVAL_SUBJECTS) {
    const relative = PLAN_FILES[subject];
    if (relative === null) continue;
    let approved: string | null = null;
    for (let i = events.length - 1; i >= 0 && approved === null; i -= 1) {
      const event = events[i];
      if (event?.type === 'approval.recorded' && event.data.subject === subject) approved = String(event.data.planHash ?? '');
    }
    if (approved === null) continue;
    const file = path.join(root, relative);
    if (!existsSync(file) || planHash(file) !== approved) stale.push(subject);
  }
  return stale;
}

/**
 * Phase from the last phase-bearing event; notes, consents and housekeeping do
 * not move it. With the project root, an approval whose plan file changed since
 * (staleApprovals) returns an `approved` project to `awaiting-approval`.
 */
export function projectPhase(events: ProjectEvent[], root?: string): Phase {
  const phase = eventPhase(events);
  if (root !== undefined && phase === 'approved' && staleApprovals(root, events).length > 0) return 'awaiting-approval';
  return phase;
}

function eventPhase(events: ProjectEvent[]): Phase {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    switch (events[i]?.type) {
      case 'delivered':
        return 'delivered';
      case 'gate.verdict':
        return 'gated';
      case 'render.finished':
      case 'measure.done':
        return 'rendered';
      case 'render.started':
        return 'rendering';
      case 'build.done':
        return 'built';
      case 'approval.recorded':
        return 'approved';
      case 'plan.shown':
        return 'awaiting-approval';
      case 'project.created':
        return 'created';
      default:
        break;
    }
  }
  return 'created';
}

/**
 * Commands that fit the phase, as command names (flags vary by project). Stale
 * approvals drop the commands they gated and offer the re-check and `approve`.
 */
export function nextAllowed(type: ProjectType, phase: Phase, stale: readonly ApprovalSubject[] = []): string[] {
  const base = phaseCommands(type, phase);
  if (stale.length === 0) return base;
  const gated = new Set(stale.flatMap((subject) => APPROVAL_GATES[subject]));
  const recheck = stale.map((subject) => RECHECK[subject]).filter((command): command is string => command !== undefined);
  const out = base.filter((command) => !gated.has(command));
  for (const command of ['approve', ...recheck]) if (!out.includes(command)) out.unshift(command);
  return out;
}

function phaseCommands(type: ProjectType, phase: Phase): string[] {
  const film: Record<Phase, string[]> = {
    created: ['film brief', 'brand use', 'brand capture', 'film themes', 'ref fetch', 'plan check', 'beatgrid check', 'note', 'status'],
    'awaiting-approval': ['approve', 'beatgrid check', 'film themes', 'note', 'status'],
    approved: ['score', 'film build', 'note', 'status'],
    built: ['film round', 'note', 'status'],
    rendering: ['status'],
    rendered: ['packet', 'gate', 'note', 'status'],
    gated: ['film round', 'deliver', 'approve', 'note', 'status'],
    delivered: ['deliver', 'clean', 'note', 'status'],
  };
  const moves: Record<Phase, string[]> = {
    created: ['transcribe', 'brand use', 'brand capture', 'catalog', 'placement check', 'note', 'status'],
    'awaiting-approval': ['approve', 'placement check', 'note', 'status'],
    approved: ['moves render', 'note', 'status'],
    built: ['moves render', 'note', 'status'],
    rendering: ['status'],
    rendered: ['gate', 'export', 'preview', 'note', 'status'],
    gated: ['moves render', 'export', 'preview', 'deliver', 'note', 'status'],
    delivered: ['deliver', 'export', 'clean', 'note', 'status'],
  };
  return (type === 'film' ? film : moves)[phase];
}

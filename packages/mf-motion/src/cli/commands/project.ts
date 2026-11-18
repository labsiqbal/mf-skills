// Projects and approvals: new, approve, note, status.
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  APPROVAL_SUBJECTS,
  ASPECT_SIZE,
  ASPECTS,
  type ApprovalSubject,
  DEFAULT_FPS,
  PLAN_FILES,
  PROJECT_ENGINE,
  PROJECT_SCHEMA_VERSION,
  PROJECT_TYPES,
  type ProjectDoc,
  appendEvent,
  confine,
  dataHome,
  findProjectRoot,
  homeLayout,
  lastShown,
  lockFile,
  nextAllowed,
  planHash,
  projectFile,
  projectId,
  projectPhase,
  readEvents,
  readProject,
  shellArg,
  staleApprovals,
  withLock,
  writeJsonAtomic,
} from '../../paths/index';
import { MfmError } from '../errors';
import { type CommandContext, type FlagMap, defineCommand } from '../registry';

const EVENT_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'at', 'seq', 'type', 'actor', 'durationMs', 'round', 'data'],
  properties: {
    schemaVersion: { type: 'integer' },
    at: { type: 'string', format: 'date-time' },
    seq: { type: 'integer', minimum: 1 },
    type: { type: 'string' },
    actor: { enum: ['cli', 'agent', 'user'] },
    durationMs: { type: ['number', 'null'] },
    round: { type: ['integer', 'null'] },
    data: { type: 'object' },
  },
} as const;

function lockOptions<F extends FlagMap>(context: CommandContext<F>, command: string) {
  return { command, onStale: (message: string) => context.log.warn(message) };
}

function projectFlag(root: string): string {
  return `--project ${shellArg(root)}`;
}

function validLanguage(language: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(language);
    if (canonical) return canonical;
  } catch {
    // Reported below.
  }
  throw new MfmError('USAGE', { flag: '--language', value: language }, {
    message: `--language needs a BCP 47 tag such as en or pt-BR, got "${language}".`,
    hint: 'Pass a language tag such as en, de, ja or pt-BR.',
  });
}

export const newCommand = defineCommand({
  name: 'new',
  summary: 'Create a film or moves project.',
  positionals: [{ name: 'title', description: 'project title (quote it when it has spaces)', required: true }],
  flags: {
    type: { type: 'string', enum: PROJECT_TYPES, required: true, description: 'film: a 10-30 s branded film; moves: overlays for a talking-head video' },
    aspect: { type: 'string', enum: ASPECTS, default: '16:9', description: 'aspect ratio' },
    brand: { type: 'string', value: '<id>', description: 'brand id from the brand library' },
    dir: { type: 'string', value: '<path>', description: 'project folder; default: <data home>/projects/<project id>' },
    footage: { type: 'string', value: '<file>', description: 'talking-head footage for a moves project (copied in by transcribe)' },
    language: { type: 'string', value: '<bcp47>', default: 'en', description: 'language of the on-screen copy' },
  },
  dataSchema: {
    type: 'object',
    required: ['project', 'next'],
    properties: {
      project: { type: 'object', required: ['id', 'root'], properties: { id: { type: 'string' }, root: { type: 'string' } } },
      next: { type: 'array', items: { type: 'string' } },
    },
  },
  async handler(context) {
    const { flags, args, cwd, env, global, cli } = context;
    const title = String(args.title ?? '').trim();
    if (title === '') throw new MfmError('USAGE', { argument: 'title' }, { message: 'The project title is empty.' });
    const language = validLanguage(flags.language);
    const home = homeLayout(dataHome({ flag: global.home, env, cwd }));
    let footage: string | null = null;
    if (flags.footage !== undefined) {
      if (flags.type !== 'moves') {
        throw new MfmError('USAGE', { flag: '--footage' }, { message: '--footage is for moves projects.', hint: 'Use --type moves with --footage.' });
      }
      footage = path.resolve(cwd, flags.footage);
      if (!existsSync(footage) || !statSync(footage).isFile()) {
        throw new MfmError('USAGE', { flag: '--footage', value: flags.footage }, { message: `Footage file not found: ${footage}.` });
      }
    }
    let brand: string | null = null;
    if (flags.brand !== undefined) {
      if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(flags.brand)) {
        throw new MfmError('BRAND_NOT_FOUND', { brand: flags.brand }, { message: `"${flags.brand}" is not a brand id.` });
      }
      const brandDir = confine(home.brands, flags.brand);
      if (!existsSync(path.join(brandDir, 'brand.json'))) {
        throw new MfmError('BRAND_NOT_FOUND', { brand: flags.brand }, {
          message: `No brand "${flags.brand}" in ${home.brands}.`,
          next: ['mf-motion brand list --json'],
        });
      }
      brand = flags.brand;
    }
    const createdAt = new Date().toISOString();
    let id = projectId(title, createdAt);
    let root = flags.dir !== undefined ? path.resolve(cwd, flags.dir) : path.join(home.projects, id);
    if (flags.dir === undefined) {
      for (let tries = 0; existsSync(root) && tries < 8; tries += 1) {
        id = projectId(title, createdAt, `${tries}:${process.hrtime.bigint()}`);
        root = path.join(home.projects, id);
      }
    }
    if (existsSync(projectFile(root))) {
      throw new MfmError('PROJECT_EXISTS', { root }, { message: `${root} already holds a project.`, next: [`mf-motion status ${projectFlag(root)} --json`] });
    }
    mkdirSync(root, { recursive: true });
    const size = ASPECT_SIZE[flags.aspect];
    const doc: ProjectDoc = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      kind: 'project',
      id,
      title,
      type: flags.type,
      aspect: flags.aspect,
      width: size.width,
      height: size.height,
      fps: DEFAULT_FPS,
      brand,
      theme: null,
      language,
      engine: { ...PROJECT_ENGINE },
      cli,
      createdAt,
    };
    await withLock(
      lockFile(root),
      () => {
        if (existsSync(projectFile(root))) throw new MfmError('PROJECT_EXISTS', { root });
        writeJsonAtomic(projectFile(root), doc);
        appendEvent(root, {
          type: 'project.created',
          actor: 'cli',
          data: { title, type: flags.type, ...(footage ? { footage } : {}) },
        });
      },
      lockOptions(context, 'new'),
    );
    const at = projectFlag(root);
    const next =
      flags.type === 'film'
        ? [`mf-motion film brief --check ${at} --json`]
        : [`mf-motion transcribe ${at}${footage ? ` --footage ${shellArg(footage)}` : ''} --json`];
    return { data: { project: { id, root }, next }, next };
  },
});

const SHOW_COMMAND: Record<ApprovalSubject, string> = {
  beatgrid: 'beatgrid check',
  placement: 'placement check',
  theme: 'film themes',
  'extra-round': 'gate',
  'library-add': 'library check <id>',
};

const AFTER_APPROVAL: Record<ApprovalSubject, string> = {
  beatgrid: 'score',
  placement: 'moves render',
  theme: 'plan check',
  'extra-round': 'film round',
  'library-add': 'library add --as <move|theme> --id <id> --from <dir>',
};

export const approveCommand = defineCommand({
  name: 'approve',
  summary: "Record the user's approval of the plan they were shown, in their own words.",
  flags: {
    subject: { type: 'string', enum: APPROVAL_SUBJECTS, required: true, description: 'what the user approved' },
    text: { type: 'string', required: true, value: '"<verbatim user words>"', description: "the user's words, verbatim" },
  },
  dataSchema: {
    type: 'object',
    required: ['event'],
    properties: {
      event: {
        type: 'object',
        required: ['seq', 'at', 'planHash'],
        properties: { seq: { type: 'integer' }, at: { type: 'string' }, planHash: { type: 'string' } },
      },
    },
  },
  async handler(context) {
    const { flags, cwd, global, cli } = context;
    if (flags.text.trim() === '') {
      throw new MfmError('USAGE', { flag: '--text' }, { message: '--text is empty.', hint: "Pass the user's words, verbatim." });
    }
    const root = findProjectRoot(cwd, global.project);
    readProject(root, cli);
    const subject = flags.subject;
    const at = projectFlag(root);
    const event = await withLock(
      lockFile(root),
      () => {
        const shown = lastShown(root, subject);
        if (!shown) {
          throw new MfmError('APPROVAL_MISSING', { subject }, {
            message: `No ${subject} plan has been shown to the user yet.`,
            next: [`mf-motion ${SHOW_COMMAND[subject]} ${at} --json`],
          });
        }
        const shownHash = String(shown.data.planHash ?? '');
        const relative = PLAN_FILES[subject];
        if (relative !== null) {
          const file = confine(root, relative);
          const currentHash = existsSync(file) ? planHash(file) : null;
          if (currentHash !== shownHash) {
            throw new MfmError('APPROVAL_STALE', { subject, file: relative, shownHash, currentHash, shownSeq: shown.seq }, {
              message: `${relative} changed after it was shown to the user (shown at event ${shown.seq}).`,
              next: [`mf-motion ${SHOW_COMMAND[subject]} ${at} --json`],
            });
          }
        }
        return appendEvent(root, { type: 'approval.recorded', actor: 'user', data: { subject, text: flags.text, planHash: shownHash } });
      },
      lockOptions(context, 'approve'),
    );
    const next = [`mf-motion ${AFTER_APPROVAL[subject]} ${at} --json`];
    return { data: { event: { seq: event.seq, at: event.at, planHash: String(event.data.planHash) } }, next };
  },
});

export const noteCommand = defineCommand({
  name: 'note',
  summary: 'Add an agent note to the project log.',
  flags: {
    text: { type: 'string', required: true, value: '"<text>"', description: 'the note' },
  },
  dataSchema: { type: 'object', required: ['event'], properties: { event: EVENT_SCHEMA } },
  async handler(context) {
    const { flags, cwd, global, cli } = context;
    if (flags.text.trim() === '') throw new MfmError('USAGE', { flag: '--text' }, { message: '--text is empty.' });
    const root = findProjectRoot(cwd, global.project);
    readProject(root, cli);
    const event = await withLock(
      lockFile(root),
      () => appendEvent(root, { type: 'note.added', actor: 'agent', data: { text: flags.text } }),
      lockOptions(context, 'note'),
    );
    return { data: { event } };
  },
});

export const statusCommand = defineCommand({
  name: 'status',
  summary: 'Show the project, its phase, the last event and the commands that fit next.',
  flags: {},
  dataSchema: {
    type: 'object',
    required: ['project', 'phase', 'last', 'nextAllowed'],
    properties: {
      project: { type: 'object' },
      phase: { enum: ['created', 'awaiting-approval', 'approved', 'built', 'rendering', 'rendered', 'gated', 'delivered'] },
      last: { anyOf: [EVENT_SCHEMA, { type: 'null' }] },
      nextAllowed: { type: 'array', items: { type: 'string' } },
    },
  },
  handler({ cwd, global, cli }) {
    const root = findProjectRoot(cwd, global.project);
    const project = readProject(root, cli);
    const events = readEvents(root);
    const stale = staleApprovals(root, events);
    const phase = projectPhase(events, root);
    return {
      data: { project, phase, last: events[events.length - 1] ?? null, nextAllowed: nextAllowed(project.type, phase, stale) },
    };
  },
});

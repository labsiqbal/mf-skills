import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { check, ensureEngine, enginePins } from '../../engine/index';
import { appendEvent, dataHome, findProjectRoot, lockFile, withLock } from '../../paths/index';
import { readDoc, writeDoc } from '../../schemas/index';
import { applyMigration, planMigrations } from '../../schemas/migrate/index';
import { MfmError } from '../errors';
import { type CommandContext, type FlagMap, defineCommand } from '../registry';

interface Change {
  path: string;
  from: number | string;
  to: number | string;
  backup: string;
}

function backupPath(file: string, tag: string): string {
  const base = `${file}.bak-${tag}`;
  if (!existsSync(base)) return base;
  for (let n = 2; ; n += 1) if (!existsSync(`${base}-${n}`)) return `${base}-${n}`;
}

/** Re-pin a project to this CLI's engine, install it, and check the current build when there is one. */
async function migrateEngine<F extends FlagMap>(context: CommandContext<F>, root: string, dryRun: boolean): Promise<Change[]> {
  const { log, env } = context;
  const file = path.join(root, 'project.json');
  const { doc } = readDoc('project', file);
  const pins = enginePins();
  if (doc.engine.hyperframes === pins.hyperframes && doc.engine.gsap === pins.gsap && doc.engine.three === pins.three) return [];
  const change: Change = { path: file, from: doc.engine.hyperframes, to: pins.hyperframes, backup: backupPath(file, `engine-${doc.engine.hyperframes}`) };
  if (dryRun) return [change];
  const lockOptions = { command: 'migrate --engine', onStale: (message: string) => log.warn(message) };
  await withLock(
    lockFile(root),
    () => {
      copyFileSync(file, change.backup);
      writeDoc('project', file, { ...doc, engine: { ...pins } });
      appendEvent(root, { type: 'migrate', actor: 'cli', data: { engine: { from: doc.engine, to: pins }, backup: change.backup } });
    },
    lockOptions,
  );
  const engine = await ensureEngine(pins.hyperframes, { env, onProgress: (message) => log.progress(message), onStale: (message) => log.warn(message) });
  const build = path.join(root, 'build');
  if (existsSync(path.join(build, 'index.html'))) {
    log.progress(`Checking ${build} with hyperframes ${engine.version}`);
    const result = await check(engine, build);
    if (result.errors > 0) {
      throw new MfmError('CHECK_FAILED', { errors: result.errors, findings: result.findings.slice(0, 20) }, {
        message: `The build has ${result.errors} engine check error(s) on hyperframes ${engine.version}.`,
      });
    }
  }
  return [change];
}

export const migrateCommand = defineCommand({
  name: 'migrate',
  summary: 'Upgrade older documents in the data home (and a project with --project), keeping <file>.bak-v<n> backups.',
  flags: {
    'dry-run': { type: 'boolean', description: 'list the changes without writing' },
    engine: { type: 'boolean', description: "re-pin the project (--project) to this CLI's engine version, install it and check the current build" },
  },
  dataSchema: {
    type: 'object',
    required: ['changed'],
    properties: {
      changed: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'from', 'to', 'backup'],
          properties: {
            path: { type: 'string' },
            from: { type: ['integer', 'string'], description: 'schema version, or engine version with --engine' },
            to: { type: ['integer', 'string'] },
            backup: { type: 'string' },
          },
        },
      },
    },
  },
  async handler(context) {
    const { flags, global, env, cwd, log } = context;
    const project = global.project !== undefined ? findProjectRoot(cwd, global.project) : null;
    if (flags.engine) {
      if (!project) {
        throw new MfmError('USAGE', { flag: '--project' }, { message: 'migrate --engine needs --project <dir>.', hint: 'Run `mf-motion migrate --engine --project <dir> --json`.' });
      }
      return { data: { changed: await migrateEngine(context, project, flags['dry-run']) } };
    }
    const home = dataHome({ flag: global.home, env, cwd });
    const items = planMigrations(home, project);
    if (!flags['dry-run']) {
      const lockOptions = { command: 'migrate', onStale: (message: string) => log.warn(message) };
      for (const item of items) {
        log.progress(`migrating ${item.path} (${item.kind} ${item.from} -> ${item.to})`);
        if (item.project) await withLock(lockFile(item.project), () => applyMigration(item), lockOptions);
        else applyMigration(item);
      }
      const touched = [...new Set(items.map((item) => item.project).filter((root): root is string => root !== null))];
      for (const root of touched) {
        await withLock(
          lockFile(root),
          () =>
            appendEvent(root, {
              type: 'migrate',
              actor: 'cli',
              data: { changed: items.filter((item) => item.project === root).map(({ path, kind, from, to, backup }) => ({ path, kind, from, to, backup })) },
            }),
          lockOptions,
        );
      }
    }
    return { data: { changed: items.map(({ path, from, to, backup }) => ({ path, from, to, backup })) } };
  },
});

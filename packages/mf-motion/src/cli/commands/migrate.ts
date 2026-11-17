import { appendEvent, dataHome, findProjectRoot, lockFile, withLock } from '../../paths/index';
import { applyMigration, planMigrations } from '../../schemas/migrate/index';
import { MfmError } from '../errors';
import { defineCommand } from '../registry';

export const migrateCommand = defineCommand({
  name: 'migrate',
  summary: 'Upgrade older documents in the data home (and a project with --project), keeping <file>.bak-v<n> backups.',
  flags: {
    'dry-run': { type: 'boolean', description: 'list the changes without writing' },
    engine: { type: 'boolean', description: "re-pin the project to this CLI's engine version, rebuild build/, lint and check" },
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
          properties: { path: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' }, backup: { type: 'string' } },
        },
      },
    },
  },
  async handler(context) {
    const { flags, global, env, cwd, log } = context;
    if (flags.engine) {
      throw new MfmError('ENGINE_MISSING', { flag: '--engine' }, {
        message: 'migrate --engine needs the engine adapter, which this build does not include.',
        hint: 'Run migrate without --engine; engine re-pinning arrives with the engine adapter.',
      });
    }
    const home = dataHome({ flag: global.home, env, cwd });
    const project = global.project !== undefined ? findProjectRoot(cwd, global.project) : null;
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

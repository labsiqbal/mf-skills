import { realpathSync } from 'node:fs';
import { checkPlacement, overlayExportFor } from '../../moves/placement';
import { renderPlaced } from '../../moves/renderPlaced';
import { confine, dataHome, findProjectRoot, lockFile, readProject, shellArg, withLock } from '../../paths/index';
import { MfmError } from '../errors';
import { defineCommand } from '../registry';

const movesProject = (root: string, cli: string) => {
  const project = readProject(root, cli);
  if (project.type !== 'moves') throw new MfmError('USAGE', { project: root }, { message: 'Placements require a moves project.' });
  return project;
};

export const placementCheckCommand = defineCommand({
  name: 'placement check',
  summary: 'Check placement rules and write the table to show the user for approval.',
  flags: {},
  dataSchema: {
    type: 'object', required: ['items', 'problems', 'planHash'],
    properties: {
      items: { type: 'array', items: { type: 'object' } },
      problems: { type: 'array', items: { type: 'object', required: ['id', 'code', 'message'] } },
      planHash: { type: 'string' },
    },
  },
  async handler({ cwd, env, global, cli, log }) {
    const root = realpathSync.native(findProjectRoot(cwd, global.project));
    const home = dataHome({ flag: global.home, env, cwd });
    const data = await withLock(confine(root, lockFile(root)), () => checkPlacement(root, movesProject(root, cli), overlayExportFor(home)), {
      command: 'placement check', onStale: (message) => log.warn(message),
    });
    if (data.problems.length > 0) return { data, exitCode: 1, next: ['Fix the placement problems and run placement check again.'] };
    return { data, next: [
      'Show plan/placement.md to the user.',
      `mf-motion approve --project ${shellArg(root)} --subject placement --text "<their words>" --json`,
    ] };
  },
});

export const movesRenderCommand = defineCommand({
  name: 'moves render',
  summary: 'Render and encode approved moves on the footage clock.',
  flags: {
    only: { type: 'list', value: '<p01,p02>', description: 'render only the named placement ids' },
    gate: { type: 'boolean', description: 'run the quality gate for each placed move' },
  },
  dataSchema: {
    type: 'object', required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', required: ['id', 'move', 'outputs', 'verdict'] } } },
  },
  async handler({ flags, cwd, env, global, cli, log }) {
    const root = realpathSync.native(findProjectRoot(cwd, global.project));
    const home = dataHome({ flag: global.home, env, cwd });
    const result = await withLock(confine(root, lockFile(root)), () => renderPlaced(root, movesProject(root, cli), {
      home, env, cli, only: flags.only ?? [], gate: flags.gate === true,
      onProgress: (message) => log.progress(message),
    }), { command: 'moves render', onStale: (message) => log.warn(message) });
    return { data: { items: result.items }, warnings: result.warnings, next: result.next, exitCode: result.exitCode };
  },
});

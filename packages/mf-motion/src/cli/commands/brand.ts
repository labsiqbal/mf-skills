// Brand commands. Each subcommand is one registry entry; later tickets add
// pick, manual, from-brief, fonts, show, list, use and rm here.
import path from 'node:path';
import { captureBrand } from '../../brand/index';
import { dataHome, findProjectRoot, lockFile, withLock } from '../../paths/index';
import { readDoc, writeDoc } from '../../schemas/index';
import { defineCommand } from '../registry';

export const brandCaptureCommand = defineCommand({
  name: 'brand capture',
  summary: "Capture a brand from a website (or a local HTML file) into the brand library as a draft.",
  positionals: [{ name: 'url', description: 'the brand site, http or https (omit with --local-file)' }],
  flags: {
    'local-file': { type: 'string', value: '<html>', description: 'capture a local HTML file instead of a URL' },
    'local-root': { type: 'string', value: '<dir>', description: 'folder the local page may read files from' },
    name: { type: 'string', value: '<id>', description: 'brand id for a local capture (or to override the domain)' },
    refresh: { type: 'boolean', description: 'capture again even when the brand is already in the library' },
    use: { type: 'boolean', description: 'also set the brand on the current project' },
  },
  network: true,
  dataSchema: {
    type: 'object',
    required: ['brand', 'candidatesSheet', 'logoSheet', 'roles', 'fonts', 'warnings'],
    properties: {
      brand: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string' }, status: { enum: ['draft', 'picked'] } } },
      candidatesSheet: { type: ['string', 'null'] },
      logoSheet: { type: ['string', 'null'] },
      roles: { type: ['object', 'null'] },
      fonts: { type: ['object', 'null'] },
      warnings: { type: 'array' },
    },
  },
  async handler({ args, flags, cwd, env, global, log }) {
    const home = dataHome({ flag: global.home, env, cwd });
    const result = await captureBrand({
      ...(typeof args.url === 'string' ? { url: args.url } : {}),
      ...(flags['local-file'] !== undefined ? { localFile: flags['local-file'] } : {}),
      ...(flags['local-root'] !== undefined ? { localRoot: flags['local-root'] } : {}),
      ...(flags.name !== undefined ? { name: flags.name } : {}),
      refresh: flags.refresh,
      home,
      cwd,
      onProgress: (message) => log.progress(message),
      onWarn: (message) => log.warn(message),
    });
    if (flags.use) {
      const root = findProjectRoot(cwd, global.project);
      await withLock(
        lockFile(root),
        () => {
          const file = path.join(root, 'project.json');
          const { doc } = readDoc('project', file);
          writeDoc('project', file, { ...doc, brand: result.brand.id });
        },
        { command: 'brand capture --use', onStale: (message) => log.warn(message) },
      );
    }
    const { id, status } = result.brand;
    return {
      data: { brand: { id, status }, candidatesSheet: result.candidatesSheet, logoSheet: result.logoSheet, roles: result.roles, fonts: result.fonts, warnings: result.warnings },
      warnings: result.warnings,
      next: [],
    };
  },
});

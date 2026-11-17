// Brand commands. Each subcommand is one registry entry; later tickets add
// pick, manual, from-brief, fonts, show, list, use and rm here.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { type FontRoles, captureBrand, substituteOfl } from '../../brand/index';
import { confine, dataHome, findProjectRoot, homeLayout, lockFile, withLock } from '../../paths/index';
import { readDoc, writeDoc } from '../../schemas/index';
import { MfmError } from '../errors';
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
      notice: { type: ['string', 'null'], description: 'the one-time rights notice to show the user' },
    },
  },
  async handler({ args, flags, cwd, env, global, log }) {
    const home = dataHome({ flag: global.home, env, cwd });
    let project: string | null = null;
    try {
      project = findProjectRoot(cwd, global.project);
    } catch {
      project = null;
    }
    const result = await captureBrand({
      project,
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
    if (result.notice) log.warn(result.notice);
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
      data: {
        brand: { id, status },
        candidatesSheet: result.candidatesSheet,
        logoSheet: result.logoSheet,
        roles: result.roles,
        fonts: result.fonts,
        warnings: result.warnings,
        notice: result.notice,
      },
      warnings: result.warnings,
      next: result.next,
    };
  },
});

export const brandFontsCommand = defineCommand({
  name: 'brand fonts',
  summary: 'Swap every brand font that may be licensed for websites only for the nearest bundled OFL family.',
  positionals: [{ name: 'id', description: 'brand id in the library', required: true }],
  flags: {
    'substitute-ofl': { type: 'boolean', description: 'replace fonts whose licence hint is unknown or commercial-webfont' },
  },
  dataSchema: {
    type: 'object',
    required: ['replaced'],
    properties: {
      replaced: {
        type: 'array',
        items: { type: 'object', required: ['role', 'from', 'to'], properties: { role: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } },
      },
    },
  },
  async handler({ args, flags, cwd, env, global, log }) {
    if (!flags['substitute-ofl']) {
      throw new MfmError('USAGE', { flag: '--substitute-ofl' }, { message: 'brand fonts needs --substitute-ofl.', hint: 'Run `mf-motion brand fonts <id> --substitute-ofl --json`.' });
    }
    const id = String(args.id);
    const home = dataHome({ flag: global.home, env, cwd });
    const dir = confine(homeLayout(home).brands, id);
    const file = path.join(dir, 'brand.json');
    if (!existsSync(file)) throw new MfmError('BRAND_NOT_FOUND', { brand: id }, { next: ['mf-motion brand list --json'] });
    return withLock(
      lockFile(dir),
      () => {
        const { doc } = readDoc('brand', file);
        const { roles, replaced } = substituteOfl(doc.type as FontRoles, dir);
        writeDoc('brand', file, { ...doc, type: roles, rights: { ...doc.rights, oflSubstituted: doc.rights.oflSubstituted || replaced.length > 0 } });
        return { data: { replaced } };
      },
      { command: 'brand fonts', onStale: (message) => log.warn(message) },
    );
  },
});

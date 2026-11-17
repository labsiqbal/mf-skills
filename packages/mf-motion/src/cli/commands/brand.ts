// Brand commands. Each subcommand is one registry entry; later tickets add
// show, list, use and rm here.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { type FontRoles, captureBrand, pickBrand, substituteOfl } from '../../brand/index';
import { confine, dataHome, findProjectRoot, homeLayout, lockFile, withLock } from '../../paths/index';
import { readDoc, writeDoc } from '../../schemas/index';
import { briefBrand } from '../../brand/fromBrief';
import { manualBrand } from '../../brand/manual';
import { MOOD_NAMES } from '../../brand/moods';
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

export const brandPickCommand = defineCommand({
  name: 'brand pick',
  summary: 'Pick the logo, optional mark and 3-6 shots from the candidate sheets; the brand becomes picked.',
  positionals: [{ name: 'id', description: 'brand id in the library', required: true }],
  flags: {
    logo: { type: 'string', required: true, value: '<l>', description: 'logo candidate number from the logo sheet, for example l2' },
    shots: { type: 'list', required: true, value: '<s1,s2,s3>', description: '3-6 shot candidate numbers from the candidates sheet' },
    mark: { type: 'string', value: '<l>', description: 'optional mark (symbol) candidate from the logo sheet' },
  },
  dataSchema: {
    type: 'object',
    required: ['brand'],
    properties: {
      brand: {
        type: 'object',
        required: ['id', 'status', 'logo', 'mark', 'shots'],
        properties: { id: { type: 'string' }, status: { const: 'picked' }, logo: { type: 'object' }, mark: { type: ['object', 'null'] }, shots: { type: 'array' } },
      },
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
    const result = await pickBrand({
      home,
      id: String(args.id),
      logo: flags.logo,
      shots: flags.shots,
      ...(flags.mark !== undefined ? { mark: flags.mark } : {}),
      project,
      onWarn: (message) => log.warn(message),
    });
    return { data: result };
  },
});

const libraryBrandSchema = {
  type: 'object',
  required: ['brand'],
  properties: {
    brand: {
      type: 'object',
      required: ['id', 'status', 'source', 'colors', 'type', 'logo', 'shots', 'dir'],
      properties: { id: { type: 'string' }, status: { enum: ['draft', 'picked'] }, source: { type: 'object' }, colors: { type: 'object' }, dir: { type: 'string' } },
    },
    notice: { type: ['string', 'null'], description: 'the one-time rights notice to show the user' },
  },
};

function openProject(cwd: string, flag: string | undefined): string | null {
  try {
    return findProjectRoot(cwd, flag);
  } catch {
    return null;
  }
}

export const brandManualCommand = defineCommand({
  name: 'brand manual',
  summary: 'Build a brand from files and colours the user provides; picked with 3-6 shots, else draft.',
  flags: {
    name: { type: 'string', required: true, value: '<id>', description: 'brand id, a kebab-case slug' },
    logo: { type: 'string', required: true, value: '<file>', description: 'logo file (SVG or PNG)' },
    colors: { type: 'list', required: true, value: '<hex,...>', description: '2-5 brand colours; the lightest or darkest becomes ground' },
    fonts: { type: 'list', value: '<file,...>', description: 'brand font files (TTF, OTF, WOFF, WOFF2); marked user-asserted' },
    family: { type: 'string', value: '<bundled-id>', description: 'a bundled font family instead of font files (default inter)' },
    shots: { type: 'list', value: '<file,...>', description: '3-6 screenshots or product images; without them the brand is a draft' },
    tagline: { type: 'string', value: '<text>', description: 'the brand tagline' },
  },
  dataSchema: libraryBrandSchema,
  async handler({ flags, cwd, env, global, log }) {
    const home = dataHome({ flag: global.home, env, cwd });
    const resolve = (file: string) => path.resolve(cwd, file);
    const result = await manualBrand({
      home,
      id: flags.name,
      logo: resolve(flags.logo),
      colors: flags.colors,
      ...(flags.fonts !== undefined ? { fonts: flags.fonts.map(resolve) } : {}),
      ...(flags.family !== undefined ? { family: flags.family } : {}),
      ...(flags.shots !== undefined ? { shots: flags.shots.map(resolve) } : {}),
      ...(flags.tagline !== undefined ? { tagline: flags.tagline } : {}),
      project: openProject(cwd, global.project),
      onWarn: (message) => log.warn(message),
    });
    if (result.notice) log.warn(result.notice);
    return { data: { brand: result.brand, notice: result.notice } };
  },
});

export const brandFromBriefCommand = defineCommand({
  name: 'brand from-brief',
  summary: 'Generate a draft brand from 1-3 mood words: palette, bundled fonts and a wordmark logo.',
  flags: {
    name: { type: 'string', required: true, value: '<id>', description: 'brand id, a kebab-case slug; also the wordmark text' },
    mood: { type: 'list', required: true, value: '<word,word,word>', description: `1-3 of: ${MOOD_NAMES.join(', ')}` },
    accent: { type: 'string', value: '<hex>', description: 'use this accent colour instead of the mood accent' },
    seed: { type: 'integer', value: '<n>', description: 'choose another accent variant (default 0)' },
  },
  dataSchema: {
    ...libraryBrandSchema,
    properties: {
      ...libraryBrandSchema.properties,
      moods: { type: 'array', items: { type: 'string' } },
      pairs: { type: 'array', description: 'text colour pairs and their contrast ratios' },
    },
  },
  async handler({ flags, cwd, env, global, log }) {
    const home = dataHome({ flag: global.home, env, cwd });
    const result = await briefBrand({
      home,
      id: flags.name,
      moods: flags.mood,
      ...(flags.accent !== undefined ? { accent: flags.accent } : {}),
      ...(flags.seed !== undefined ? { seed: flags.seed } : {}),
      project: openProject(cwd, global.project),
      onWarn: (message) => log.warn(message),
    });
    if (result.notice) log.warn(result.notice);
    return { data: { brand: result.brand, moods: result.moods, pairs: result.pairs, notice: result.notice } };
  },
});

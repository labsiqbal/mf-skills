// npm run fixtures:screens [-- --only <id>]
//
// Builds the derived assets of each demo-brand fixture site under
// test/fixtures/brands/<id>/ (those with a fixture.json):
//   1. site/assets/fonts/<file>.woff2 from the bundled OFL families named in
//      fixture.json "fonts" (WOFF2 with null transforms, brotli-compressed),
//      plus OFL.txt;
//   2. site/assets/screens/<name>-desktop.png (1440x900) and <name>-phone.png
//      (390x844) from each screens-src/<name>.html, rendered by mf-motion's own
//      Chrome page driver with the pinned engine.
// The outputs are committed; run this after editing screens-src/ or fonts.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'test', 'fixtures', 'brands');

export const SIZES = [
  { suffix: 'desktop', width: 1440, height: 900 },
  { suffix: 'phone', width: 390, height: 844 },
];
const SCREEN_MAX_BYTES = 300 * 1024;

// WOFF2 known-table index (WOFF2 specification, table directory flags).
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

function base128(value) {
  const bytes = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

/** A TrueType file as WOFF2 with every table stored untransformed (glyf and loca use transform version 3). */
export function woff2(ttf) {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const flavor = view.getUint32(0);
  const count = view.getUint16(4);
  let tables = [];
  for (let i = 0; i < count; i += 1) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...ttf.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    tables.push({ tag, data: ttf.subarray(offset, offset + length) });
  }
  // loca must follow glyf in a WOFF2 directory.
  const loca = tables.find((table) => table.tag === 'loca');
  if (loca) {
    tables = tables.filter((table) => table !== loca);
    tables.splice(tables.findIndex((table) => table.tag === 'glyf') + 1, 0, loca);
  }
  const directory = [];
  for (const table of tables) {
    const known = KNOWN_TAGS.indexOf(table.tag);
    const version = table.tag === 'glyf' || table.tag === 'loca' ? 3 : 0;
    directory.push(((version << 6) | (known >= 0 ? known : 0x3f)) & 0xff);
    if (known < 0) directory.push(...Buffer.from(table.tag, 'latin1'));
    directory.push(...base128(table.data.length));
  }
  const stream = Buffer.concat(tables.map((table) => table.data));
  const compressed = brotliCompressSync(stream, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT, [constants.BROTLI_PARAM_SIZE_HINT]: stream.length },
  });
  const sfntSize = 12 + 16 * count + tables.reduce((sum, table) => sum + Math.ceil(table.data.length / 4) * 4, 0);
  const headerSize = 48;
  const unpadded = headerSize + directory.length + compressed.length;
  const total = Math.ceil(unpadded / 4) * 4;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(0x774f4632, 0);
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(total, 8);
  out.writeUInt16BE(count, 12);
  out.writeUInt16BE(0, 14);
  out.writeUInt32BE(sfntSize, 16);
  out.writeUInt32BE(compressed.length, 20);
  out.writeUInt16BE(1, 24);
  out.writeUInt16BE(0, 26);
  Buffer.from(directory).copy(out, headerSize);
  compressed.copy(out, headerSize + directory.length);
  return out;
}

/** Bundle the mf-motion modules the scripts use (written under the git-ignored .cache/, inside the package). */
export async function loadLib() {
  const outfile = path.join(root, '.cache', 'fixtures', 'lib.mjs');
  await build({
    absWorkingDir: root,
    stdin: {
      contents: [
        "export { evaluate, withPage, screenshot } from './src/media/chrome';",
        "export { testBrowser, testCacheRoot } from './test/helpers/engine';",
        "export { bundledFontsDir, FAMILY_SPECS } from './src/fonts/index';",
        "export { readDoc, writeDoc } from './src/schemas/index';",
        "export { referencedFiles } from './src/brand/library';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'warning',
    banner: { js: "import { createRequire as __mfmCreateRequire } from 'node:module';\nconst require = __mfmCreateRequire(import.meta.url);" },
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

export function fixtureIds(only) {
  return readdirSync(fixtures)
    .filter((id) => existsSync(path.join(fixtures, id, 'fixture.json')))
    .filter((id) => !only || id === only)
    .sort();
}

async function main() {
  const { values } = parseArgs({ options: { only: { type: 'string' } } });
  const ids = fixtureIds(values.only);
  if (ids.length === 0) throw new Error(values.only ? `No demo-brand fixture named ${values.only}.` : 'No demo-brand fixtures found.');
  const lib = await loadLib();
  const { engine, browserPath } = await lib.testBrowser();
  for (const id of ids) {
    const dir = path.join(fixtures, id);
    const fixture = JSON.parse(readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
    const fontsOut = path.join(dir, 'site', 'assets', 'fonts');
    mkdirSync(fontsOut, { recursive: true });
    for (const [family, file] of Object.entries(fixture.fonts)) {
      const spec = lib.FAMILY_SPECS.find((entry) => entry.id === family && entry.source === 'bundled');
      if (!spec) throw new Error(`${id}: ${family} is not a bundled family.`);
      const ttf = readFileSync(path.join(lib.bundledFontsDir(), family, spec.files[0]));
      writeFileSync(path.join(fontsOut, file), woff2(new Uint8Array(ttf)));
      console.log(`${id}: fonts/${file}`);
    }
    copyFileSync(path.join(lib.bundledFontsDir(), 'OFL.txt'), path.join(fontsOut, 'OFL.txt'));

    const screensOut = path.join(dir, 'site', 'assets', 'screens');
    mkdirSync(screensOut, { recursive: true });
    const sources = readdirSync(path.join(dir, 'screens-src')).filter((name) => name.endsWith('.html')).sort();
    for (const source of sources) {
      for (const size of SIZES) {
        const png = await lib.withPage(
          { dir, entry: `screens-src/${source}`, width: size.width, height: size.height, composition: false, engine, browserPath },
          async (page, session) => {
            await lib.evaluate(page, () => document.fonts.ready.then(() => true), null);
            if (session.errors.length > 0 || session.aborted.length > 0) {
              throw new Error(`${id}/${source}: ${JSON.stringify({ errors: session.errors, aborted: session.aborted })}`);
            }
            return lib.screenshot(page);
          },
        );
        const out = path.join(screensOut, `${source.replace(/\.html$/, '')}-${size.suffix}.png`);
        writeFileSync(out, png);
        const bytes = statSync(out).size;
        console.log(`${id}: screens/${path.basename(out)} ${bytes} bytes`);
        if (bytes >= SCREEN_MAX_BYTES) throw new Error(`${path.basename(out)} is ${bytes} bytes; screens must stay under ${SCREEN_MAX_BYTES}.`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

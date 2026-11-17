// npm run fixtures:brands [-- --only <id>] [--out <dir>]
//
// Captures each demo-brand fixture site (test/fixtures/brands/<id>/site/) in
// local-file mode with the built CLI (dist/cli.mjs; run `npm run build` first),
// picks the candidates named in fixture.json "pick", and writes the picked
// brand to assets/demo-brands/<id>/ (or <out>/<id>/): brand.json, brand.md and
// every file brand.json references. Times and capture-only fields are
// normalised so a re-capture produces no diff.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fixtureIds, loadLib } from './fixtures-screens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.mjs');

function mfm(env, cwd, args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env, encoding: 'utf8', timeout: 600_000 });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`mf-motion ${args.join(' ')} printed no JSON (exit ${result.status}): ${result.stderr}`);
  }
  if (result.status !== 0) throw new Error(`mf-motion ${args.join(' ')} failed (exit ${result.status}): ${JSON.stringify(json.error)}`);
  return json.data;
}

/** The picked brand as shipped: no capture times, no candidate lists, no notice time. */
export function normalise(doc) {
  return {
    ...doc,
    source: { ...doc.source, capturedAt: null },
    candidates: { sheet: null, logoSheet: null, logos: [], shots: [] },
    rights: { ...doc.rights, noticeShownAt: null },
  };
}

/** Capture, pick and write one demo brand to <outRoot>/<id>/. */
export async function captureDemo(lib, id, outRoot) {
  if (!existsSync(cli)) throw new Error(`${cli} is missing; run \`npm run build\` first.`);
  const fixture = path.join(root, 'test', 'fixtures', 'brands', id);
  const { pick } = JSON.parse(readFileSync(path.join(fixture, 'fixture.json'), 'utf8'));
  const site = path.join(fixture, 'site');
  const home = mkdtempSync(path.join(tmpdir(), `mfm-demo-${id}-`));
  try {
    const env = { ...process.env, MF_MOTION_HOME: home, MF_MOTION_CACHE: lib.testCacheRoot(), NO_COLOR: '1' };
    mfm(env, site, ['brand', 'capture', '--local-file', path.join(site, 'index.html'), '--local-root', site, '--name', id]);
    mfm(env, site, ['brand', 'pick', id, '--logo', pick.logo, '--shots', pick.shots.join(','), ...(pick.mark ? ['--mark', pick.mark] : [])]);
    const dir = path.join(home, 'brands', id);
    const { doc } = lib.readDoc('brand', path.join(dir, 'brand.json'));
    const out = path.join(outRoot, id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const rel of lib.referencedFiles(doc)) {
      mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      copyFileSync(path.join(dir, rel), path.join(out, rel));
    }
    lib.writeDoc('brand', path.join(out, 'brand.json'), normalise(doc));
    const md = readFileSync(path.join(dir, 'brand.md'), 'utf8')
      .replace(/, captured \d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '')
      .replace(/- Status: draft \(pick a logo and shots before films use it\)/, '- Status: picked');
    writeFileSync(path.join(out, 'brand.md'), md);
    return out;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { only: { type: 'string' }, out: { type: 'string' } } });
  const ids = fixtureIds(values.only);
  if (ids.length === 0) throw new Error(values.only ? `No demo-brand fixture named ${values.only}.` : 'No demo-brand fixtures found.');
  const lib = await loadLib();
  await lib.testBrowser();
  const outRoot = path.resolve(values.out ?? path.join(root, 'assets', 'demo-brands'));
  for (const id of ids) console.log(`${id}: ${await captureDemo(lib, id, outRoot)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

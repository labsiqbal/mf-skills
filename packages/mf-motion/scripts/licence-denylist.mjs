// Usage: node scripts/licence-denylist.mjs [--lock <package-lock.json>]... [--src <dir>]...
// Fails when a lockfile or source file names a package or model rejected for
// its licence. Defaults: package-lock.json, engine/package-lock.json (when
// present) and src/ of this package.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Rejected for licence: never used, never suggested to users. */
export const DENIED_PACKAGES = [
  'essentia.js',
  'aubio',
  'aubiojs',
  'madmom',
  '@imgly/background-removal',
  'rembg',
  'node-web-audio-api',
];

/** Rejected models and model repositories, matched case-insensitively as text. */
export const DENIED_TOKENS = ['RMBG-1.4', 'RMBG-2.0', 'briaai/RMBG', 'ISNet-ONNX', 'musicgen-small'];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// Packages must not be part of a longer package name; model tokens may carry a suffix.
const patterns = [
  ...DENIED_PACKAGES.map((name) => ({ name, tail: '(?![\\w.-])' })),
  ...DENIED_TOKENS.map((name) => ({ name, tail: '(?!\\w)' })),
].map(({ name, tail }) => ({ name, regex: new RegExp(`(?<![\\w@.-])${escape(name)}${tail}`, 'i') }));

/** Denied names found in one text. */
export function deniedIn(text) {
  return patterns.filter(({ regex }) => regex.test(text)).map(({ name }) => name);
}

/** Denied package names among the packages a lockfile installs. */
export function deniedInLock(lock) {
  const hits = new Set();
  const names = new Set();
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    const at = key.lastIndexOf('node_modules/');
    if (at >= 0) names.add(key.slice(at + 'node_modules/'.length));
    if (meta && typeof meta.name === 'string') names.add(meta.name);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dep of Object.keys(meta?.[field] ?? {})) names.add(dep);
    }
  }
  for (const name of Object.keys(lock.dependencies ?? {})) names.add(name);
  const denied = new Set(DENIED_PACKAGES.map((name) => name.toLowerCase()));
  for (const name of names) if (denied.has(name.toLowerCase())) hits.add(name);
  for (const name of deniedIn(JSON.stringify(lock))) hits.add(name);
  return [...hits];
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { values } = parseArgs({
    options: { lock: { type: 'string', multiple: true }, src: { type: 'string', multiple: true } },
  });
  const locks = values.lock ?? [
    join(root, 'package-lock.json'),
    ...[join(root, 'engine', 'package-lock.json')].filter((path) => existsSync(path)),
  ];
  const sources = values.src ?? [join(root, 'src')];
  const findings = [];
  for (const lockPath of locks) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const name of deniedInLock(lock)) findings.push(`${relative(process.cwd(), lockPath)}: ${name}`);
  }
  let scanned = 0;
  for (const dir of sources) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      scanned += 1;
      for (const name of deniedIn(readFileSync(file, 'utf8'))) {
        findings.push(`${relative(process.cwd(), file)}: ${name}`);
      }
    }
  }
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`licence-denylist: denied ${finding}\n`);
    process.exit(1);
  }
  process.stdout.write(`licence-denylist: PASS ${locks.length} lockfile(s), ${scanned} source file(s)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

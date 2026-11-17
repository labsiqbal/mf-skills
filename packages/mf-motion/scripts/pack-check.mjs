// Usage: node scripts/pack-check.mjs [--dir <package dir>]
// Runs `npm pack --dry-run --json` and fails when the package would ship
// lab/, test/ or evidence files, any GSAP file, or weigh 15 MB or more packed,
// or when the bundled fonts' licence assets/fonts/OFL.txt is missing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const MAX_PACKED_BYTES = 15 * 1024 * 1024;

/** Locate npm's JavaScript entry so it can run through `node` on every OS (no shell). */
export function npmCli() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('npm not found next to this Node.js; run through `npm run pack:check`');
  return found;
}

/** Problems for one `npm pack --json` entry; an empty list means it passes. */
export function packProblems(entry) {
  const problems = [];
  for (const file of entry.files ?? []) {
    const parts = file.path.split('/');
    if (parts[0] === 'lab') problems.push(`lab file packed: ${file.path}`);
    if (parts[0] === 'test') problems.push(`test file packed: ${file.path}`);
    if (parts.includes('evidence')) problems.push(`evidence file packed: ${file.path}`);
    if (/gsap/i.test(file.path)) problems.push(`GSAP file packed: ${file.path}`);
  }
  if (!(entry.files ?? []).some((file) => file.path === 'assets/fonts/OFL.txt')) {
    problems.push('assets/fonts/OFL.txt (the licence of the bundled fonts) is not packed');
  }
  if (!(entry.size < MAX_PACKED_BYTES)) {
    problems.push(`packed size ${entry.size} bytes is not under ${MAX_PACKED_BYTES} bytes`);
  }
  return problems;
}

function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' } } });
  const root = resolve(values.dir ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const result = spawnSync(
    process.execPath,
    [npmCli(), 'pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(`pack-check: npm pack exited ${result.status}\n`);
    process.exit(1);
  }
  // npm 10 and 11 print an array of entries; npm 12 prints an object keyed by package name.
  const parsed = JSON.parse(result.stdout);
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
  if (entries.length !== 1) {
    process.stderr.write(`pack-check: expected one npm pack entry, got ${entries.length}\n`);
    process.exit(1);
  }
  const entry = entries[0];
  const problems = packProblems(entry);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`pack-check: ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `pack-check: PASS ${entry.name}@${entry.version}, ${entry.entryCount} files, ${entry.size} bytes packed\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

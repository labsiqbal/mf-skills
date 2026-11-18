// npm run gen:troubleshooting
//
// Writes skills/mf-motion/references/troubleshooting.md from src/cli/errors.ts:
// one row per error code with its exit code, meaning and fix. Run after any
// change to the error table; a test keeps the committed file equal to it.
import { buildSync } from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.resolve(root, '..', '..', 'skills', 'mf-motion', 'references', 'troubleshooting.md');

/** The error table, loaded from the TypeScript source through esbuild. */
export async function loadErrors() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-errors-'));
  try {
    const file = path.join(dir, 'errors.mjs');
    buildSync({ entryPoints: [path.join(root, 'src', 'cli', 'errors.ts')], bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'error' });
    const { ERROR_CODES, ERRORS } = await import(pathToFileURL(file).href);
    return ERROR_CODES.map((code) => ({ code, ...ERRORS[code] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function render(errors) {
  return [
    '# Troubleshooting',
    '',
    'Generated from `packages/mf-motion/src/cli/errors.ts` by `npm run gen:troubleshooting`; edit the error table there, not here.',
    '',
    'Every failure prints `error.code`, `error.message`, `error.hint` and `next`. Do what `hint` says and run the `next` commands; this table is the same text by code.',
    '',
    '| Code | Exit | Meaning | Fix |',
    '|---|---|---|---|',
    ...errors.map((entry) => `| \`${entry.code}\` | ${entry.exit ?? "warning"} | ${cell(entry.message)} | ${cell(entry.hint)} |`),
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render(await loadErrors()));
  console.log(path.relative(process.cwd(), OUT));
}

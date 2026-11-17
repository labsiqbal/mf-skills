// Build: node esbuild.config.mjs [--outdir <dir>]
// Bundles src/cli/main.ts into one ESM entry, dist/cli.mjs, with code splitting
// so lazily imported modules land in dist/chunks/, and the composition runtime
// src/kit/runtime/index.ts into dist/vendor/mf-runtime.js (IIFE, global `mf`).
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { outdir: { type: 'string' } } });
const outdir = resolve(root, values.outdir ?? 'dist');

await rm(outdir, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: { cli: 'src/cli/main.ts' },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outExtension: { '.js': '.mjs' },
  chunkNames: 'chunks/[name]-[hash]',
  sourcemap: false,
  legalComments: 'linked',
  logLevel: 'warning',
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __mfmCreateRequire } from 'node:module';",
      'const require = __mfmCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});

await build({
  absWorkingDir: root,
  entryPoints: ['src/kit/runtime/index.ts'],
  outfile: resolve(outdir, 'vendor', 'mf-runtime.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: '/* mf-motion composition runtime (MIT). Global: mf. */' },
});

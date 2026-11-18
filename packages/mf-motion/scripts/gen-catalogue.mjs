import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { outputFiles } = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      import { catalogueFiles } from './src/library/catalogue';
      import { libraryMoves } from './src/library/registry';
      export const files = catalogueFiles(libraryMoves().map(({ meta }) => meta));
    `,
    resolveDir: root,
    sourcefile: 'catalogue-generator.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  write: false,
});
const { files } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { values } = parseArgs({ options: { outdir: { type: 'string' } } });
const dir = values.outdir ? path.resolve(values.outdir) : path.join(root, 'dist', 'catalog');
await mkdir(dir, { recursive: true });
for (const [page, text] of Object.entries(files)) {
  await writeFile(path.join(dir, `${page}.md`), text);
}

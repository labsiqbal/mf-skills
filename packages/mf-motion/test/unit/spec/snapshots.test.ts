// Contract tests for doc-mirrored tables. Every JSON file under test/spec/ is a
// snapshot written by scripts/doc-table.mjs (see its header). Each snapshot's
// `data` must equal the code export it names in `code` ("<module>#<export>",
// called first when it is a function) and, when MFM_SPEC_DOCS points at the
// implementation docs folder, a fresh extraction of the live doc.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const specDir = join(packageRoot, 'test', 'spec');
const docTable = join(packageRoot, 'scripts', 'doc-table.mjs');

interface Snapshot {
  doc: string;
  section: string;
  mode: 'table' | 'codes';
  pattern?: string;
  code?: string;
  data: unknown;
}

const files = existsSync(specDir) ? readdirSync(specDir).filter((name) => name.endsWith('.json')).sort() : [];
const snapshots = files.map((name) => ({
  name,
  snapshot: JSON.parse(readFileSync(join(specDir, name), 'utf8')) as Snapshot,
}));

describe('spec snapshots', () => {
  it('are well formed', () => {
    for (const { name, snapshot } of snapshots) {
      expect(typeof snapshot.doc, name).toBe('string');
      expect(typeof snapshot.section, name).toBe('string');
      expect(['table', 'codes'], name).toContain(snapshot.mode);
      expect(Array.isArray(snapshot.data), name).toBe(true);
    }
  });

  for (const { name, snapshot } of snapshots) {
    describe(name, () => {
      it.runIf(snapshot.code)('equals the code it mirrors', async () => {
        const [modulePath = '', exportName = 'default'] = (snapshot.code ?? '').split('#');
        const loaded = (await import(pathToFileURL(join(packageRoot, modulePath)).href)) as Record<string, unknown>;
        expect(exportName in loaded, `${modulePath} exports ${exportName}`).toBe(true);
        const value = loaded[exportName];
        const actual = typeof value === 'function' ? await (value as () => unknown)() : value;
        expect(actual).toEqual(snapshot.data);
      });

      const docs = process.env.MFM_SPEC_DOCS;
      it.runIf(docs)('equals the live doc', () => {
        const args = [docTable, '--doc', join(docs ?? '', snapshot.doc), '--section', snapshot.section];
        if (snapshot.mode === 'codes') args.push('--codes');
        if (snapshot.pattern) args.push('--pattern', snapshot.pattern);
        const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect((JSON.parse(result.stdout) as Snapshot).data).toEqual(snapshot.data);
      });
    });
  }
});

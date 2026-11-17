import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/proc/run';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const src = join(packageRoot, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(src).filter((file) => /\.(ts|mts|js|mjs)$/.test(file));

describe('static shell scan', () => {
  it('finds no exec(, execSync( or shell: true anywhere in src/', () => {
    const forbidden = [/\bexec\s*\(/, /\bexecSync\s*\(/, /shell\s*:\s*true/];
    const hits = sources.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${relative(packageRoot, file)}: ${pattern}`);
    });
    expect(hits).toEqual([]);
  });

  it('starts child processes only in src/proc/run.ts', () => {
    const importers = sources
      .filter((file) => /['"](node:)?child_process['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(src, file).split('\\').join('/'));
    expect(importers).toEqual(['proc/run.ts']);
  });
});

describe('argument fuzz through run.ts', () => {
  const hostile = [
    `it's "quoted"`,
    'a; echo injected',
    '$(echo injected)',
    '`echo injected`',
    'line one\nline two',
    '&& echo injected',
    '| echo injected',
    '> redirected.txt',
    '%PATH% ^& echo injected',
    '--flag=value with spaces',
    '',
    'trailing backslash \\',
    'üñíçødé ✓',
  ];

  it('passes every argument through verbatim with no shell interpretation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mfm-fuzz-'));
    const marker = join(dir, 'pwned');
    const args = [...hostile, `; touch ${marker}`, `$(touch ${marker})`, `& type nul > ${marker}`];
    const result = await run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args], {
      cwd: dir,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(dir, 'redirected.txt'))).toBe(false);
  });

  it('opens files whose names contain shell metacharacters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mfm-fuzz-names-'));
    const names = ["semi;colon.txt", '$(sub).txt', "apos'trophe.txt", 'amp&ersand.txt', 'space name.txt'];
    if (process.platform !== 'win32') names.push('new\nline.txt', 'dq"uote.txt', 'back`tick.txt');
    for (const name of names) {
      const path = join(dir, name);
      writeFileSync(path, name);
      const result = await run(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))', path]);
      expect(result.code, name).toBe(0);
      expect(result.stdout, name).toBe(name);
    }
  });
});

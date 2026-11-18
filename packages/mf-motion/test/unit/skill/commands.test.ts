// The skill against the CLI: every command line it shows parses with the
// registry, its files keep their token budgets and copy rules, and the
// troubleshooting reference equals what the generator writes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../src/cli/commands/index';
import { ERROR_CODES } from '../../../src/cli/errors';
import { parseCommandLine } from '../../../src/cli/registry';
import { fencedLines, packageRoot, prose, skillFiles, skillRoot, splitLine } from './skill-files';

const files = skillFiles();
const tokens = (text: string) => Math.ceil(text.length / 4);
/** The bootstrap runs through npx at the pinned version; every other line is `mf-motion ...`. */
const BOOTSTRAP = /^npx -y mf-motion@1\.0\.0 /;

describe('skill command lines', () => {
  const lines = files.flatMap(({ rel, text }) =>
    fencedLines(text)
      .filter((line) => line.startsWith('mf-motion ') || BOOTSTRAP.test(line))
      .map((line) => ({ rel, line })),
  );

  it('the skill shows the bootstrap and at least one mf-motion line', () => {
    expect(lines.some(({ line }) => BOOTSTRAP.test(line))).toBe(true);
    expect(lines.some(({ line }) => line.startsWith('mf-motion '))).toBe(true);
  });

  it('every command line parses with the CLI registry', () => {
    for (const { rel, line } of lines) {
      const argv = splitLine(line.replace(BOOTSTRAP, 'mf-motion ')).slice(1);
      let parsed: ReturnType<typeof parseCommandLine> | null = null;
      expect(() => (parsed = parseCommandLine(argv, COMMANDS)), `${rel}: ${line}`).not.toThrow();
      expect((parsed as ReturnType<typeof parseCommandLine> | null)?.command, `${rel}: ${line}`).not.toBeNull();
      expect(argv, `${rel}: ${line} passes --json`).toContain('--json');
    }
  });
});

describe('skill budgets and copy', () => {
  it('SKILL.md is at most 2,500 tokens, each reference at most 3,000, all at most 25,000', () => {
    const skill = files.find(({ rel }) => rel === 'SKILL.md');
    expect(skill).toBeDefined();
    expect(tokens(skill?.text ?? '')).toBeLessThanOrEqual(2500);
    for (const { rel, text } of files.filter(({ rel }) => rel.startsWith('references/'))) expect(tokens(text), rel).toBeLessThanOrEqual(3000);
    expect(files.reduce((sum, { text }) => sum + tokens(text), 0)).toBeLessThanOrEqual(25000);
  });

  it('has no em or en dash, and quoted sentences are under 30 words without placeholders', () => {
    for (const { rel, text } of files) {
      expect(text, rel).not.toMatch(/[–—]/);
      for (const match of prose(text).matchAll(/"([^"\n]+)"/g)) {
        const quoted = match[1] ?? '';
        expect(quoted, `${rel}: "${quoted}"`).not.toMatch(/<[^>]+>|\bTODO\b|\bTBD\b|\.\.\./);
        expect(quoted.split(/\s+/).length, `${rel}: "${quoted}"`).toBeLessThan(30);
      }
    }
  });

  it('states the privacy sentence verbatim', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toContain(
      'mf-motion runs on your computer. It sends nothing anywhere unless you switch on a cloud module and say yes to a specific call. It fetches only the website or video link you give it, plus its own setup downloads.',
    );
  });
});

describe('troubleshooting reference', () => {
  it('lists every error code and equals the generator output', async () => {
    const generator = (await import(pathToFileURL(path.join(packageRoot, 'scripts', 'gen-troubleshooting.mjs')).href)) as {
      loadErrors: () => Promise<unknown[]>;
      render: (errors: unknown[]) => string;
      OUT: string;
    };
    const committed = readFileSync(generator.OUT, 'utf8');
    expect(committed).toBe(generator.render(await generator.loadErrors()));
    for (const code of ERROR_CODES) expect(committed, code).toContain(`| \`${code}\` |`);
  }, 60_000);
});

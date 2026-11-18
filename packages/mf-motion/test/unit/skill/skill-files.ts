// Shared readers for the skill tests: the skill's Markdown files, their fenced
// command lines, and a shell-like splitter for those lines.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const skillRoot = path.resolve(packageRoot, '..', '..', 'skills', 'mf-motion');

/** Every Markdown file of the skill, relative to its folder, with its text. */
export function skillFiles(): Array<{ rel: string; text: string }> {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));
  return walk(skillRoot)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => ({ rel: path.relative(skillRoot, file).split(path.sep).join('/'), text: readFileSync(file, 'utf8') }));
}

/** Lines inside fenced code blocks. */
export function fencedLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) out.push(line.trim());
  }
  return out;
}

/** Split a command line like a POSIX shell: whitespace separates, quotes group. */
export function splitLine(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) words.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
    }
  }
  if (started || current) words.push(current);
  return words;
}

/** Prose without frontmatter, fenced blocks and inline code. */
export function prose(text: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return body
    .split(/\r?\n/)
    .reduce<{ inFence: boolean; lines: string[] }>(
      (state, line) => {
        if (/^\s*```/.test(line)) return { inFence: !state.inFence, lines: state.lines };
        if (!state.inFence) state.lines.push(line.replace(/`[^`]*`/g, ''));
        return state;
      },
      { inFence: false, lines: [] },
    )
    .lines.join('\n');
}

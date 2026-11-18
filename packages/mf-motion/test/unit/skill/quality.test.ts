// references/quality.md carries the judge instruction verbatim, exactly as the
// CLI ships it in assets/rubric/judge-instruction.txt, and the three plain-word
// verdict explanations of critique-loop.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot, skillRoot } from './skill-files';

const quality = readFileSync(path.join(skillRoot, 'references', 'quality.md'), 'utf8');

describe('quality reference', () => {
  it('holds the judge instruction verbatim', () => {
    const shipped = readFileSync(path.join(packageRoot, 'assets', 'rubric', 'judge-instruction.txt'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
    const blocks = [...quality.matchAll(/```\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? '');
    expect(blocks).toContain(shipped);
  });

  it('states the dispatch order and the three verdict explanations', () => {
    const fresh = quality.indexOf('A fresh reviewer');
    const self = quality.indexOf('Yourself, in this session');
    const none = quality.indexOf('No images');
    expect(fresh).toBeGreaterThan(-1);
    expect(self).toBeGreaterThan(fresh);
    expect(none).toBeGreaterThan(self);
    for (const words of ['"Checked by a fresh reviewer"', '"Checked in the same session"', '"Checked by measurements only; I could not view images"']) expect(quality).toContain(words);
  });

  it('is linked from the SKILL.md route', () => {
    expect(readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8')).toContain('[references/quality.md](references/quality.md)');
  });
});

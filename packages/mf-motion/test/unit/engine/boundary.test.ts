import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot } from '../../../src/engine/index';

const src = path.join(packageRoot(), 'src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));

describe('engine boundary', () => {
  it('only src/engine imports HyperFrames packages or runs its bin', () => {
    const pattern = /from\s+['"](hyperframes|gsap|three|puppeteer-core)(\/[^'"]*)?['"]|import\(\s*['"](hyperframes|gsap|three|puppeteer-core)|npmBin\(\s*['"]hyperframes/;
    const offenders = walk(src)
      .filter((file) => /\.(ts|mts|js|mjs)$/.test(file))
      .filter((file) => !path.relative(src, file).split(path.sep).join('/').startsWith('engine/'))
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(src, file));
    expect(offenders).toEqual([]);
  });
});

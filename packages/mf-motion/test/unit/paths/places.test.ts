import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cache, dataHome } from '../../../src/paths/index';

describe('data home', () => {
  it('defaults to <home>/mf-motion on every OS', () => {
    expect(dataHome({ platform: 'linux', homedir: '/home/ana', env: {} })).toBe('/home/ana/mf-motion');
    expect(dataHome({ platform: 'darwin', homedir: '/Users/ana', env: {} })).toBe('/Users/ana/mf-motion');
    expect(dataHome({ platform: 'win32', homedir: 'C:\\Users\\ana', env: {} })).toBe('C:\\Users\\ana\\mf-motion');
  });

  it('takes --home over MF_MOTION_HOME, both resolved against cwd', () => {
    const env = { MF_MOTION_HOME: '/data/mfm' };
    expect(dataHome({ platform: 'linux', homedir: '/home/ana', env })).toBe('/data/mfm');
    expect(dataHome({ platform: 'linux', homedir: '/home/ana', env, flag: 'here', cwd: '/work' })).toBe('/work/here');
    expect(dataHome({ platform: 'win32', homedir: 'C:\\Users\\ana', env: { MF_MOTION_HOME: 'D:\\mfm' } })).toBe('D:\\mfm');
  });
});

describe('cache', () => {
  it('follows each OS cache convention', () => {
    expect(cache({ platform: 'linux', homedir: '/home/ana', env: {} })).toBe('/home/ana/.cache/mf-motion');
    expect(cache({ platform: 'linux', homedir: '/home/ana', env: { XDG_CACHE_HOME: '/xdg' } })).toBe('/xdg/mf-motion');
    expect(cache({ platform: 'linux', homedir: '/home/ana', env: { XDG_CACHE_HOME: 'relative' } })).toBe('/home/ana/.cache/mf-motion');
    expect(cache({ platform: 'darwin', homedir: '/Users/ana', env: {} })).toBe('/Users/ana/Library/Caches/mf-motion');
    expect(cache({ platform: 'win32', homedir: 'C:\\Users\\ana', env: { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' } })).toBe(
      'C:\\Users\\ana\\AppData\\Local\\mf-motion\\Cache',
    );
    expect(cache({ platform: 'win32', homedir: 'C:\\Users\\ana', env: {} })).toBe('C:\\Users\\ana\\AppData\\Local\\mf-motion\\Cache');
  });

  it('takes MF_MOTION_CACHE over the OS folder', () => {
    expect(cache({ platform: 'darwin', homedir: '/Users/ana', env: { MF_MOTION_CACHE: '/tmp/c' } })).toBe('/tmp/c');
  });
});

describe('home handling', () => {
  it('never reads HOME or expands ~ by string in src/', () => {
    const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
    const hits = walk(src).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /env\.HOME\b|env\[['"]HOME['"]\]|['"`]~[/\\]/.test(text);
    });
    expect(hits.map((file) => relative(src, file))).toEqual([]);
  });
});

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import { confine } from '../../../src/paths/index';

function setup() {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'mfm-confine-')));
  const root = join(base, 'project');
  const outside = join(base, 'outside');
  mkdirSync(join(root, 'plan'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'x');
  writeFileSync(join(root, 'plan', 'beatgrid.json'), '{}');
  return { base, root, outside };
}

function link(target: string, path: string, kind: 'file' | 'dir' = 'file'): boolean {
  try {
    // Junctions need no special rights on Windows; other systems ignore the type.
    symlinkSync(target, path, kind === 'dir' ? 'junction' : 'file');
    return true;
  } catch (error) {
    // Windows without symlink rights: the symlink case cannot be built here.
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

function escapes(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MfmError);
    expect((error as MfmError).code).toBe('PATH_ESCAPES_ROOT');
    expect((error as MfmError).exitCode).toBe(4);
    return;
  }
  throw new Error('expected PATH_ESCAPES_ROOT');
}

describe('confine', () => {
  it('accepts paths inside the root, existing or not', () => {
    const { root } = setup();
    expect(confine(root, 'plan/beatgrid.json')).toBe(join(root, 'plan', 'beatgrid.json'));
    expect(confine(root, 'rounds/1/new.json')).toBe(join(root, 'rounds', '1', 'new.json'));
    expect(confine(root, '.')).toBe(root);
    expect(confine(root, join(root, 'plan'))).toBe(join(root, 'plan'));
  });

  it('refuses ../ and absolute paths outside the root', () => {
    const { root, outside } = setup();
    escapes(() => confine(root, '../outside/secret.txt'));
    escapes(() => confine(root, 'plan/../../outside'));
    escapes(() => confine(root, join(outside, 'secret.txt')));
    escapes(() => confine(root, '..'));
  });

  it('refuses a symlink that points out of the root, file or folder', () => {
    const { root, outside } = setup();
    if (!link(join(outside, 'secret.txt'), join(root, 'plan', 'leak.json'))) return;
    escapes(() => confine(root, 'plan/leak.json'));
    expect(link(outside, join(root, 'escape'), 'dir')).toBe(true);
    escapes(() => confine(root, 'escape/secret.txt'));
    escapes(() => confine(root, 'escape/not-yet.txt'));
  });

  it('accepts a symlink that stays inside the root', () => {
    const { root } = setup();
    if (!link(join(root, 'plan', 'beatgrid.json'), join(root, 'alias.json'))) return;
    expect(confine(root, 'alias.json')).toBe(join(root, 'plan', 'beatgrid.json'));
  });
});

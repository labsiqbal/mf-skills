import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import { acquireLock, withLock } from '../../../src/paths/index';

const children: Array<ReturnType<typeof spawn>> = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function liveProcess(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  return child.pid ?? 0;
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  return Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
}

const lockPath = () => join(mkdtempSync(join(tmpdir(), 'mfm-lock-')), '.lock');

function writeHolder(path: string, pid: number, startedAt = new Date().toISOString(), host = hostname()) {
  writeFileSync(path, JSON.stringify({ pid, host, command: 'film round', startedAt }));
}

describe('locks', () => {
  it('writes the holder and removes the file on release', () => {
    const path = lockPath();
    const release = acquireLock(path, { command: 'note' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ pid: process.pid, host: hostname(), command: 'note' });
    release();
    expect(existsSync(path)).toBe(false);
  });

  it('refuses a lock held by a live process with LOCKED naming the holder', () => {
    const path = lockPath();
    const pid = liveProcess();
    writeHolder(path, pid);
    let error: unknown;
    try {
      acquireLock(path, { command: 'note' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MfmError);
    expect((error as MfmError).code).toBe('LOCKED');
    expect((error as MfmError).exitCode).toBe(4);
    expect((error as MfmError).message).toContain(`pid ${pid}`);
    expect((error as MfmError).message).toContain('film round');
    expect((error as MfmError).details).toMatchObject({ holder: { pid, command: 'film round' } });
    expect(existsSync(path)).toBe(true);
  });

  it('replaces a lock whose process is gone, with a warning', () => {
    const path = lockPath();
    const pid = deadPid();
    writeHolder(path, pid);
    const warnings: string[] = [];
    const release = acquireLock(path, { command: 'note', onStale: (message) => warnings.push(message) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`process ${pid} is no longer running`);
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
    release();
  });

  it('replaces a lock older than 6 hours even when its process lives', () => {
    const path = lockPath();
    writeHolder(path, liveProcess(), new Date(Date.now() - 7 * 3600 * 1000).toISOString());
    const warnings: string[] = [];
    acquireLock(path, { command: 'note', onStale: (message) => warnings.push(message) })();
    expect(warnings[0]).toContain('older than 6 hours');
  });

  it('does not judge a lock from another host by pid', () => {
    const path = lockPath();
    writeHolder(path, deadPid(), new Date().toISOString(), 'another-host.example');
    expect(() => acquireLock(path, { command: 'note' })).toThrow(MfmError);
  });

  it('is re-entrant within one process and releases on the outermost exit', async () => {
    const path = lockPath();
    await withLock(path, async () => {
      await withLock(path, () => expect(existsSync(path)).toBe(true), { command: 'inner' });
      expect(existsSync(path)).toBe(true);
    }, { command: 'outer' });
    expect(existsSync(path)).toBe(false);
  });

  it('releases the lock when the work throws', async () => {
    const path = lockPath();
    await expect(withLock(path, () => Promise.reject(new Error('fail')), { command: 'x' })).rejects.toThrow('fail');
    expect(existsSync(path)).toBe(false);
  });
});

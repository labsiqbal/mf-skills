// Exclusive lock files for projects and brands. A lock holds
// { pid, host, command, startedAt }; it is taken with an exclusive create and
// is stale when its pid is gone on this host or it is older than 6 hours.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { MfmError } from '../cli/errors';

export const LOCK_STALE_MS = 6 * 60 * 60 * 1000;
/** A lock file still empty this long after creation is treated as abandoned. */
const EMPTY_GRACE_MS = 10_000;

export interface LockHolder {
  pid: number;
  host: string;
  command: string;
  startedAt: string;
}

export interface LockOptions {
  /** Command name recorded in the lock, for example "approve". */
  command: string;
  /** Called when a stale lock is replaced. */
  onStale?: (message: string, holder: LockHolder | null) => void;
  now?: () => Date;
}

const held = new Map<string, number>();

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(lockPath: string): { raw: string; holder: LockHolder | null } | null {
  let raw: string;
  try {
    raw = readFileSync(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const value = JSON.parse(raw) as Partial<LockHolder>;
    if (typeof value.pid === 'number' && typeof value.host === 'string' && typeof value.startedAt === 'string') {
      return { raw, holder: { pid: value.pid, host: value.host, command: String(value.command ?? ''), startedAt: value.startedAt } };
    }
  } catch {
    // Unreadable content is judged by the file's age below.
  }
  return { raw, holder: null };
}

/** Why a lock is stale, or null when it is live. */
function staleReason(lockPath: string, holder: LockHolder | null, now: Date): string | null {
  if (!holder) {
    let age = 0;
    try {
      age = now.getTime() - statSync(lockPath).mtimeMs;
    } catch {
      return null;
    }
    return age > EMPTY_GRACE_MS ? 'the lock file is unreadable' : null;
  }
  const age = now.getTime() - Date.parse(holder.startedAt);
  if (!Number.isFinite(age) || age > LOCK_STALE_MS) return `it is older than 6 hours (started ${holder.startedAt})`;
  if (holder.host === hostname() && !processAlive(holder.pid)) return `process ${holder.pid} is no longer running`;
  return null;
}

function describe(holder: LockHolder | null): string {
  return holder ? `\`${holder.command || 'mf-motion'}\` (pid ${holder.pid} on ${holder.host}, since ${holder.startedAt})` : 'another process';
}

function tryCreate(lockPath: string, holder: LockHolder): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeSync(fd, JSON.stringify(holder));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Take the lock or throw LOCKED; returns a release function. Re-entrant within one process. */
export function acquireLock(lockPath: string, options: LockOptions): () => void {
  const depth = held.get(lockPath);
  if (depth !== undefined) {
    held.set(lockPath, depth + 1);
    return () => release(lockPath, null);
  }
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const now = options.now ?? (() => new Date());
  const mine: LockHolder = { pid: process.pid, host: hostname(), command: options.command, startedAt: now().toISOString() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (tryCreate(lockPath, mine)) {
      held.set(lockPath, 1);
      return () => release(lockPath, mine);
    }
    const current = readHolder(lockPath);
    if (!current) continue;
    const reason = staleReason(lockPath, current.holder, now());
    if (!reason) {
      throw new MfmError(
        'LOCKED',
        { lock: lockPath, holder: current.holder },
        { message: `${lockPath} is locked by ${describe(current.holder)}.` },
      );
    }
    // Remove the stale lock only if it is still the one we judged.
    const again = readHolder(lockPath);
    if (again && again.raw === current.raw) {
      rmSync(lockPath, { force: true });
      options.onStale?.(`Replaced a stale lock at ${lockPath} held by ${describe(current.holder)}: ${reason}.`, current.holder);
    }
  }
  const last = readHolder(lockPath);
  throw new MfmError('LOCKED', { lock: lockPath, holder: last?.holder ?? null }, {
    message: `${lockPath} is locked by ${describe(last?.holder ?? null)}.`,
  });
}

function release(lockPath: string, mine: LockHolder | null): void {
  const depth = held.get(lockPath) ?? 0;
  if (depth > 1) {
    held.set(lockPath, depth - 1);
    return;
  }
  held.delete(lockPath);
  if (!mine) return;
  const current = readHolder(lockPath);
  if (current?.holder && current.holder.pid === mine.pid && current.holder.startedAt === mine.startedAt) {
    rmSync(lockPath, { force: true });
  }
}

/** Run `fn` while holding the lock at `lockPath`. */
export async function withLock<T>(lockPath: string, fn: () => Promise<T> | T, options: LockOptions): Promise<T> {
  const releaseLock = acquireLock(lockPath, options);
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

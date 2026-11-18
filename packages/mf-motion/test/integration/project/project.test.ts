// Projects and approvals through the built CLI.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appendEvent, planHash } from '../../../src/paths/index';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outdir = mkdtempSync(join(tmpdir(), 'mfm-cli-'));
const cli = join(outdir, 'cli.mjs');
const children: Array<ReturnType<typeof spawn>> = [];

beforeAll(() => {
  const build = spawnSync(process.execPath, ['esbuild.config.mjs', '--outdir', outdir], { cwd: packageRoot, encoding: 'utf8' });
  expect(build.status).toBe(0);
});
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function env(home: string) {
  return { ...process.env, MF_MOTION_HOME: home, NO_COLOR: '1' };
}

function mfm(home: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', env: env(home) });
  return { code: result.status, json: JSON.parse(result.stdout) as Record<string, any>, stderr: result.stderr };
}

function mfmAsync(home: string, ...args: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args, '--json'], { env: env(home) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal, stdout, stderr }));
  });
}

function newProject(home: string, title = 'Launch Film', type = 'film') {
  const result = mfm(home, 'new', title, '--type', type);
  expect(result.code).toBe(0);
  return result.json.data.project as { id: string; root: string };
}

const tempHome = () => join(mkdtempSync(join(tmpdir(), 'mfm-home-')), 'home');

describe('new', () => {
  it('creates project.json and the project.created event, with the documented data shape', () => {
    const home = tempHome();
    const result = mfm(home, 'new', 'Launch Film', '--type', 'moves', '--aspect', '9:16', '--language', 'pt-br');
    expect(result.code).toBe(0);
    const { project, next } = result.json.data;
    expect(Object.keys(result.json.data)).toEqual(['project', 'next']);
    expect(project.root).toBe(join(home, 'projects', project.id));
    expect(next[0]).toContain('mf-motion transcribe --project');
    expect(result.json.next).toEqual(next);
    const doc = JSON.parse(readFileSync(join(project.root, 'project.json'), 'utf8'));
    expect(doc).toMatchObject({
      schemaVersion: 1,
      kind: 'project',
      id: project.id,
      title: 'Launch Film',
      type: 'moves',
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: '30',
      brand: null,
      theme: null,
      language: 'pt-BR',
      cli: '1.0.0',
    });
    const events = readFileSync(join(project.root, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 1, type: 'project.created', actor: 'cli' });
  });

  it('gives two projects with the same title different ids', () => {
    const home = tempHome();
    const a = newProject(home, 'Same Title');
    const b = newProject(home, 'Same Title');
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith('same-title-')).toBe(true);
  });

  it('refuses a second project in the same folder and an unknown brand', () => {
    const home = tempHome();
    const dir = join(home, 'work', 'film');
    expect(mfm(home, 'new', 'One', '--type', 'film', '--dir', dir).code).toBe(0);
    const again = mfm(home, 'new', 'Two', '--type', 'film', '--dir', dir);
    expect(again.code).toBe(4);
    expect(again.json.error.code).toBe('PROJECT_EXISTS');
    const brand = mfm(home, 'new', 'Three', '--type', 'film', '--brand', 'nobody.example');
    expect(brand.code).toBe(2);
    expect(brand.json.error.code).toBe('BRAND_NOT_FOUND');
    expect(mfm(home, 'new', 'Four', '--type', 'film', '--brand', '../escape').json.error.code).toBe('BRAND_NOT_FOUND');
  });
});

describe('locks', () => {
  it('a second writer gets LOCKED (exit 4) naming the holder', () => {
    const home = tempHome();
    const { root } = newProject(home);
    const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(holder);
    writeFileSync(join(root, '.lock'), JSON.stringify({ pid: holder.pid, host: hostname(), command: 'film round', startedAt: new Date().toISOString() }));
    const result = mfm(home, 'note', '--text', 'hello', '--project', root);
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe('LOCKED');
    expect(result.json.error.message).toContain(`pid ${holder.pid}`);
    expect(result.json.error.message).toContain('film round');
  });

  it('a lock with a dead pid is replaced with a warning', () => {
    const home = tempHome();
    const { root } = newProject(home);
    const dead = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
    writeFileSync(join(root, '.lock'), JSON.stringify({ pid: dead, host: hostname(), command: 'film round', startedAt: new Date().toISOString() }));
    const result = mfm(home, 'note', '--text', 'hello', '--project', root);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(`process ${dead} is no longer running`);
    expect(result.json.data.event).toMatchObject({ seq: 2, type: 'note.added', actor: 'agent', data: { text: 'hello' } });
  });

  // Temporary MFM-133 diagnostic. Repeat in one Windows CI job and report every failing envelope.
  const repeat = process.platform === 'win32' && process.env.CI === 'true' ? 30 : 1;
  it.each(Array.from({ length: repeat }, (_, index) => index + 1))('keeps seq strictly increasing under 20 concurrent note calls (run %i)', async () => {
    const home = tempHome();
    const { root } = newProject(home);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => mfmAsync(home, 'note', '--text', `note ${i}`, '--project', root)));
    for (const [index, result] of results.entries()) {
      const diagnostic = `note ${index} exit ${result.code} signal ${result.signal}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
      expect([0, 4], diagnostic).toContain(result.code);
      if (result.code === 4) expect(JSON.parse(result.stdout).error.code, diagnostic).toBe('LOCKED');
    }
    const succeeded = results.filter((result) => result.code === 0).length;
    expect(succeeded).toBeGreaterThan(0);
    const events = readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: succeeded + 1 }, (_, i) => i + 1));
    const seqs = results.filter((r) => r.code === 0).map((r) => JSON.parse(r.stdout).data.event.seq as number);
    expect(new Set(seqs).size).toBe(succeeded);
  });
});

describe('approve', () => {
  function showBeatgrid(root: string, content: string) {
    mkdirSync(join(root, 'plan'), { recursive: true });
    const file = join(root, 'plan', 'beatgrid.json');
    writeFileSync(file, content);
    appendEvent(root, { type: 'plan.shown', actor: 'cli', data: { subject: 'beatgrid', planHash: planHash(file) } });
    return file;
  }

  it('refuses with APPROVAL_MISSING when no plan was shown', () => {
    const home = tempHome();
    const { root } = newProject(home);
    const result = mfm(home, 'approve', '--subject', 'beatgrid', '--text', 'yes', '--project', root);
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe('APPROVAL_MISSING');
    expect(result.json.next[0]).toContain('mf-motion beatgrid check');
  });

  it('records the verbatim words against the shown plan hash', () => {
    const home = tempHome();
    const { root } = newProject(home);
    const file = showBeatgrid(root, '{"bpm":120}\n');
    const words = 'Yes, but make the drop "punchier"; ship it (café $(rm -rf x))';
    const result = mfm(home, 'approve', '--subject', 'beatgrid', '--text', words, '--project', root);
    expect(result.code).toBe(0);
    expect(result.json.data.event).toMatchObject({ seq: 3, planHash: planHash(file) });
    const last = JSON.parse(readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').pop() ?? '{}');
    expect(last).toMatchObject({ type: 'approval.recorded', actor: 'user', data: { subject: 'beatgrid', text: words, planHash: planHash(file) } });
  });

  it('refuses with APPROVAL_STALE (exit 4) after the shown plan was edited', () => {
    const home = tempHome();
    const { root } = newProject(home);
    const file = showBeatgrid(root, '{"bpm":120}\n');
    writeFileSync(file, '{"bpm":128}\n');
    const result = mfm(home, 'approve', '--subject', 'beatgrid', '--text', 'yes', '--project', root);
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe('APPROVAL_STALE');
    expect(result.json.error.details).toMatchObject({ subject: 'beatgrid', file: 'plan/beatgrid.json' });
  });

  it('refuses a plan file that is a symlink out of the project with PATH_ESCAPES_ROOT', () => {
    const home = tempHome();
    const { root } = newProject(home);
    const outside = join(dirname(home), 'outside.json');
    writeFileSync(outside, '{"bpm":120}\n');
    mkdirSync(join(root, 'plan'), { recursive: true });
    try {
      symlinkSync(outside, join(root, 'plan', 'beatgrid.json'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return; // Windows without symlink rights
      throw error;
    }
    appendEvent(root, { type: 'plan.shown', actor: 'cli', data: { subject: 'beatgrid', planHash: planHash(outside) } });
    const result = mfm(home, 'approve', '--subject', 'beatgrid', '--text', 'yes', '--project', root);
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe('PATH_ESCAPES_ROOT');
  });
});

describe('status', () => {
  it('reports the project, phase, last event and next commands, from inside the project folder', () => {
    const home = tempHome();
    const { root, id } = newProject(home);
    mkdirSync(join(root, 'plan'));
    const result = spawnSync(process.execPath, [cli, 'status', '--json'], { cwd: join(root, 'plan'), encoding: 'utf8', env: env(home) });
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(Object.keys(data)).toEqual(['project', 'phase', 'last', 'nextAllowed']);
    expect(data.project.id).toBe(id);
    expect(data.phase).toBe('created');
    expect(data.last.type).toBe('project.created');
    expect(data.nextAllowed).toContain('beatgrid check');
  });

  it('is PROJECT_NOT_FOUND outside a project', () => {
    const result = spawnSync(process.execPath, [cli, 'status', '--json'], { cwd: tmpdir(), encoding: 'utf8', env: env(tempHome()) });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('PROJECT_NOT_FOUND');
  });
});

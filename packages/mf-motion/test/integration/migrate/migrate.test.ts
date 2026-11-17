// schema and migrate through the built CLI.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = join(packageRoot, 'test', 'fixtures', 'schemas');
const outdir = mkdtempSync(join(tmpdir(), 'mfm-cli-'));
const cli = join(outdir, 'cli.mjs');

beforeAll(() => {
  const build = spawnSync(process.execPath, ['esbuild.config.mjs', '--outdir', outdir], { cwd: packageRoot, encoding: 'utf8' });
  expect(build.status).toBe(0);
});

function mfm(home: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, MF_MOTION_HOME: home, NO_COLOR: '1' },
  });
  return { code: result.status, json: JSON.parse(result.stdout) as Record<string, any> };
}

function homeWithProfile(fixture: string) {
  const home = mkdtempSync(join(tmpdir(), 'mfm-home-'));
  mkdirSync(home, { recursive: true });
  copyFileSync(join(fixtures, fixture), join(home, 'profile.json'));
  return home;
}

describe('migrate', () => {
  it('--dry-run lists the version 0 profile without writing', () => {
    const home = homeWithProfile('profile.v0.json');
    const before = readFileSync(join(home, 'profile.json'), 'utf8');
    const result = mfm(home, 'migrate', '--dry-run');
    expect(result.code).toBe(0);
    expect(result.json.data.changed).toEqual([
      { path: join(home, 'profile.json'), from: 0, to: 1, backup: join(home, 'profile.json.bak-v0') },
    ]);
    expect(readFileSync(join(home, 'profile.json'), 'utf8')).toBe(before);
    expect(existsSync(join(home, 'profile.json.bak-v0'))).toBe(false);
  });

  it('writes the backup and the current document, then has nothing left to do', () => {
    const home = homeWithProfile('profile.v0.json');
    const before = readFileSync(join(home, 'profile.json'), 'utf8');
    const result = mfm(home, 'migrate');
    expect(result.code).toBe(0);
    expect(result.json.data.changed).toHaveLength(1);
    expect(readFileSync(join(home, 'profile.json.bak-v0'), 'utf8')).toBe(before);
    const migrated = JSON.parse(readFileSync(join(home, 'profile.json'), 'utf8'));
    expect(migrated).toEqual(JSON.parse(readFileSync(join(fixtures, 'profile.valid.json'), 'utf8')));
    expect(mfm(home, 'migrate').json.data.changed).toEqual([]);
  });

  it('refuses a version 2 document with SCHEMA_TOO_NEW (exit 4)', () => {
    const result = mfm(homeWithProfile('profile.v2.json'), 'migrate');
    expect(result.code).toBe(4);
    expect(result.json.error.code).toBe('SCHEMA_TOO_NEW');
  });

  it('checks a project with --project and logs nothing when it is current', () => {
    const home = mkdtempSync(join(tmpdir(), 'mfm-home-'));
    const root = mfm(home, 'new', 'Current', '--type', 'film').json.data.project.root as string;
    const result = mfm(home, 'migrate', '--project', root);
    expect(result.code).toBe(0);
    expect(result.json.data.changed).toEqual([]);
    expect(readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });
});

describe('schema', () => {
  it('schema brand --json returns a draft 2020-12 JSON Schema', () => {
    const result = mfm(mkdtempSync(join(tmpdir(), 'mfm-home-')), 'schema', 'brand');
    expect(result.code).toBe(0);
    expect(result.json.data.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(result.json.data.title).toBe('brand');
  });

  it('rejects an unknown kind with USAGE', () => {
    const result = mfm(mkdtempSync(join(tmpdir(), 'mfm-home-')), 'schema', 'nope');
    expect(result.code).toBe(2);
    expect(result.json.error.code).toBe('USAGE');
  });

  it('version lists the schema versions', () => {
    expect(mfm(mkdtempSync(join(tmpdir(), 'mfm-home-')), 'version').json.data.schemas).toMatchObject({
      profile: 1,
      project: 1,
      brand: 1,
      brief: 1,
      events: 1,
    });
  });
});

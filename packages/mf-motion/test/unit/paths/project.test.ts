import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_PATTERN, findProjectRoot, nextAllowed, projectId, projectPhase, readProject, slugify } from '../../../src/paths/index';
import type { ProjectEvent } from '../../../src/paths/index';

describe('project ids', () => {
  it('slug the title and add 4 base32 characters', () => {
    const id = projectId('Launch Film: Spring!', '2026-11-18T10:00:00.000Z');
    expect(id).toMatch(/^launch-film-spring-[a-z2-7]{4}$/);
    expect(ID_PATTERN.test(id)).toBe(true);
  });

  it('differ for two projects with the same title created at the same instant', () => {
    const at = '2026-11-18T10:00:00.000Z';
    const ids = new Set(Array.from({ length: 50 }, () => projectId('Same Title', at)));
    expect(ids.size).toBeGreaterThan(45);
  });

  it('stay within 48 characters and fall back for titles without Latin letters', () => {
    expect(projectId('x'.repeat(200), 'now').length).toBeLessThanOrEqual(48);
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('新しい動画')).toBe('project');
    expect(slugify('--a--b--')).toBe('a-b');
  });
});

function doc(cli: string, schemaVersion = 1) {
  return { schemaVersion, kind: 'project', id: 'demo-abcd', title: 'Demo', type: 'film', cli };
}

describe('project discovery and reading', () => {
  it('walks up from cwd to the nearest project.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'mfm-project-'));
    writeFileSync(join(root, 'project.json'), JSON.stringify(doc('1.0.0')));
    mkdirSync(join(root, 'plan', 'deep'), { recursive: true });
    expect(findProjectRoot(join(root, 'plan', 'deep'))).toBe(root);
    expect(findProjectRoot('/', root)).toBe(root);
    expect(() => findProjectRoot(tmpdir(), join(root, 'plan'))).toThrow(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }));
  });

  it('refuses a project from a newer CLI major or schema version', () => {
    const root = mkdtempSync(join(tmpdir(), 'mfm-project-'));
    writeFileSync(join(root, 'project.json'), JSON.stringify(doc('2.0.0')));
    expect(() => readProject(root, '1.0.0')).toThrow(expect.objectContaining({ code: 'PROJECT_TOO_NEW', exitCode: 4 }));
    writeFileSync(join(root, 'project.json'), JSON.stringify(doc('1.4.0')));
    expect(readProject(root, '1.0.0').id).toBe('demo-abcd');
    writeFileSync(join(root, 'project.json'), JSON.stringify(doc('1.0.0', 2)));
    expect(() => readProject(root, '1.0.0')).toThrow(expect.objectContaining({ code: 'SCHEMA_TOO_NEW' }));
    writeFileSync(join(root, 'project.json'), '{"kind":"brand"}');
    expect(() => readProject(root, '1.0.0')).toThrow(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
  });
});

describe('phase', () => {
  const event = (type: ProjectEvent['type']): ProjectEvent => ({
    schemaVersion: 1, at: '2026-11-18T10:00:00.000Z', seq: 1, type, actor: 'cli', durationMs: null, round: null, data: {},
  });
  it('follows the last phase-bearing event and ignores notes', () => {
    expect(projectPhase([event('project.created')])).toBe('created');
    expect(projectPhase([event('project.created'), event('plan.shown'), event('note.added')])).toBe('awaiting-approval');
    expect(projectPhase([event('plan.shown'), event('approval.recorded')])).toBe('approved');
    expect(projectPhase([event('build.done'), event('render.started'), event('render.finished'), event('gate.verdict')])).toBe('gated');
    expect(nextAllowed('film', 'awaiting-approval')).toContain('approve');
    expect(nextAllowed('moves', 'approved')).toContain('moves render');
  });
});

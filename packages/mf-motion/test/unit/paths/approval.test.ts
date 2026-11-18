// An approval covers the exact plan the user saw: when the plan file's hash no
// longer equals the latest approval.recorded planHash, the approval is stale,
// the project returns to awaiting-approval and the gated commands drop out.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ProjectEvent, nextAllowed, planHash, projectPhase, staleApprovals } from '../../../src/paths/index';

let seq = 0;
const event = (type: ProjectEvent['type'], data: Record<string, unknown> = {}): ProjectEvent =>
  ({ schemaVersion: 1, at: '2026-11-18T00:00:00.000Z', seq: (seq += 1), type, actor: 'cli', durationMs: null, round: null, data }) as ProjectEvent;

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mfm-approval-'));
  mkdirSync(join(root, 'plan'));
  const grid = join(root, 'plan', 'beatgrid.json');
  writeFileSync(grid, '{"bpm":120}\n');
  const hash = planHash(grid);
  const events = [event('project.created'), event('plan.shown', { subject: 'beatgrid', planHash: hash }), event('approval.recorded', { subject: 'beatgrid', text: 'yes', planHash: hash })];
  return { root, grid, hash, events };
}

describe('approval staleness', () => {
  it('an unchanged plan keeps the approval: approved, with film build and score allowed', () => {
    const { root, events } = project();
    expect(staleApprovals(root, events)).toEqual([]);
    expect(projectPhase(events, root)).toBe('approved');
    expect(nextAllowed('film', 'approved', [])).toEqual(expect.arrayContaining(['film build', 'score']));
  });

  it('an edited plan file makes the approval stale and returns the project to awaiting-approval', () => {
    const { root, grid, events } = project();
    writeFileSync(grid, '{"bpm":124}\n');
    expect(staleApprovals(root, events)).toEqual(['beatgrid']);
    expect(projectPhase(events, root)).toBe('awaiting-approval');
    expect(projectPhase(events)).toBe('approved');
    const allowed = nextAllowed('film', projectPhase(events, root), staleApprovals(root, events));
    expect(allowed).toEqual(expect.arrayContaining(['approve', 'beatgrid check']));
    expect(allowed).not.toContain('film build');
    expect(allowed).not.toContain('score');
  });

  it('line endings alone do not make an approval stale; a removed plan file does', () => {
    const { root, grid, events } = project();
    writeFileSync(grid, '{"bpm":120}\r\n');
    expect(staleApprovals(root, events)).toEqual([]);
    rmSync(grid);
    expect(staleApprovals(root, events)).toEqual(['beatgrid']);
  });

  it('later phases keep their phase but drop the commands the stale approval gated', () => {
    const { root, grid, events } = project();
    const built = [...events, event('build.done')];
    writeFileSync(grid, '{"bpm":100}\n');
    expect(projectPhase(built, root)).toBe('built');
    expect(nextAllowed('film', 'built', staleApprovals(root, built))).toEqual(expect.arrayContaining(['approve', 'beatgrid check', 'film round']));
    expect(nextAllowed('moves', 'approved', ['placement'])).not.toContain('moves render');
  });

  it('a newer approval of the edited plan clears the staleness', () => {
    const { root, grid, events } = project();
    writeFileSync(grid, '{"bpm":124}\n');
    const hash = planHash(grid);
    const again = [...events, event('plan.shown', { subject: 'beatgrid', planHash: hash }), event('approval.recorded', { subject: 'beatgrid', text: 'yes again', planHash: hash })];
    expect(staleApprovals(root, again)).toEqual([]);
    expect(projectPhase(again, root)).toBe('approved');
  });
});

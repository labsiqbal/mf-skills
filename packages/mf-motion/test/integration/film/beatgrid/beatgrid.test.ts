// beatgrid check through the CLI: the fixture grid resolves frame-exact and is
// shown for approval; gaps, two drops and cue cycles fail their rules; and an
// edit after approval makes the approval stale for film build.
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { readEvents } from '../../../../src/paths/index';
import { readDoc } from '../../../../src/schemas/index';
import { runIn } from '../../../unit/cli/harness';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixtureGrid = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'fixtures', 'grids', 'beatgrid-120-10x4.json'), 'utf8')) as Record<string, any>;

function project(grid: Record<string, any> = fixtureGrid): string {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-beatgrid-')), 'film');
  cpSync(path.join(packageRoot, 'test', 'fixtures', 'projects', 'film'), root, { recursive: true });
  writeFileSync(path.join(root, 'plan', 'beatgrid.json'), `${JSON.stringify(grid, null, 2)}\n`);
  return root;
}

async function mfm(root: string, ...args: string[]) {
  const result = await runIn([...args, '--project', root, '--json'], COMMANDS, { NO_COLOR: '1' });
  return { code: result.code, json: JSON.parse(result.stdout) as { ok: boolean; data: any; error?: any; warnings: any[] }, stderr: result.stderr };
}

const codes = (data: { problems: Array<{ code: string }> }) => [...new Set(data.problems.map((problem) => problem.code))];

describe('beatgrid check', () => {
  it('resolves the 120 BPM, 10-bar grid with a 0.8 s tail to 20.8 s and shows the table', async () => {
    const root = project();
    const result = await mfm(root, 'beatgrid', 'check');
    expect(result.code, JSON.stringify(result.json)).toBe(0);
    expect(result.json.data).toMatchObject({ lengthSec: 20.8, problems: [], resolved: path.join(root, 'plan', 'beatgrid.resolved.json') });
    const { doc } = readDoc('beatgrid-resolved', path.join(root, 'plan', 'beatgrid.resolved.json'));
    expect(doc).toMatchObject({ kind: 'beatgrid-resolved', spb: 0.5, lengthSec: 20.8, frames: 624 });
    expect(doc.cues).toEqual({ reveal: { sec: 4, frame: 120 }, fail: { sec: 6, frame: 180 }, fix: { sec: 10, frame: 300 }, logo: { sec: 16, frame: 480 } });
    expect(doc.shots.map((shot) => [shot.id, shot.from.frame, shot.to.frame])).toEqual([['hook', 0, 120], ['trace', 120, 300], ['fix', 300, 480], ['end', 480, 624]]);
    expect(doc.sfx.map((cue) => cue.at.sec)).toEqual([6, 10, 17]);
    const table = readFileSync(path.join(root, 'plan', 'beatgrid.md'), 'utf8');
    expect(result.json.data.table).toBe(table);
    expect(table).toContain('| Shot | Time (s) | On screen | Motion | Sound |');
    expect(table).toContain('| trace | 4.0-10.0 | The trace tree opens; the failing step turns red (screen) | push in on the failing span | build, click on the span |');
    expect(table).toContain('| end | 16.0-20.8 |');
    const shown = readEvents(root).filter((event) => event.type === 'plan.shown');
    expect(shown.map((event) => event.data)).toEqual([{ subject: 'beatgrid', planHash: result.json.data.planHash }]);
    expect(result.stderr).toMatch(/scene ids are not checked \(G005\)/);
  });

  it('a gap between shots fails G004', async () => {
    const grid = structuredClone(fixtureGrid);
    grid.shots[2].from = 'bar6.2';
    const result = await mfm(project(grid), 'beatgrid', 'check');
    expect(result.code).toBe(1);
    expect(codes(result.json.data)).toEqual(['G004']);
    expect(result.json.data.problems[0]).toMatchObject({ at: 'shots[2].from', message: expect.stringMatching(/^Gap between shots\[1\]/) });
    expect(result.json.data.resolved).toBeNull();
    expect(existsSync(path.join(project(grid), 'plan', 'beatgrid.resolved.json'))).toBe(false);
  });

  it('two drops fail G003', async () => {
    const grid = structuredClone(fixtureGrid);
    grid.sections[1].drop = true;
    const result = await mfm(project(grid), 'beatgrid', 'check');
    expect(result.code).toBe(1);
    expect(codes(result.json.data)).toEqual(['G003']);
    expect(result.json.data.problems[0].message).toMatch(/At most one section may drop/);
  });

  it('a cue cycle fails G007', async () => {
    const grid = structuredClone(fixtureGrid);
    grid.cues.reveal = '@fail-4b';
    const result = await mfm(project(grid), 'beatgrid', 'check');
    expect(result.code).toBe(1);
    expect(codes(result.json.data)).toContain('G007');
    expect(result.json.data.problems.find((problem: { code: string }) => problem.code === 'G007').message).toMatch(/cycle: @reveal -> @fail -> @reveal|cycle: @fail -> @reveal -> @fail/);
  });

  it('a genre that is not a preset, a wrong length and a second hit fail G001, G002 and G006', async () => {
    const grid = structuredClone(fixtureGrid);
    grid.genre = 'polka';
    grid.requestedSec = 25;
    grid.sfx.push({ role: 'hit', at: '@logo', event: 'logo' });
    const result = await mfm(project(grid), 'beatgrid', 'check');
    expect(codes(result.json.data).sort()).toEqual(['G001', 'G002', 'G006']);
  });

  it('an edit to beatgrid.json after approval makes the approval stale for film build', async () => {
    const root = project();
    expect((await mfm(root, 'beatgrid', 'check')).code).toBe(0);
    expect((await mfm(root, 'status')).json.data).toMatchObject({ phase: 'awaiting-approval' });
    const approved = await mfm(root, 'approve', '--subject', 'beatgrid', '--text', 'Looks right, go ahead.');
    expect(approved.code, JSON.stringify(approved.json)).toBe(0);
    const before = (await mfm(root, 'status')).json.data;
    expect(before.phase).toBe('approved');
    expect(before.nextAllowed).toEqual(expect.arrayContaining(['film build', 'score']));

    const grid = structuredClone(fixtureGrid);
    grid.shots[0].intent = 'Headline types in, a little slower';
    writeFileSync(path.join(root, 'plan', 'beatgrid.json'), `${JSON.stringify(grid, null, 2)}\n`);
    const after = (await mfm(root, 'status')).json.data;
    expect(after.phase).toBe('awaiting-approval');
    expect(after.nextAllowed).not.toContain('film build');
    expect(after.nextAllowed).not.toContain('score');
    expect(after.nextAllowed).toEqual(expect.arrayContaining(['approve', 'beatgrid check']));
    // The old approval no longer covers the edited grid: approve wants it shown again.
    expect((await mfm(root, 'approve', '--subject', 'beatgrid', '--text', 'ok')).code).toBe(4);
    expect((await mfm(root, 'beatgrid', 'check')).code).toBe(0);
    expect((await mfm(root, 'approve', '--subject', 'beatgrid', '--text', 'Yes, the slower start.')).code).toBe(0);
    const again = (await mfm(root, 'status')).json.data;
    expect(again.phase).toBe('approved');
    expect(again.nextAllowed).toContain('film build');
  });
});

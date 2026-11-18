import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { defaultProfile } from '../../../../src/cloud/consent';
import { packageRoot } from '../../../../src/engine/index';
import { planHash, readEvents } from '../../../../src/paths/index';
import type { Placement } from '../../../../src/moves/placement';
import { writeDoc } from '../../../../src/schemas/index';
import { runIn } from '../../../unit/cli/harness';

let root: string;
let home: string;
const planFile = () => path.join(root, 'plan', 'placement.json');
const table = () => path.join(root, 'plan', 'placement.md');

beforeEach(() => {
  const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mfm-placement-check-')));
  root = path.join(scratch, 'project');
  home = path.join(scratch, 'home');
  cpSync(path.join(packageRoot(), 'test/fixtures/projects/moves'), root, { recursive: true });
});

function cli(...args: string[]) {
  return runIn([...args, '--project', root, '--home', home, '--json'], COMMANDS, process.env);
}

function edit(change: (plan: Placement) => void) {
  const plan = JSON.parse(readFileSync(planFile(), 'utf8')) as Placement;
  change(plan);
  writeFileSync(planFile(), `${JSON.stringify(plan, null, 2)}\n`);
}

it('shows the placement table and records the exact plan hash for approval', async () => {
  const result = await cli('placement', 'check');
  const hash = planHash(planFile());
  expect(result.code, result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).data).toMatchObject({ items: [{ id: 'p01' }, { id: 'p02' }, { id: 'p03' }], problems: [], planHash: hash });
  const text = readFileSync(table(), 'utf8');
  expect(text).toContain('| p01 | 0:00.5 | title-lockup | Tessarine title and mark | "Meet Tessarine" |');
  expect(text.trimEnd()).toMatch(/Reply yes to render these, or tell me what to change\.$/);
  expect(readEvents(root).at(-1)).toMatchObject({ type: 'plan.shown', data: { subject: 'placement', planHash: hash } });
});

it.each([
  ['P001', (plan: Placement) => { plan.items[1]!.move = 'unlisted-move'; }],
  ['P003', (plan: Placement) => { plan.items[1]!.vars.keyword = 'Too long for this label'; }],
  ['P004', (plan: Placement) => { plan.items[1]!.durSec = 2; }],
  ['P005', (plan: Placement) => { plan.items[1]!.at = 2.48; }],
  ['P006', (plan: Placement) => { plan.items[2]!.at = 14; }],
  ['P007', (plan: Placement) => { plan.items[1]!.say = 'Four unrelated words here'; }],
  ['P008', (plan: Placement) => { plan.items[1]!.id = 'p01'; }],
  ['P009', (plan: Placement) => { plan.items[1]!.move = 'title-lockup'; }],
] as const)('flags %s before showing an invalid plan', async (code, change) => {
  edit(change);
  const result = await cli('placement', 'check');
  expect(result.code, result.stdout).toBe(1);
  expect(JSON.parse(result.stdout).data.problems).toContainEqual(expect.objectContaining({ code }));
  expect(existsSync(table())).toBe(false);
  expect(readEvents(root)).toHaveLength(1);
});

it('requires the overlay mode selected by the export format and leaves b-roll opaque', async () => {
  edit((plan) => { plan.mode = 'key'; });
  let result = await cli('placement', 'check');
  expect(result.code, result.stdout).toBe(1);
  expect(JSON.parse(result.stdout).data.problems).toEqual([
    { id: 'p01', code: 'P002', message: 'Profile export mov requires placement mode alpha for overlays.' },
    { id: 'p02', code: 'P002', message: 'Profile export mov requires placement mode alpha for overlays.' },
  ]);
  expect(existsSync(table())).toBe(false);
  writeDoc('profile', path.join(home, 'profile.json'), { ...defaultProfile(), overlayExport: 'key-mp4' });
  result = await cli('placement', 'check');
  expect(result.code, result.stdout).toBe(0);
  edit((plan) => { plan.mode = 'alpha'; });
  result = await cli('placement', 'check');
  expect(result.code, result.stdout).toBe(1);
  expect(JSON.parse(result.stdout).data.problems).toContainEqual({
    id: 'p01', code: 'P002', message: 'Profile export key-mp4 requires placement mode key for overlays.',
  });
});

it('rejects a move in an aspect outside its declared overlay aspects', async () => {
  const file = path.join(root, 'project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  writeDoc('project', file, { ...project, aspect: '1:1', width: 1080, height: 1080 });
  edit((plan) => {
    plan.aspect = '1:1';
    plan.items[0]!.move = 'message-cascade';
  });
  const result = await cli('placement', 'check');
  expect(result.code, result.stdout).toBe(1);
  expect(JSON.parse(result.stdout).data.problems).toContainEqual({
    id: 'p01', code: 'P002', message: 'message-cascade does not support 1:1 overlay in alpha mode.',
  });
});

it('refuses a missing or stale approval before creating render output', async () => {
  expect((await cli('placement', 'check')).code).toBe(0);
  let result = await cli('moves', 'render');
  expect(result.code).toBe(4);
  expect(JSON.parse(result.stdout).error.code).toBe('APPROVAL_MISSING');
  const approved = await cli('approve', '--subject', 'placement', '--text', 'Yes, render these.');
  expect(approved.code, approved.stdout).toBe(0);
  edit((plan) => { plan.items[0]!.reason = 'An edited reason'; });
  result = await cli('moves', 'render', '--only', 'p02');
  expect(result.code).toBe(4);
  expect(JSON.parse(result.stdout).error.code).toBe('APPROVAL_STALE');
  expect(existsSync(path.join(root, 'moves'))).toBe(false);
});

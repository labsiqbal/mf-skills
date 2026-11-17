// film brief: answers set key by key, missing fields reported, values checked
// against the brief schema, plan/brief.md rendered; and the film fixture project.
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { INTERVIEW_QUESTIONS, renderBriefMd } from '../../../../src/film/brief';
import { NUMBERS } from '../../../../src/kit/numbers';
import { readDoc } from '../../../../src/schemas/index';
import { runIn } from '../../../unit/cli/harness';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/projects/film');
const temp = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));

async function mfm(project: string, ...args: string[]) {
  const result = await runIn([...args, '--project', project, '--json'], COMMANDS, {});
  return { code: result.code, json: JSON.parse(result.stdout) as Record<string, any> };
}

async function newProject(type: 'film' | 'moves', aspect = '9:16'): Promise<string> {
  const home = temp('mfm-home-');
  const dir = path.join(temp('mfm-brief-'), 'p');
  const result = await runIn(['new', 'Brief test', '--type', type, '--aspect', aspect, '--dir', dir, '--home', home, '--json'], COMMANDS, {});
  expect(result.code, result.stdout).toBe(0);
  return dir;
}

describe('film brief', () => {
  it('--check on an empty brief lists the missing fields and the questions that fill them', async () => {
    const project = await newProject('film');
    const result = await mfm(project, 'film', 'brief', '--check');
    expect(result.code).toBe(0);
    expect(result.json.data.missing).toEqual(['purpose', 'audience', 'lengthSec', 'signatureMoment']);
    expect(result.json.data.brief).toMatchObject({ kind: 'brief', aspect: '9:16' });
    expect(result.json.data.questions).toEqual([INTERVIEW_QUESTIONS[0].text, INTERVIEW_QUESTIONS[1].text, INTERVIEW_QUESTIONS[3].text]);
    expect(result.json.next).toHaveLength(1);
    expect(readFileSync(path.join(project, 'plan', 'brief.md'), 'utf8')).toContain('Status: missing purpose, audience, lengthSec, signatureMoment.');
    expect(INTERVIEW_QUESTIONS.length).toBeLessThanOrEqual(NUMBERS['interview.maxQuestions']);
  });

  it('--set lengthSec=45 fails validation and leaves the brief unchanged', async () => {
    const project = await newProject('film');
    await mfm(project, 'film', 'brief', '--set', 'lengthSec=20');
    const before = readFileSync(path.join(project, 'plan', 'brief.json'), 'utf8');
    const result = await mfm(project, 'film', 'brief', '--set', 'lengthSec=45');
    expect(result.code).toBe(2);
    expect(result.json.error).toMatchObject({ code: 'SCHEMA_INVALID', details: { key: 'lengthSec', value: 45 } });
    expect(result.json.error.message).toContain('10-30 s, default 20');
    expect(readFileSync(path.join(project, 'plan', 'brief.json'), 'utf8')).toBe(before);
    expect((await mfm(project, 'film', 'brief', '--set', 'colour=red')).json.error.code).toBe('USAGE');
    expect((await mfm(project, 'film', 'brief', '--set', 'purpose')).json.error.code).toBe('USAGE');
    expect((await mfm(project, 'film', 'brief', '--set', 'voiceover=loud')).json.error.code).toBe('SCHEMA_INVALID');
  });

  it('a full brief validates, gets answeredAt and renders brief.md', async () => {
    const project = await newProject('film', '16:9');
    const result = await mfm(
      project, 'film', 'brief',
      '--set', 'purpose=Make engineers trace their next run.',
      '--set', 'audience=Engineers who ship agents',
      '--set', 'lengthSec=15s',
      '--set', 'signatureMoment=The red step turns green',
      '--set', 'mustSay=["Every step, traced", "Cost per run"]',
      '--set', 'captions=true',
      '--set', 'theme=null',
      '--check',
    );
    expect(result.code, JSON.stringify(result.json)).toBe(0);
    expect(result.json.data.missing).toEqual([]);
    const { doc } = readDoc('brief', path.join(project, 'plan', 'brief.json'));
    expect(doc).toMatchObject({ lengthSec: 15, aspect: '16:9', captions: true, theme: null, mustSay: ['Every step, traced', 'Cost per run'], voiceover: 'none', music: 'synth' });
    expect(doc.answeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readFileSync(path.join(project, 'plan', 'brief.md'), 'utf8')).toContain('- Captions: yes');
  });

  it('refuses a moves project', async () => {
    const project = await newProject('moves');
    expect((await mfm(project, 'film', 'brief', '--check')).json.error.code).toBe('USAGE');
  });
});

describe('film fixture project', () => {
  it('is a schema-valid 20 s Tessarine film with a complete brief and its rendering', async () => {
    expect(readDoc('project', path.join(fixture, 'project.json')).doc).toMatchObject({ type: 'film', brand: 'tessarine', theme: null, aspect: '16:9' });
    const { doc } = readDoc('brief', path.join(fixture, 'plan', 'brief.json'));
    expect(doc).toMatchObject({ lengthSec: 20, theme: null });
    expect(readFileSync(path.join(fixture, 'plan', 'brief.md'), 'utf8')).toBe(renderBriefMd(doc as never, []));
    const copy = path.join(temp('mfm-fixture-'), 'film');
    cpSync(fixture, copy, { recursive: true });
    const check = await mfm(copy, 'film', 'brief', '--check');
    expect(check.json.data.missing).toEqual([]);
    expect(readFileSync(path.join(copy, 'plan', 'brief.json'), 'utf8')).toBe(readFileSync(path.join(fixture, 'plan', 'brief.json'), 'utf8'));
    expect(existsSync(path.join(copy, 'events.jsonl'))).toBe(true);
  });
});

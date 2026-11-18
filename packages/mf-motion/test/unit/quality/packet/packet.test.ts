// The judge packet builder on a film round: deterministic hash, a sheet byte
// changes it, facts.md carries no plan prose or notes, a missing dense sheet
// fails PACKET_MISSING, and oversized images are brought within the budget.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { probe } from '../../../../src/media/probe';
import { buildPacket } from '../../../../src/quality/packet';
import { PACKET_BUDGET, packetHash } from '../../../../src/quality/packetSpec';
import { readDoc } from '../../../../src/schemas/index';
import { testBrowser } from '../../../helpers/engine';
import { runIn } from '../../cli/harness';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../../../fixtures');
const SENTINEL = { storyline: 'Storyline-sentinel: a lighthouse keeper', brief: 'Brief-prose-sentinel', notes: 'Agent-note-sentinel: make it pop' };

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

const image = (out: string, size: string, source = 'testsrc2') => ffmpeg(['-f', 'lavfi', '-i', `${source}=size=${size}:rate=1:duration=1`, '-frames:v', '1', out]);

let project = '';
let round = '';

beforeEach(() => {
  project = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-packet-')), 'film');
  cpSync(path.join(fixtures, 'projects', 'film'), project, { recursive: true });
  writeFileSync(path.join(project, 'plan', 'storylines.md'), `# Storylines\n\n1. ${SENTINEL.storyline}\n`);
  writeFileSync(path.join(project, 'plan', 'brief.md'), `${readFileSync(path.join(project, 'plan', 'brief.md'), 'utf8')}\n${SENTINEL.brief}\n`);
  round = path.join(project, 'rounds', '1');
  mkdirSync(round, { recursive: true });
  writeFileSync(path.join(round, 'notes.md'), `${SENTINEL.notes}\n`);
  cpSync(path.join(fixtures, 'packets', 'film-round', 'metrics.json'), path.join(round, 'metrics.json'));
  image(path.join(round, 'beats.jpg'), '1280x480');
  image(path.join(round, 'seams-01.jpg'), '1280x160');
  image(path.join(round, 'phone.jpg'), '1152x279');
  image(path.join(round, 'dense.png'), '1364x960');
  image(path.join(round, 'brand-card.png'), '1200x600', 'smptebars');
  image(path.join(round, 'finding-01.png'), '480x300');
});

const film = () => ({ roundDir: round, unit: { type: 'film' as const, id: 'tessarine-launch-lmut', version: null }, purpose: readDoc('brief', path.join(project, 'plan', 'brief.json')).doc.purpose });

describe('packet', () => {
  it('gives the same hash for unchanged inputs and a valid packet.json', async () => {
    const first = await buildPacket(film());
    const second = await buildPacket(film());
    expect(second.hash).toBe(first.hash);
    expect(second.files).toEqual(first.files);
    const { doc } = readDoc('judge-packet', path.join(round, 'packet', 'packet.json'));
    expect(doc.hash).toBe(first.hash);
    expect(packetHash(doc as unknown as Record<string, unknown>)).toBe(first.hash);
    expect(doc.files.map((file) => file.path)).toEqual(['beats.jpg', 'brand-card.png', 'dense.png', 'facts.md', 'finding-01.png', 'phone.png', 'seams-01.jpg']);
    expect(doc.target).toBe(8);
    expect(doc.builder).toEqual({ provider: null, modelId: null });
    // The engine phone sheet (JPEG) is written under the role's PNG name.
    expect((await probe(path.join(round, 'packet', 'phone.png'))).video?.codec).toBe('png');
    expect(first.instruction).toContain(`packetHash set to ${first.hash}`);
  });

  it('changes the hash when one sheet byte changes', async () => {
    const before = await buildPacket(film());
    const dense = path.join(round, 'dense.png');
    const bytes = readFileSync(dense);
    // A byte inside the PNG's last data chunk, before IEND's 12 bytes.
    const at = bytes.length - 20;
    bytes[at] = ((bytes[at] ?? 0) + 1) % 256;
    writeFileSync(dense, bytes);
    const after = await buildPacket(film());
    expect(after.hash).not.toBe(before.hash);
  });

  it('writes facts.md from measurements and the purpose only', async () => {
    await buildPacket(film());
    const facts = readFileSync(path.join(round, 'packet', 'facts.md'), 'utf8');
    for (const sentinel of Object.values(SENTINEL)) expect(facts).not.toContain(sentinel);
    expect(facts).toContain('purpose: Make AI engineers want to trace their next agent run in Tessarine.');
    expect(facts).toContain('unit type: film');
    expect(facts).toContain('| duration | hard | 4 s | 4 s +-1 frame | pass |');
    expect(facts).toContain('rubric target: 8 on every axis');
  });

  it('fails PACKET_MISSING without a dense sheet', async () => {
    rmSync(path.join(round, 'dense.png'));
    await expect(buildPacket(film())).rejects.toMatchObject({ code: 'PACKET_MISSING', details: { missing: ['dense'] } });
    const result = await runIn(['packet', '--project', project, '--json'], COMMANDS, {});
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stdout).error.code).toBe('PACKET_MISSING');
  });

  it('downscales images over 2048 px and 1.5 MB within the budget', async () => {
    // Noise does not compress: about 12 MB as PNG at this size.
    ffmpeg(['-f', 'lavfi', '-i', 'nullsrc=size=2600x1600:rate=1:duration=1', '-vf', "geq=r='random(1)*255':g='random(2)*255':b='random(3)*255'", '-frames:v', '1', path.join(round, 'dense.png')]);
    expect(statSync(path.join(round, 'dense.png')).size).toBeGreaterThan(PACKET_BUDGET.maxBytes);
    const result = await buildPacket(film());
    const dense = result.files.find((file) => file.path === 'dense.png');
    expect(dense?.bytes).toBeLessThanOrEqual(PACKET_BUDGET.maxBytes);
    const info = await probe(path.join(round, 'packet', 'dense.png'));
    expect(Math.max(info.video?.width ?? 0, info.video?.height ?? 0)).toBeLessThanOrEqual(PACKET_BUDGET.maxEdgePx);
    // And again: the downscaled file is the same, so the hash is too.
    expect((await buildPacket(film())).hash).toBe(result.hash);
  }, 60_000);

  it('keeps at most 8 images, leaving out finding crops first', async () => {
    for (let i = 2; i <= 6; i += 1) image(path.join(round, `finding-0${i}.png`), '480x300');
    const result = await buildPacket(film());
    const images = result.files.filter((file) => file.role !== 'facts');
    expect(images).toHaveLength(PACKET_BUDGET.maxImages);
    expect(result.dropped).toEqual(['finding-04.png', 'finding-05.png', 'finding-06.png']);
  });

  it('draws brand-card.png from the project brand when the round has none', async () => {
    rmSync(path.join(round, 'brand-card.png'));
    const brandDir = path.join(project, 'brand');
    cpSync(path.join(fixtures, '..', '..', 'assets', 'demo-brands', 'mossmallow'), brandDir, { recursive: true });
    const { engine, browserPath } = await testBrowser();
    const result = await buildPacket({ ...film(), brandDir, engine, browserPath });
    const card = result.files.find((file) => file.role === 'brand-card');
    expect(card?.path).toBe('brand-card.png');
    const info = await probe(path.join(round, 'packet', 'brand-card.png'));
    expect(info.video?.width).toBe(1200);
    expect(readdirSync(path.join(round, 'packet')).filter((name) => name.startsWith('.'))).toEqual([]);
  }, 600_000);

  it('packet --round returns { dir, hash, files } and the three judge routes', async () => {
    const result = await runIn(['packet', '--project', project, '--round', '1', '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    const envelope = JSON.parse(result.stdout) as { data: { dir: string; hash: string; files: unknown[]; instruction: string }; next: string[] };
    expect(envelope.data.dir).toBe(path.join(round, 'packet'));
    expect(envelope.data.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.data.files).toHaveLength(7);
    expect(envelope.data.instruction).toContain('You are judging one piece of motion design.');
    expect(envelope.next).toHaveLength(3);
    expect(envelope.next.join('\n')).toMatch(/fresh-context subagent[\s\S]*this session[\s\S]*gate --no-vision/);
  });
});

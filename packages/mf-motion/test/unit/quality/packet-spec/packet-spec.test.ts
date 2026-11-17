// The judge packet contract: roles per unit type, budget, canonical hash,
// facts.md and the judge instruction (verbatim from judge-packet.md).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKET_BUDGET,
  canonicalJson,
  checkBudget,
  judgeInstructionTemplate,
  missingRoles,
  packetFiles,
  packetHash,
  renderFacts,
  renderInstruction,
  roleOf,
} from '../../../../src/quality/packetSpec';

const HASH = 'a'.repeat(64);
const manifest = {
  schemaVersion: 1,
  kind: 'judge-packet',
  unit: { type: 'move', id: 'title-lockup', version: '1.0.0' },
  profile: 'overlay-alpha',
  aspect: '16:9',
  mode: 'alpha',
  target: 8,
  rubricVersion: '1.0.0',
  builder: { provider: null, modelId: null },
  files: [{ role: 'phone', path: 'phone.png', sha256: 'b'.repeat(64), bytes: 1200 }],
  metrics: { path: '../metrics.json', sha256: 'c'.repeat(64) },
  hash: '',
};

describe('packetFiles', () => {
  it('requires plates.png for an overlay-alpha move and beats and seams for a film', () => {
    expect(packetFiles('move', 'overlay-alpha').required).toEqual(['phone', 'dense', 'plates', 'brand-card', 'facts']);
    expect(packetFiles('move', 'overlay-key').required).not.toContain('plates');
    expect(packetFiles('move', 'broll').required).not.toContain('beats');
    expect(packetFiles('film', 'film').required).toEqual(['beats', 'seams', 'phone', 'dense', 'brand-card', 'facts']);
    expect(packetFiles('theme', 'film', { lab: true }).required).toContain('neighbours');
    expect(packetFiles('film', 'film', { lab: true }).required).not.toContain('neighbours');
    expect(packetFiles('film', 'film').whenPresent).toEqual(['finding']);
  });

  it('maps file names to roles and reports missing roles', () => {
    expect(['beats.jpg', 'seams-03.jpg', 'finding-06.png', 'neighbours-01.png', 'facts.md', 'brand-card.png'].map(roleOf)).toEqual(['beats', 'seams', 'finding', 'neighbours', 'facts', 'brand-card']);
    expect(roleOf('seams-3.jpg')).toBeNull();
    expect(missingRoles(packetFiles('film', 'film'), ['beats.jpg', 'phone.png', 'dense.png', 'brand-card.png', 'facts.md'])).toEqual(['seams']);
  });
});

describe('budget', () => {
  const image = (i: number, change: Partial<{ width: number; height: number; bytes: number }> = {}) => ({ path: `img-${i}.png`, width: 1600, height: 900, bytes: 400_000, ...change });

  it('passes 8 images within limits and fails a 9-image packet or a 2 MB image', () => {
    expect(checkBudget(Array.from({ length: 8 }, (_, i) => image(i)))).toEqual([]);
    expect(checkBudget(Array.from({ length: 9 }, (_, i) => image(i)))).toEqual([{ path: null, problem: 'too-many-images', value: 9, limit: 8 }]);
    expect(checkBudget([image(1, { bytes: 2 * 1024 * 1024 })])).toEqual([{ path: 'img-1.png', problem: 'too-large', value: 2097152, limit: PACKET_BUDGET.maxBytes }]);
    expect(checkBudget([image(1, { height: 2400 })])[0]?.problem).toBe('too-long-edge');
  });
});

describe('packetHash', () => {
  it('hashes the same manifest in any key order identically, ignoring hash', () => {
    const reverse = (value: unknown): unknown =>
      Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
    const reordered = reverse(manifest) as Record<string, unknown>;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(manifest));
    expect(Object.keys(reordered)[0]).toBe('hash');
    expect(packetHash(reordered)).toBe(packetHash(manifest));
    expect(packetHash({ ...manifest, hash: 'anything' })).toBe(packetHash(manifest));
    expect(packetHash({ ...manifest, target: 9 })).not.toBe(packetHash(manifest));
    expect(packetHash(manifest)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes canonical JSON: sorted keys at every level, arrays in order, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x y' } })).toBe('{"a":{"c":"x y","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe('judge instruction', () => {
  it('fills the target and the hash and changes nothing else', () => {
    const template = judgeInstructionTemplate();
    expect(template.match(/\{target\}/g)).toHaveLength(1);
    expect(template.match(/\{hash\}/g)).toHaveLength(1);
    const text = renderInstruction(8, HASH);
    expect(text).toContain('For every axis below 8, write at least one fix');
    expect(text).toContain(`packetHash set to ${HASH}.`);
    expect(text).toBe(template.replace('{target}', '8').replace('{hash}', HASH));
    expect(() => renderInstruction(8, 'not-a-hash')).toThrow();
  });

  const docs = process.env.MFM_SPEC_DOCS;
  it.runIf(docs)('is the judge-packet.md instruction verbatim', () => {
    const doc = readFileSync(path.join(docs ?? '', 'judge-packet.md'), 'utf8');
    const block = doc.split('## Judge instruction')[1]?.split('```')[1]?.replace(/^\n/, '');
    expect(judgeInstructionTemplate()).toBe(block);
  });
});

describe('facts.md', () => {
  it('lists the fields of judge-packet.md as plain lines and a facts table', () => {
    const text = renderFacts({
      unitType: 'move',
      profile: 'overlay-alpha',
      aspect: '9:16',
      mode: 'alpha',
      durationSec: 3.2,
      target: 8,
      oneLiner: 'Logo mark and headline lock up with a wipe.',
      say: ['here is who we are', 'meet the team', 'third trigger stays out'],
      facts: [
        { check: 'duration', kind: 'hard', value: '3.2 s', limit: '3.2 s +-1 frame', result: 'pass' },
        { check: 'engine-warnings', kind: 'cap', value: 3, limit: '3 or more', result: 'capped', cap: { axis: 'finish', cap: 8 } },
      ],
    });
    expect(text).toBe(
      [
        '# Facts',
        '',
        'unit type: move',
        'profile: overlay-alpha',
        'aspect: 9:16',
        'mode: alpha',
        'duration: 3.2 s',
        'one-liner: Logo mark and headline lock up with a wipe.',
        'say: here is who we are',
        'say: meet the team',
        'rubric target: 8 on every axis',
        '',
        '| check | kind | value | limit | result |',
        '|---|---|---|---|---|',
        '| duration | hard | 3.2 s | 3.2 s +-1 frame | pass |',
        '| engine-warnings | cap | 3 | 3 or more | capped: finish at most 8 |',
        '',
      ].join('\n'),
    );
    expect(renderFacts({ unitType: 'film', profile: 'film', aspect: '16:9', mode: 'full', durationSec: 20, target: 8, purpose: 'Show the new trace view.', facts: [] })).toContain('purpose: Show the new trace view.');
  });
});

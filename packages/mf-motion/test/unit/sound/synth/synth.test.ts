// The synth: no transcendental Math in src/sound, accurate polynomial maths,
// byte-identical WAV for the same grid, seed and preset, a different hash for
// another seed, 48 kHz stereo 24-bit output, and the score command.
// MFM_SYNTH_HASHES=<file> writes the fixture hashes for the cross-OS CI job.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { type ScoreGrid, SAMPLE_RATE, TABLE_SIZE, encodeWav24, exp2, renderScore, sin, sineTable4096, tableFor } from '../../../../src/sound/synth/index';
import { runIn } from '../../cli/harness';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const gridsDir = path.join(packageRoot, 'test', 'fixtures', 'grids');
const grids = readdirSync(gridsDir).filter((name) => name.endsWith('.json')).sort();
const loadGrid = (name: string) => JSON.parse(readFileSync(path.join(gridsDir, name), 'utf8')) as ScoreGrid & { seed: number; lengthSec: number };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));
}

describe('static scan', () => {
  it('src/sound uses no transcendental Math function and no ** operator', () => {
    const files = walk(path.join(packageRoot, 'src', 'sound')).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    const forbidden = /Math\.(sin|cos|tan|exp|expm1|pow|log|log2|log10|log1p|sinh|cosh|tanh|asin|acos|atan|atan2|cbrt|hypot)\b|\*\*/;
    // Comments are blanked line for line so reported line numbers stay right.
    const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
    const hits = files.flatMap((file) =>
      code(file)
        .split('\n')
        .map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), at: `${path.relative(packageRoot, file)}:${i + 1}` }))
        .filter(({ line }) => forbidden.test(line))
        .map(({ at }) => at),
    );
    expect(hits).toEqual([]);
  });
});

describe('polynomial maths', () => {
  it('sin and exp2 match the platform functions closely', () => {
    let sinError = 0;
    for (let x = -20; x <= 20; x += 0.0137) sinError = Math.max(sinError, Math.abs(sin(x) - Math.sin(x)));
    expect(sinError).toBeLessThan(1e-11);
    let expError = 0;
    for (let x = -30; x <= 30; x += 0.0173) expError = Math.max(expError, Math.abs(exp2(x) / 2 ** x - 1));
    expect(expError).toBeLessThan(1e-12);
    expect(exp2(3)).toBe(8);
    expect(exp2(-1)).toBe(0.5);
  });

  it('builds 4096-sample tables, band-limited per octave', () => {
    expect(sineTable4096()).toHaveLength(TABLE_SIZE);
    const low = tableFor('saw', 55, SAMPLE_RATE);
    const high = tableFor('saw', 5000, SAMPLE_RATE);
    expect(low).not.toBe(high);
    expect(Math.max(...Array.from(high, Math.abs))).toBeCloseTo(1, 9);
  });
});

describe('renderScore', () => {
  const rendered = new Map<string, string>();

  it('renders the same grid, seed and preset to the same bytes twice', () => {
    const hashes: Record<string, string> = {};
    for (const name of grids) {
      const grid = loadGrid(name);
      const first = encodeWav24(renderScore(grid, { seed: grid.seed }), SAMPLE_RATE);
      const second = encodeWav24(renderScore(grid, { seed: grid.seed }), SAMPLE_RATE);
      expect(sha(second), name).toBe(sha(first));
      hashes[name] = sha(first);
      rendered.set(name, sha(first));
    }
    if (process.env.MFM_SYNTH_HASHES) writeFileSync(process.env.MFM_SYNTH_HASHES, `${JSON.stringify(hashes, null, 2)}\n`);
    console.log(`synth hashes ${JSON.stringify(hashes)}`);
  }, 300_000);

  it('a different seed changes the hash', () => {
    const grid = loadGrid('drive-120-4x4.json');
    expect(sha(encodeWav24(renderScore(grid, { seed: grid.seed + 1 }), SAMPLE_RATE))).not.toBe(rendered.get('drive-120-4x4.json'));
  }, 120_000);

  it('writes 48 kHz stereo 24-bit PCM of the grid length, loud but unclipped', () => {
    const grid = loadGrid('waltz-100-3x4.json');
    const [left, right] = renderScore(grid, { seed: grid.seed });
    expect(left.length).toBe(Math.round(grid.lengthSec * SAMPLE_RATE));
    expect(right.length).toBe(left.length);
    let peak = 0;
    let energy = 0;
    for (const channel of [left, right]) {
      for (const value of channel) {
        expect(Number.isFinite(value)).toBe(true);
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.2);
    expect(Math.sqrt(energy / (left.length * 2))).toBeGreaterThan(0.02);
    const wav = Buffer.from(encodeWav24([left, right], SAMPLE_RATE));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    const fmt = wav.indexOf('fmt ');
    expect([wav.readUInt16LE(fmt + 8), wav.readUInt16LE(fmt + 10), wav.readUInt32LE(fmt + 12), wav.readUInt16LE(fmt + 22)]).toEqual([1, 2, 48000, 24]);
    const data = wav.indexOf('data');
    expect(wav.readUInt32LE(data + 4)).toBe(left.length * 2 * 3);
  }, 120_000);
});

describe('score command', () => {
  it('writes sound/score-raw.wav from the project grid', async () => {
    const project = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-score-')), 'film');
    cpSync(path.join(packageRoot, 'test', 'fixtures', 'projects', 'film'), project, { recursive: true });
    const noGrid = await runIn(['score', '--project', project, '--json'], COMMANDS, {});
    expect(JSON.parse(noGrid.stdout).error.code).toBe('GRID_REQUIRED');
    cpSync(path.join(gridsDir, 'calm-96-4x4.json'), path.join(project, 'plan', 'beatgrid.resolved.json'));
    const result = await runIn(['score', '--project', project, '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data).toMatchObject({ raw: path.join(project, 'sound', 'score-raw.wav'), sampleRate: 48000, channels: 2, bitDepth: 24, bpm: 96, seed: 7, preset: 'test-basic', seconds: 20.8 });
    expect(sha(readFileSync(data.raw))).toBe(data.sha256);
    const grid = loadGrid('calm-96-4x4.json');
    expect(data.sha256).toBe(sha(encodeWav24(renderScore(grid, { seed: 7 }), SAMPLE_RATE)));
  }, 120_000);
});

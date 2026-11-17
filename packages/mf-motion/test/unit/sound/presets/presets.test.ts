// Genre presets and the arrangement: instruments enter at the energy.*
// thresholds, the voicing or chord changes every 4 bars, fills, risers, drops
// and the end card follow their rules, every preset renders without clipping,
// and themes may only narrow a preset.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { NUMBERS } from '../../../../src/kit/numbers';
import { type Arrangement, type Role, arrange, chordFor, narrowPreset, parseKey, renderArrangement } from '../../../../src/sound/arrange';
import { GENRE_IDS, GENRE_PRESETS } from '../../../../src/sound/presets/index';
import { type ScoreGrid, SAMPLE_RATE, encodeWav24 } from '../../../../src/sound/synth/index';
import { runIn } from '../../cli/harness';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(path.join(here, name), 'utf8')) as ScoreGrid & { seed: number; genre: string };
const roleBars = (arrangement: Arrangement, role: Role) => arrangement.bars.filter((bar) => bar.instruments.includes(role)).map((bar) => bar.bar);
const firstBar = (arrangement: Arrangement, role: Role) => roleBars(arrangement, role)[0] ?? null;

describe('presets', () => {
  it('has the ten presets of sound.md with their BPM ranges, keys and 3-6 progressions', () => {
    const table: Record<string, [number, number]> = {
      'driving-electronic': [118, 128], 'warm-house': [112, 122], 'lofi-keys': [80, 92], 'cinematic-pulse': [90, 110], 'minimal-tech': [100, 120],
      'playful-pluck': [100, 112], 'ambient-glass': [70, 90], 'indie-pop': [104, 118], 'dark-pulse': [95, 110], 'orchestral-hybrid': [84, 100],
    };
    expect(GENRE_IDS.sort()).toEqual(Object.keys(table).sort());
    for (const [id, [min, max]] of Object.entries(table)) {
      const preset = GENRE_PRESETS[id];
      expect(preset?.bpm, id).toEqual({ min, max });
      expect(preset?.progressions.length, id).toBeGreaterThanOrEqual(3);
      expect(preset?.progressions.length, id).toBeLessThanOrEqual(6);
      for (const { key } of preset?.keys ?? []) {
        const { minor } = parseKey(key);
        for (const progression of preset?.progressions ?? []) for (const degree of progression) expect(chordFor(degree, minor, preset?.sevenths ?? false).length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(parseKey('F-sharp minor')).toEqual({ tonic: 6, minor: true });
    expect(parseKey('E-flat major')).toEqual({ tonic: 3, minor: false });
    expect(chordFor('VI', true, false)).toEqual([8, 12, 15]);
    expect(chordFor('V7', false, false)).toEqual([7, 11, 14, 17]);
  });
});

describe('arrange', () => {
  const preset = GENRE_PRESETS['driving-electronic'];
  if (!preset) throw new Error('missing preset');

  it('on the 0.2 / 0.5 / 0.9 grid, instruments enter by energy', () => {
    const arrangement = arrange(load('grid-20s.json'), preset, 3);
    expect(arrangement.lengthSec).toBe(20);
    // Bars 0-2 at 0.2, bars 3-5 at 0.5 (riser), bars 6-9 at 0.9 (drop).
    expect(arrangement.bars.slice(0, 3).every((bar) => bar.instruments.join() === 'pad')).toBe(true);
    for (const role of ['hat', 'bass', 'kick'] as const) expect(firstBar(arrangement, role), role).toBe(3);
    for (const role of ['pluck', 'clap'] as const) expect(firstBar(arrangement, role), role).toBe(6);
  });

  it('enters exactly at hats 0.30, bass 0.40, kick 0.45, pluck 0.55, clap 0.70', () => {
    const arrangement = arrange(load('grid-sweep.json'), preset, 5);
    const energyOf = (bar: number | null) => (bar === null ? null : arrangement.bars[bar]?.energy);
    expect(energyOf(firstBar(arrangement, 'hat'))).toBe(NUMBERS['energy.hats'].from);
    expect(energyOf(firstBar(arrangement, 'bass'))).toBe(NUMBERS['energy.bass']);
    expect(energyOf(firstBar(arrangement, 'kick'))).toBe(NUMBERS['energy.kick'].from);
    expect(energyOf(firstBar(arrangement, 'pluck'))).toBe(NUMBERS['energy.pluck']);
    expect(energyOf(firstBar(arrangement, 'clap'))).toBe(NUMBERS['energy.clap']);
  });

  it('bars 5 and 1 differ in voicing or chord, and bar 9 moves to the progression variant', () => {
    for (const id of GENRE_IDS) {
      const arrangement = arrange(load('grid-20s.json'), GENRE_PRESETS[id] as NonNullable<(typeof GENRE_PRESETS)[string]>, 3);
      expect(arrangement.bars[4]?.chord, id).not.toEqual(arrangement.bars[0]?.chord);
    }
  });

  it('riser sections end in a riser and a roll; drops start with an impact; sections close with a fill', () => {
    const arrangement = arrange(load('grid-20s.json'), preset, 3);
    const rolesAt = (bar: number) => new Set(arrangement.events.filter((event) => event.at >= bar * 2 - 1e-9 && event.at < (bar + 1) * 2 - 1e-9).map((event) => event.role));
    expect([...rolesAt(5)]).toEqual(expect.arrayContaining(['riser', 'roll']));
    expect(rolesAt(6).has('impact')).toBe(true);
    expect(arrangement.bars[2]?.fill).not.toBeNull();
    expect(arrangement.bars[9]?.fill).not.toBeNull();
  });

  it('the end-card section strips to pad, a mark hit and a shimmer', () => {
    const arrangement = arrange(load('grid-end.json'), GENRE_PRESETS['warm-house'] as NonNullable<(typeof GENRE_PRESETS)[string]>, 9);
    const end = arrangement.events.filter((event) => event.at >= arrangement.bars[4]!.startSec - 1e-9);
    expect([...new Set(end.map((event) => event.role))].sort()).toEqual(['bell', 'impact', 'pad', 'shimmer']);
  });

  it('is deterministic, and a requested key outside the pool is refused', () => {
    const grid = load('grid-20s.json');
    expect(arrange(grid, preset, 3)).toEqual(arrange(grid, preset, 3));
    expect(arrange(grid, preset, 4).events).not.toEqual(arrange(grid, preset, 3).events);
    expect(arrange(grid, preset, 3, { key: 'F minor' }).key).toBe('F minor');
    expect(() => arrange(grid, preset, 3, { key: 'C major' })).toThrow(/not in the driving-electronic key pool/);
  });
});

describe('rendering', () => {
  it('every preset renders the 20 s fixture without clipping before loudness, deterministically', () => {
    const grid = load('grid-20s.json');
    const peaks: Record<string, number> = {};
    for (const id of GENRE_IDS) {
      const genre = GENRE_PRESETS[id] as NonNullable<(typeof GENRE_PRESETS)[string]>;
      const { channels, peak } = renderArrangement(arrange(grid, genre, 3), genre, 3);
      peaks[id] = Math.round(peak * 1000) / 1000;
      expect(peak, id).toBeLessThan(1);
      expect(peak, id).toBeGreaterThan(0.15);
      expect(channels[0].length).toBe(20 * SAMPLE_RATE);
    }
    console.log(`preset peaks ${JSON.stringify(peaks)}`);
    const genre = GENRE_PRESETS['lofi-keys'] as NonNullable<(typeof GENRE_PRESETS)[string]>;
    const hash = () => createHash('sha256').update(encodeWav24(renderArrangement(arrange(grid, genre, 3), genre, 3).channels, SAMPLE_RATE)).digest('hex');
    expect(hash()).toBe(hash());
  }, 300_000);
});

describe('themes narrow presets', () => {
  const preset = GENRE_PRESETS['warm-house'] as NonNullable<(typeof GENRE_PRESETS)[string]>;
  it('accepts a narrower BPM and a pool key, rejects anything outside the preset', () => {
    expect(narrowPreset(preset, { bpm: [114, 120], key: 'B-flat major' })).toMatchObject({ bpm: { min: 114, max: 120 }, keys: [{ key: 'B-flat major', weight: 2 }] });
    expect(() => narrowPreset(preset, { bpm: [100, 120], key: null })).toThrow(/outside warm-house \(112-122\)/);
    expect(() => narrowPreset(preset, { bpm: [118, 126], key: null })).toThrow();
    expect(() => narrowPreset(preset, { bpm: [114, 120], key: 'A minor' })).toThrow(/not in the warm-house key pool/);
  });
});

describe('score with a genre preset', () => {
  it('renders the project grid with its genre', async () => {
    const project = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-score-')), 'film');
    cpSync(path.resolve(here, '../../../fixtures/projects/film'), project, { recursive: true });
    cpSync(path.join(here, 'grid-20s.json'), path.join(project, 'plan', 'beatgrid.resolved.json'));
    const result = await runIn(['score', '--project', project, '--json'], COMMANDS, {});
    expect(result.code, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({ preset: 'driving-electronic', seconds: 20, bpm: 120 });
    expect(result.stderr).not.toContain('does not exist');
  }, 120_000);
});

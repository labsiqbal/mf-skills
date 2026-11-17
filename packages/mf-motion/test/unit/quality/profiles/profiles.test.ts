// The check profiles against the check matrix (snapshot here; the live doc is
// compared by the generic spec test with MFM_SPEC_DOCS), and applies().
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUMBERS } from '../../../../src/kit/numbers';
import { CHECK_IDS, CHECKS, PROFILES, PROFILE_LIST, applies, checkMatrix, modeOf } from '../../../../src/quality/profiles';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const snapshot = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'spec', 'check-matrix.json'), 'utf8')) as { data: Array<Record<string, string>> };

describe('PROFILES', () => {
  it('equals the check-matrix snapshot, row for row', () => {
    expect(checkMatrix()).toEqual(snapshot.data);
    expect(Object.keys(PROFILES)).toEqual([...PROFILE_LIST]);
    for (const name of PROFILE_LIST) expect(Object.keys(PROFILES[name])).toEqual([...CHECK_IDS]);
    expect(Object.isFrozen(PROFILES.film.loudness)).toBe(true);
  });

  it('holds no threshold values; every key it names is a numbers key or a rule family', () => {
    for (const name of PROFILE_LIST) {
      for (const rule of Object.values(PROFILES[name])) expect(Object.keys(rule).every((key) => ['mode', 'when', 'note'].includes(key))).toBe(true);
    }
    const known = Object.keys(NUMBERS);
    for (const { keys } of Object.values(CHECKS)) {
      for (const key of keys.split(', ').filter((entry) => entry !== '-' && !entry.startsWith('TXT'))) {
        const prefix = key.replace(/\*$/, '');
        expect(known.some((name) => (key.endsWith('*') ? name.startsWith(prefix) : name === key)), key).toBe(true);
      }
    }
  });
});

describe('applies', () => {
  it('moves are silent: audio checks never apply to move profiles', () => {
    expect(applies('broll', 'loudness', { hasAudio: true })).toBe(false);
    for (const check of ['loudness', 'true-peak', 'sfx-timing', 'sfx-rise', 'low-share'] as const) {
      for (const name of ['broll', 'overlay-alpha', 'overlay-key'] as const) expect(applies(name, check, { hasAudio: true })).toBe(false);
      expect(applies('film', check, { hasAudio: true })).toBe(true);
      expect(applies('film', check, { hasAudio: false })).toBe(false);
    }
    expect(modeOf('film', 'true-peak', { hasAudio: true })).toBe('hard');
    expect(modeOf('film', 'loudness', { hasAudio: true })).toBe('cap');
  });

  it('the caption band applies to films only with captions, to overlays always', () => {
    expect(applies('film', 'caption-band', { captions: false })).toBe(false);
    expect(applies('film', 'caption-band', { captions: true })).toBe(true);
    expect(applies('broll', 'caption-band', { captions: true })).toBe(false);
    expect(applies('overlay-alpha', 'caption-band')).toBe(true);
  });

  it('the face band caps overlays unless they opt out of avoidFace', () => {
    expect(modeOf('overlay-key', 'face-band')).toBe('cap');
    expect(applies('overlay-alpha', 'face-band', { avoidFace: false })).toBe(false);
    expect(applies('film', 'face-band')).toBe(false);
    expect(applies('overlay-key', 'key-purity')).toBe(true);
    expect(applies('overlay-alpha', 'key-purity')).toBe(false);
    expect(applies('overlay-alpha', 'frame0-ink')).toBe(false);
    expect(PROFILES['overlay-alpha']['contrast-hard']).toEqual({ mode: 'hard', note: 'worst plate' });
  });
});

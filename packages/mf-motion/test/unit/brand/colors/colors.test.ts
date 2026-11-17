import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type RoleInputs, ROLE_NUMBERS, contrast, deriveRoles, hsl, luminance, parseColor } from '../../../../src/brand/colors';
import type { Frame } from '../../../../src/media/pixels';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/brands/colors');

interface ShotSpec {
  width: number;
  height: number;
  fill: string;
  regions: Array<{ x: number; y: number; w: number; h: number; color?: string; noise?: boolean }>;
}

/** A synthetic viewport screenshot: flat fill, flat regions, and seeded noise for photo areas. */
function frame(spec: ShotSpec): Frame {
  const data = new Uint8Array(spec.width * spec.height * 4);
  const fill = parseColor(spec.fill) ?? [0, 0, 0];
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      let rgb = fill;
      for (const region of spec.regions) {
        if (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h) {
          rgb = region.noise ? [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)] : (parseColor(region.color) ?? rgb);
        }
      }
      data.set([rgb[0], rgb[1], rgb[2], 255], (y * spec.width + x) * 4);
    }
  }
  return { data, width: spec.width, height: spec.height, format: 'rgba' };
}

function load(name: string) {
  const fixture = JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), 'utf8')) as {
    tokens: RoleInputs['tokens'];
    computedStyles: RoleInputs['computedStyles'];
    screenshots: ShotSpec[];
    expect: Record<string, unknown> & { methods?: Record<string, string>; surfaceShift?: number };
  };
  const roles = deriveRoles({ tokens: fixture.tokens, computedStyles: fixture.computedStyles, screenshots: fixture.screenshots.map(frame) });
  return { roles, expected: fixture.expect };
}

describe('colour roles by usage', () => {
  const names = readdirSync(fixtures).filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, '')).sort();

  it.each(names)('%s gives the expected roles and methods', (name) => {
    const { roles, expected } = load(name);
    for (const role of ['ground', 'ink', 'accent', 'accent2', 'surface', 'muted'] as const) {
      if (role in expected) expect(roles[role], role).toBe(expected[role]);
    }
    for (const [role, method] of Object.entries(expected.methods ?? {})) {
      expect(roles.evidence[role as keyof typeof roles.evidence].method, role).toBe(method);
    }
  });

  it.each(names)('%s: every role carries a method and share or contrast evidence; hex is upper case', (name) => {
    const { roles } = load(name);
    for (const [role, evidence] of Object.entries(roles.evidence)) {
      expect(evidence.method, role).toMatch(/^(area|text-use|button-fill|interactive|manual|generated)$/);
      expect(evidence.share !== null || evidence.contrast !== null, role).toBe(true);
    }
    for (const hex of [roles.ground, roles.ink, roles.accent, roles.surface, roles.muted, ...roles.palette]) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(roles.palette.length).toBeLessThanOrEqual(ROLE_NUMBERS.paletteMax);
    for (let i = 0; i < roles.palette.length; i += 1) {
      for (let j = i + 1; j < roles.palette.length; j += 1) {
        const [a, b] = [parseColor(roles.palette[i]), parseColor(roles.palette[j])];
        expect(Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0), (a?.[2] ?? 0) - (b?.[2] ?? 0))).toBeGreaterThanOrEqual(ROLE_NUMBERS.mergeDistance);
      }
    }
  });

  it('ink falls back to black or white, whichever contrasts more', () => {
    const { roles } = load('no-ink');
    expect(roles.ink).toBe('#FFFFFF');
    expect(roles.evidence.ink.contrast).toBeGreaterThan(contrast([0, 0, 0], [42, 42, 42]));
  });

  it('surface falls back to ground shifted 0.04 luminance toward ink', () => {
    const { roles } = load('no-surface');
    const shift = luminance(parseColor(roles.ground) ?? [0, 0, 0]) - luminance(parseColor(roles.surface) ?? [0, 0, 0]);
    expect(shift).toBeGreaterThan(0.035);
    expect(shift).toBeLessThan(0.045);
  });

  it('accent2 is null when no second interactive colour is 40 degrees away', () => {
    const { roles } = load('no-accent2');
    const a = hsl(parseColor('#2F6BFF') ?? [0, 0, 0]).h;
    const b = hsl(parseColor('#3D5BFF') ?? [0, 0, 0]).h;
    expect(Math.abs(a - b)).toBeLessThan(40);
    expect(roles.accent2).toBeNull();
  });

  it('photo-like tiles do not count as painted area', () => {
    const { roles } = load('photo');
    expect(roles.ground).toBe('#FAF7F2');
    expect(roles.evidence.ground.share).toBe(1);
  });
});

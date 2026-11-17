// brand manual and brand from-brief: colour roles, mood recipes, contrast,
// determinism and the library write.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, parseColor } from '../../../../src/brand/colors';
import { briefBrand, briefPalette, parseMoods, wordmarkSvg } from '../../../../src/brand/fromBrief';
import { manualBrand, manualRoles, parseHexList } from '../../../../src/brand/manual';
import { MOODS, MOOD_NAMES, oklchToRgb, rgbToOklch } from '../../../../src/brand/moods';
import { BRAND_NOTICE } from '../../../../src/brand/rights';
import { MfmError } from '../../../../src/cli/errors';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { bundledFontsDir } from '../../../../src/fonts/index';
import { readDoc, writeDoc } from '../../../../src/schemas/index';
import { runIn } from '../../cli/harness';

const rgb = (hex: string) => parseColor(hex) as [number, number, number];
const home = () => mkdtempSync(path.join(tmpdir(), 'mfm-home-'));

function logoSvg(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-logo-'));
  const file = path.join(dir, 'logo.svg');
  writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><rect width="240" height="80" fill="#F2AA4C"/></svg>\n');
  return file;
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const file = path.join(at, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (name !== '.lock') out[path.relative(dir, file)] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

function usage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MfmError);
    return (error as MfmError).code;
  }
  throw new Error('expected an error');
}

describe('mood recipes', () => {
  it('holds the 12 moods, each with ground, ink, accents and bundled fonts', () => {
    expect(MOOD_NAMES.sort()).toEqual(
      ['bold', 'bright', 'calm', 'dark', 'editorial', 'luxury', 'minimal', 'natural', 'playful', 'retro', 'technical', 'warm'].sort(),
    );
    for (const recipe of Object.values(MOODS)) {
      expect(recipe.accents.length).toBeGreaterThan(0);
      expect(['inter', 'noto-sans', 'noto-serif']).toContain(recipe.display);
      expect(['inter', 'noto-sans', 'noto-serif']).toContain(recipe.body);
    }
  });

  it('converts OKLCH and sRGB both ways', () => {
    expect(oklchToRgb({ l: 1, c: 0, h: 0 })).toEqual([255, 255, 255]);
    expect(oklchToRgb({ l: 0, c: 0, h: 0 })).toEqual([0, 0, 0]);
    for (const hex of ['#3366FF', '#F2AA4C', '#101820', '#8B6DFF']) {
      const back = oklchToRgb(rgbToOklch(rgb(hex)));
      rgb(hex).forEach((value, i) => expect(Math.abs(value - (back[i] ?? 0))).toBeLessThanOrEqual(1));
    }
  });

  it('rejects unknown moods and more than three words', () => {
    expect(usage(() => parseMoods(['calm', 'sleepy']))).toBe('USAGE');
    expect(usage(() => parseMoods(['calm', 'bold', 'warm', 'dark']))).toBe('USAGE');
    expect(parseMoods([' Calm', 'technical'])).toEqual(['calm', 'technical']);
  });
});

describe('manual colour roles', () => {
  it('makes the lightest or darkest colour ground, the highest contrast ink, the most saturated accent', () => {
    const light = manualRoles(parseHexList(['#F2AA4C', '#101820', '#FFFFFF'], '--colors')).colors;
    expect(light).toMatchObject({ ground: '#FFFFFF', ink: '#101820', accent: '#F2AA4C' });
    expect(light.evidence.ground.method).toBe('manual');
    const dark = manualRoles(parseHexList(['#3366FF', '#000000', '#CCCCCC'], '--colors')).colors;
    expect(dark).toMatchObject({ ground: '#000000', ink: '#CCCCCC', accent: '#3366FF' });
    expect(contrast(rgb(dark.ink), rgb(dark.ground))).toBeGreaterThanOrEqual(4.5);
  });

  it('fills the rest by the capture rules', () => {
    const roles = manualRoles(parseHexList(['#FFFFFF', '#111111', '#E4572E', '#2E86E4', '#F4F4F4'], '--colors')).colors;
    expect(roles).toMatchObject({ ground: '#FFFFFF', ink: '#111111', accent: '#E4572E', accent2: '#2E86E4', surface: '#F4F4F4' });
    expect(roles.evidence.surface.method).toBe('manual');
    expect(roles.evidence.muted.method).toBe('generated');
    expect(roles.palette.slice(0, 3)).toEqual(['#FFFFFF', '#111111', '#E4572E']);
  });

  it('uses ink as accent with two colours, and black or white when no colour reaches the ink floor', () => {
    const two = manualRoles(parseHexList(['#FFFFFF', '#222222'], '--colors'));
    expect(two.colors.accent).toBe('#222222');
    expect(two.colors.evidence.accent.method).toBe('generated');
    const flat = manualRoles(parseHexList(['#777777', '#888888'], '--colors'));
    expect(['#000000', '#FFFFFF']).toContain(flat.colors.ink);
    expect(flat.warnings).toHaveLength(1);
  });

  it('takes 2-5 hex colours', () => {
    expect(usage(() => manualRoles(parseHexList(['#FFFFFF'], '--colors')))).toBe('USAGE');
    expect(usage(() => manualRoles(parseHexList(['#111', '#222', '#333', '#444', '#555', '#666'], '--colors')))).toBe('USAGE');
    expect(usage(() => parseHexList(['tomato'], '--colors'))).toBe('USAGE');
    expect(parseHexList(['ABC'], '--colors')).toEqual([[170, 187, 204]]);
  });
});

describe('from-brief palette', () => {
  it('every text pair meets 4.5:1 for every mood combination and seed', () => {
    const combos: string[][] = [];
    for (const a of MOOD_NAMES) {
      combos.push([a]);
      for (const b of MOOD_NAMES) {
        if (b === a) continue;
        combos.push([a, b]);
        for (const c of MOOD_NAMES) if (c !== a && c !== b) combos.push([a, b, c]);
      }
    }
    expect(combos.length).toBe(12 + 132 + 1320);
    for (const moods of combos) {
      for (const seed of [0, 1, 2, 7]) {
        const { colors, pairs } = briefPalette(moods, { seed });
        expect(pairs).toHaveLength(4);
        for (const pair of pairs) {
          const text = rgb(colors[pair.text]);
          const on = rgb(colors[pair.on]);
          expect(contrast(text, on), `${moods.join(',')} seed ${seed}: ${pair.text} on ${pair.on}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('the seed picks another accent variant and --accent overrides it', () => {
    const accents = new Set([0, 1, 2].map((seed) => briefPalette(['calm', 'technical', 'minimal'], { seed }).colors.accent));
    expect(accents.size).toBe(3);
    const own = briefPalette(['calm'], { accent: '#FF0066' }).colors;
    expect(own.accent).toBe('#FF0066');
    expect(own.evidence.accent.method).toBe('manual');
    expect(briefPalette(['calm'], { accent: '#ff0066', seed: 5 }).colors.accent).toBe('#FF0066');
  });

  it('the wordmark escapes the name and fits it with textLength', () => {
    const mark = wordmarkSvg('A&B <Co>', 'noto-serif', '#101820');
    expect(mark.svg).toContain('A&amp;B &lt;Co&gt;');
    expect(mark.svg).toContain('lengthAdjust="spacing"');
    expect(mark.svg).toContain('fonts/NotoSerif%5Bwdth,wght%5D.ttf');
    expect(mark.w).toBeGreaterThan(mark.h);
  });
});

describe('brand from-brief', () => {
  it('is deterministic: the same files twice, schema-valid and draft', async () => {
    const dataHome = home();
    const first = await briefBrand({ home: dataHome, id: 'quiet-labs', moods: ['calm', 'technical', 'minimal'], seed: 2 });
    expect(first.notice).toBe(BRAND_NOTICE);
    const before = tree(first.brand.dir);
    const second = await briefBrand({ home: dataHome, id: 'quiet-labs', moods: ['calm', 'technical', 'minimal'], seed: 2 });
    expect(second.notice).toBeNull();
    expect(tree(second.brand.dir)).toEqual(before);
    expect(Object.keys(before)).toEqual(expect.arrayContaining(['brand.json', 'brand.md', 'logo.svg']));
    const { doc } = readDoc('brand', path.join(first.brand.dir, 'brand.json'));
    expect(doc).toMatchObject({ id: 'quiet-labs', name: 'Quiet Labs', status: 'draft', source: { mode: 'from-brief' }, logo: { path: 'logo.svg', kind: 'svg' } });
    expect(doc.type.display?.fallback).toBe('inter');
    expect(doc.type.mono?.fallback).toBe('noto-sans-mono');
    expect(doc.type.display?.files.every((file) => file.source === 'bundled' && file.licenceHint === 'ofl')).toBe(true);
    expect(readFileSync(path.join(first.brand.dir, 'logo.svg'), 'utf8')).toContain(`fill="${doc.colors.ink}"`);
  });

  it('runs through the CLI with --accent and --seed', async () => {
    const dataHome = home();
    const result = await runIn(['brand', 'from-brief', '--name', 'ember', '--mood', 'warm,editorial', '--accent', '#C2410C', '--seed', '1', '--home', dataHome, '--json'], COMMANDS);
    expect(result.code, result.stdout).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data.brand.colors.accent).toBe('#C2410C');
    expect(data.moods).toEqual(['warm', 'editorial']);
    expect(data.notice).toBe(BRAND_NOTICE);
    const bad = await runIn(['brand', 'from-brief', '--name', 'ember', '--mood', 'grumpy', '--home', dataHome, '--json'], COMMANDS);
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.stdout).error.code).toBe('USAGE');
  });
});

describe('brand manual', () => {
  it('without shots is a schema-valid draft with a bundled family', async () => {
    const dataHome = home();
    const result = await manualBrand({ home: dataHome, id: 'acme-coffee', logo: logoSvg(), colors: ['#F2AA4C', '#101820', '#FFFFFF'], family: 'noto-serif', tagline: 'Roasted daily' });
    const { doc } = readDoc('brand', path.join(result.brand.dir, 'brand.json'));
    expect(doc).toMatchObject({ status: 'draft', tagline: 'Roasted daily', source: { mode: 'manual' }, logo: { path: 'logo.svg', kind: 'svg', w: 240, h: 80 }, shots: [] });
    expect(['#FFFFFF', '#101820']).toContain(doc.colors.ground);
    expect(doc.type.body?.fallback).toBe('noto-serif');
  });

  it('copies user fonts in as source user, licence user-asserted', async () => {
    const dataHome = home();
    const fonts = mkdtempSync(path.join(tmpdir(), 'mfm-user-fonts-'));
    copyFileSync(path.join(bundledFontsDir(), 'noto-serif', 'NotoSerif[wdth,wght].ttf'), path.join(fonts, 'Brand-Serif.ttf'));
    copyFileSync(path.join(bundledFontsDir(), 'noto-sans', 'NotoSans[wdth,wght].ttf'), path.join(fonts, 'Brand-Sans.ttf'));
    copyFileSync(path.join(bundledFontsDir(), 'noto-sans-mono', 'NotoSansMono[wdth,wght].ttf'), path.join(fonts, 'Brand-Mono.ttf'));
    const result = await manualBrand({
      home: dataHome,
      id: 'quillfen',
      logo: logoSvg(),
      colors: ['#FFFFFF', '#1A1A1A'],
      fonts: ['Brand-Serif.ttf', 'Brand-Sans.ttf', 'Brand-Mono.ttf'].map((name) => path.join(fonts, name)),
    });
    const { doc } = readDoc('brand', path.join(result.brand.dir, 'brand.json'));
    expect(doc.type.display).toMatchObject({ family: 'Noto Serif', weight: 700, fallback: 'noto-serif' });
    expect(doc.type.body).toMatchObject({ family: 'Noto Sans', weight: 400 });
    expect(doc.type.mono).toMatchObject({ family: 'Noto Sans Mono', fallback: 'noto-sans-mono' });
    for (const role of [doc.type.display, doc.type.body, doc.type.mono]) {
      expect(role?.files.every((file) => file.source === 'user' && file.licenceHint === 'user-asserted' && file.path.startsWith('fonts/'))).toBe(true);
    }
  });

  it('refuses bad input and never replaces a captured brand', async () => {
    const dataHome = home();
    const logo = logoSvg();
    await expect(manualBrand({ home: dataHome, id: 'Bad Name', logo, colors: ['#FFF', '#000'] })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(manualBrand({ home: dataHome, id: 'two-fonts', logo, colors: ['#FFF', '#000'], family: 'inter', fonts: [logo] })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(manualBrand({ home: dataHome, id: 'few-shots', logo, colors: ['#FFF', '#000'], shots: [logo] })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(manualBrand({ home: dataHome, id: 'no-family', logo, colors: ['#FFF', '#000'], family: 'comic-sans' })).rejects.toMatchObject({ code: 'USAGE' });
    const made = await manualBrand({ home: dataHome, id: 'taken', logo, colors: ['#FFF', '#000'] });
    const file = path.join(made.brand.dir, 'brand.json');
    const { doc } = readDoc('brand', file);
    writeDoc('brand', file, { ...doc, source: { ...doc.source, mode: 'capture-local' } });
    await expect(manualBrand({ home: dataHome, id: 'taken', logo, colors: ['#FFF', '#000'] })).rejects.toMatchObject({ code: 'USAGE' });
    expect(readDoc('brand', file).doc.source.mode).toBe('capture-local');
  });

  it('runs through the CLI', async () => {
    const dataHome = home();
    const logo = logoSvg();
    const result = await runIn(['brand', 'manual', '--name', 'acme', '--logo', logo, '--colors', '#FFFFFF,#101820,#F2AA4C', '--home', dataHome, '--json'], COMMANDS);
    expect(result.code, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).data.brand).toMatchObject({ id: 'acme', status: 'draft', colors: { ground: '#FFFFFF', ink: '#101820', accent: '#F2AA4C' } });
  });
});

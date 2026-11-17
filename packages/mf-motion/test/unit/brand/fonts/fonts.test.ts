import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BRAND_NOTICE,
  type FontRoles,
  commercialHost,
  fontOrigins,
  fontWarnings,
  mapFontRoles,
  readRights,
  rightsNotice,
  riskyRoles,
  substituteOfl,
} from '../../../../src/brand/index';
import { COMMANDS } from '../../../../src/cli/commands/index';
import { bundledFontsDir, readFont } from '../../../../src/fonts/index';
import { appendEvent, readEvents } from '../../../../src/paths/index';
import { readDoc, writeDoc } from '../../../../src/schemas/index';
import { runIn } from '../../cli/harness';
import { buildFont } from '../../fonts/synthetic-font';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/brands/fonts');
const bundled = (id: string, file: string) => path.join(bundledFontsDir(), id, file);

/** sfnt tables of a font file. */
function tables(sfnt: Uint8Array): Array<{ tag: string; data: Uint8Array }> {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const out: Array<{ tag: string; data: Uint8Array }> = [];
  for (let i = 0; i < view.getUint16(4); i += 1) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...[0, 1, 2, 3].map((c) => view.getUint8(record + c)));
    const offset = view.getUint32(record + 8);
    out.push({ tag, data: sfnt.subarray(offset, offset + view.getUint32(record + 12)) });
  }
  return out;
}

/** WOFF 1 with zlib-compressed tables. */
function toWoff(sfnt: Uint8Array): Uint8Array {
  const list = tables(sfnt).map((table) => ({ ...table, packed: new Uint8Array(deflateSync(table.data)) }));
  const header = 44 + list.length * 20;
  const total = header + list.reduce((sum, t) => sum + Math.ceil(t.packed.length / 4) * 4, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, total);
  view.setUint16(12, list.length);
  let offset = header;
  list.forEach((table, i) => {
    const entry = 44 + i * 20;
    for (let c = 0; c < 4; c += 1) view.setUint8(entry + c, table.tag.charCodeAt(c));
    view.setUint32(entry + 4, offset);
    view.setUint32(entry + 8, table.packed.length);
    view.setUint32(entry + 12, table.data.length);
    out.set(table.packed, offset);
    offset += Math.ceil(table.packed.length / 4) * 4;
  });
  return out;
}

/** WOFF 2 with one brotli stream (null transforms; no glyf or loca). */
function toWoff2(sfnt: Uint8Array): Uint8Array {
  const known: Record<string, number> = { head: 1, name: 5, 'OS/2': 6, post: 7, fvar: 47 };
  const list = tables(sfnt).filter((table) => table.tag in known);
  const directory: number[] = [];
  const base128 = (value: number) => {
    const bytes: number[] = [];
    do {
      bytes.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    } while (value > 0);
    return bytes.map((byte, i) => (i < bytes.length - 1 ? byte | 0x80 : byte));
  };
  for (const table of list) directory.push(known[table.tag] ?? 63, ...base128(table.data.length));
  const stream = new Uint8Array(brotliCompressSync(Buffer.concat(list.map((table) => Buffer.from(table.data)))));
  const out = new Uint8Array(48 + directory.length + stream.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, out.length);
  view.setUint16(12, list.length);
  view.setUint32(20, stream.length);
  out.set(directory, 48);
  out.set(stream, 48 + directory.length);
  return out;
}

function brandFromFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-brand-fonts-'));
  cpSync(path.join(fixture, 'capture'), path.join(dir, 'capture'), { recursive: true });
  const fonts = path.join(dir, 'capture', 'assets', 'fonts');
  mkdirSync(fonts, { recursive: true });
  cpSync(bundled('noto-serif', 'NotoSerif[wdth,wght].ttf'), path.join(fonts, 'QuillDisplay.ttf'));
  writeFileSync(path.join(fonts, 'QuillDisplay-Bold-static.ttf'), buildFont({ family: 'Quill Display', weightClass: 700, xHeight: 500 }));
  const text = buildFont({ family: 'Quill Text', panose: [2, 2, 5, 3, 6, 4, 5, 2, 2, 4], xHeight: 470 });
  writeFileSync(path.join(fonts, 'QuillText-latin.woff2'), toWoff2(text));
  writeFileSync(path.join(fonts, 'QuillText-ext.woff2'), toWoff2(text));
  writeFileSync(path.join(fonts, 'QuillText.ttf'), Buffer.concat([Buffer.from(text), Buffer.alloc(4096)]));
  writeFileSync(path.join(fonts, 'QuillMono.woff'), toWoff(buildFont({ family: 'Quill Mono', fixedPitch: true, xHeight: 520 })));
  return dir;
}

function roles(dir: string): FontRoles {
  const origins = fontOrigins(readFileSync(path.join(fixture, 'source.html'), 'utf8'), (href) => {
    try {
      return readFileSync(path.join(fixture, href), 'utf8');
    } catch {
      return null;
    }
  });
  return mapFontRoles({ brandDir: dir, captureDir: path.join(dir, 'capture'), origins });
}

describe('font reader on web fonts', () => {
  it('reads name and fvar from WOFF and WOFF2', () => {
    const inter = new Uint8Array(readFileSync(bundled('inter', 'Inter[opsz,wght].ttf')));
    for (const wrapped of [toWoff(inter), toWoff2(inter)]) {
      const info = readFont(wrapped);
      expect(info.typographicFamily).toBe('Inter');
      expect(info.licence).toContain('SIL Open Font License');
      expect(info.axes.map((axis) => axis.tag)).toEqual(['opsz', 'wght']);
    }
  });
});

describe('font roles', () => {
  it('map display, heading, body and mono with the right files, hints and fallbacks', () => {
    const dir = brandFromFixture();
    const mapped = roles(dir);
    expect(mapped.display).toMatchObject({
      family: 'Quill Display',
      weight: 700,
      sizePx: 64,
      letterSpacingEm: -0.01,
      lineHeight: 1.1,
      fallback: 'noto-serif',
      files: [{ path: 'capture/assets/fonts/QuillDisplay.ttf', weight: '100 900', axes: 'wght,wdth', source: 'captured', origin: 'fonts/QuillDisplay.ttf', licenceHint: 'ofl' }],
    });
    expect(mapped.heading?.files[0]?.licenceHint).toBe('ofl');
    expect(mapped.heading?.lineHeight).toBe(1.2);
    expect(mapped.body).toMatchObject({
      family: 'Quill Text',
      files: [{ path: 'capture/assets/fonts/QuillText-latin.woff2', origin: 'https://use.typekit.net/af/0a1b2c/QuillText-latin.woff2', licenceHint: 'commercial-webfont' }],
      fallback: 'noto-serif',
    });
    expect(mapped.mono).toMatchObject({ letterSpacingEm: 0.02, fallback: 'noto-sans-mono', files: [{ path: 'capture/assets/fonts/QuillMono.woff', origin: '../fonts/QuillMono.woff', licenceHint: 'unknown' }] });
    expect(riskyRoles(mapped)).toEqual(['body', 'mono']);
  });

  it('a commercial host triggers FONT_LICENCE_UNKNOWN with the substitute command next', () => {
    expect(commercialHost('https://use.typekit.net/af/x.woff2')).toBe('Adobe Fonts');
    expect(commercialHost('https://fonts.example/x.woff2')).toBeNull();
    const notes = fontWarnings('quillfen', roles(brandFromFixture()));
    expect(notes.warnings).toEqual([{ code: 'FONT_LICENCE_UNKNOWN', message: expect.stringContaining('body, mono'), details: { roles: ['body', 'mono'] } }]);
    expect(notes.next).toEqual(['mf-motion brand fonts quillfen --substitute-ofl --json']);
  });

  it('--substitute-ofl replaces every unknown and commercial role and leaves OFL roles untouched', () => {
    const dir = brandFromFixture();
    const mapped = roles(dir);
    const { roles: next, replaced } = substituteOfl(mapped, dir);
    expect(replaced).toEqual([
      { role: 'body', from: 'Quill Text', to: 'noto-serif' },
      { role: 'mono', from: 'Quill Mono', to: 'noto-sans-mono' },
    ]);
    expect(next.display).toEqual(mapped.display);
    expect(next.heading).toEqual(mapped.heading);
    expect(next.body?.files.every((file) => file.licenceHint === 'ofl' && file.source === 'bundled')).toBe(true);
    for (const file of [...(next.body?.files ?? []), ...(next.mono?.files ?? [])]) expect(existsSync(path.join(dir, file.path))).toBe(true);
    expect(riskyRoles(next)).toEqual([]);
  });
});

describe('rights notice', () => {
  it('prints on the first intake only and records its time and event', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const project = mkdtempSync(path.join(tmpdir(), 'mfm-project-'));
    appendEvent(project, { type: 'project.created', actor: 'cli' });
    const first = rightsNotice(home, 'brand', { project, now: new Date('2026-11-18T10:00:00.000Z') });
    expect(first).toEqual({ text: BRAND_NOTICE, shownAt: '2026-11-18T10:00:00.000Z' });
    expect(readRights(home).brand).toEqual({ shownAt: '2026-11-18T10:00:00.000Z' });
    expect(readEvents(project).map((event) => event.type)).toEqual(['project.created', 'rights.notice']);
    const second = rightsNotice(home, 'brand', { project });
    expect(second).toEqual({ text: null, shownAt: '2026-11-18T10:00:00.000Z' });
    expect(readEvents(project)).toHaveLength(2);
    expect(rightsNotice(home, 'reference').text).toContain('You are responsible');
  });
});

describe('brand fonts command', () => {
  it('replaces risky roles in brand.json and sets rights.oflSubstituted', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mfm-home-'));
    const dir = path.join(home, 'brands', 'quillfen');
    mkdirSync(path.dirname(dir), { recursive: true });
    cpSync(brandFromFixture(), dir, { recursive: true });
    const base = JSON.parse(readFileSync(path.resolve(fixture, '../../schemas/brand.valid.json'), 'utf8'));
    writeDoc('brand', path.join(dir, 'brand.json'), { ...base, id: 'quillfen', type: roles(dir) });
    const result = await runIn(['brand', 'fonts', 'quillfen', '--substitute-ofl', '--home', home, '--json'], COMMANDS);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data.replaced.map((item: { role: string }) => item.role)).toEqual(['body', 'mono']);
    const { doc } = readDoc('brand', path.join(dir, 'brand.json'));
    expect(doc.rights.oflSubstituted).toBe(true);
    expect(doc.type.display?.files[0]?.licenceHint).toBe('ofl');
    const again = await runIn(['brand', 'fonts', 'quillfen', '--substitute-ofl', '--home', home, '--json'], COMMANDS);
    expect(JSON.parse(again.stdout).data.replaced).toEqual([]);
    const missing = await runIn(['brand', 'fonts', 'nobody', '--substitute-ofl', '--home', home, '--json'], COMMANDS);
    expect(JSON.parse(missing.stdout).error.code).toBe('BRAND_NOT_FOUND');
  });
});

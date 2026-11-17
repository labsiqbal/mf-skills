// A small OpenType/TrueType table reader: just the tables mf-motion needs
// (name, OS/2, head, post, fvar), from plain sfnt files and from WOFF and
// WOFF2 web fonts (unpacked with node:zlib). No native code, no font library.
import { brotliDecompressSync, inflateSync } from 'node:zlib';

export interface FvarAxis {
  tag: string;
  min: number;
  default: number;
  max: number;
}

export interface FontInfo {
  family: string;
  subfamily: string;
  /** Typographic family (name ID 16) when present, else family. */
  typographicFamily: string;
  fullName: string;
  version: string;
  unitsPerEm: number;
  weightClass: number;
  widthClass: number;
  /** OS/2 sxHeight / unitsPerEm; null when the table version has no sxHeight. */
  xHeightRatio: number | null;
  capHeightRatio: number | null;
  isFixedPitch: boolean;
  italic: boolean;
  /** PANOSE bytes (10). */
  panose: number[];
  /** name ID 13 (licence description) and 14 (licence URL), when present. */
  licence: string;
  licenceUrl: string;
  axes: FvarAxis[];
  tables: string[];
}

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

const fixed = (view: DataView, offset: number) => view.getInt32(offset) / 65536;

function directory(view: DataView): Map<string, { offset: number; length: number }> {
  const signature = view.getUint32(0);
  // 0x00010000 TrueType outlines, 'OTTO' CFF, 'true' legacy Apple.
  if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565) {
    throw new Error('not an OpenType, TrueType, WOFF or WOFF2 font (collections are not read)');
  }
  const count = view.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i += 1) {
    const record = 12 + i * 16;
    tables.set(tag(view, record), { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) });
  }
  return tables;
}

function utf16be(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(view.getUint16(offset + i));
  return text;
}

function latin1(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}

/** name table entries by name ID, preferring Windows Unicode English. */
function names(view: DataView, table: { offset: number }): Map<number, string> {
  const count = view.getUint16(table.offset + 2);
  const storage = table.offset + view.getUint16(table.offset + 4);
  const found = new Map<number, { text: string; rank: number }>();
  for (let i = 0; i < count; i += 1) {
    const record = table.offset + 6 + i * 12;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const language = view.getUint16(record + 4);
    const id = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const offset = storage + view.getUint16(record + 10);
    let text: string;
    let rank: number;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      text = utf16be(view, offset, length);
      rank = language === 0x0409 ? 0 : 1;
    } else if (platform === 0) {
      text = utf16be(view, offset, length);
      rank = 2;
    } else if (platform === 1 && encoding === 0) {
      text = latin1(view, offset, length);
      rank = 3;
    } else {
      continue;
    }
    const current = found.get(id);
    if (!current || rank < current.rank) found.set(id, { text, rank });
  }
  return new Map([...found].map(([id, value]) => [id, value.text]));
}

const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** Rebuild a plain sfnt (with only the tables we read) from a WOFF or WOFF2 file. */
function unwrap(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  const tables: Array<{ tag: string; data: Uint8Array }> = [];
  if (signature === 0x774f4646) {
    // WOFF 1: zlib per table.
    const count = view.getUint16(12);
    for (let i = 0; i < count; i += 1) {
      const entry = 44 + i * 20;
      const offset = view.getUint32(entry + 4);
      const compLength = view.getUint32(entry + 8);
      const origLength = view.getUint32(entry + 12);
      const raw = bytes.subarray(offset, offset + compLength);
      tables.push({ tag: tag(view, entry), data: compLength < origLength ? new Uint8Array(inflateSync(raw)) : raw });
    }
  } else if (signature === 0x774f4632) {
    // WOFF 2: one brotli stream; only glyf, loca and hmtx carry transforms, which we do not read.
    const count = view.getUint16(12);
    const compressedSize = view.getUint32(20);
    let at = 48;
    const base128 = () => {
      let value = 0;
      for (let i = 0; i < 5; i += 1) {
        const byte = view.getUint8(at);
        at += 1;
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return value;
      }
      return value;
    };
    const entries: Array<{ tag: string; length: number }> = [];
    for (let i = 0; i < count; i += 1) {
      const flags = view.getUint8(at);
      at += 1;
      let tableTag: string;
      if ((flags & 0x3f) === 0x3f) {
        tableTag = tag(view, at);
        at += 4;
      } else {
        tableTag = WOFF2_TAGS[flags & 0x3f] ?? '????';
      }
      const version = (flags >> 6) & 3;
      const origLength = base128();
      const transformed = (tableTag === 'glyf' || tableTag === 'loca') ? version === 0 : version !== 0;
      const length = transformed ? base128() : origLength;
      entries.push({ tag: tableTag, length });
    }
    const stream = new Uint8Array(brotliDecompressSync(bytes.subarray(at, at + compressedSize)));
    let offset = 0;
    for (const entry of entries) {
      tables.push({ tag: entry.tag, data: stream.subarray(offset, offset + entry.length) });
      offset += entry.length;
    }
  } else {
    return bytes;
  }
  const keep = tables.filter((table) => ['head', 'name', 'OS/2', 'post', 'fvar'].includes(table.tag));
  const headerSize = 12 + keep.length * 16;
  const total = headerSize + keep.reduce((sum, table) => sum + Math.ceil(table.data.length / 4) * 4, 0);
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x00010000);
  outView.setUint16(4, keep.length);
  let offset = headerSize;
  keep.forEach((table, i) => {
    const record = 12 + i * 16;
    for (let c = 0; c < 4; c += 1) outView.setUint8(record + c, table.tag.charCodeAt(c));
    outView.setUint32(record + 8, offset);
    outView.setUint32(record + 12, table.data.length);
    out.set(table.data, offset);
    offset += Math.ceil(table.data.length / 4) * 4;
  });
  return out;
}

/** Read the tables mf-motion uses from a TTF/OTF, WOFF or WOFF2 file's bytes. */
export function readFont(input: Uint8Array): FontInfo {
  const bytes = unwrap(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = directory(view);
  const need = (name: string) => {
    const table = tables.get(name);
    if (!table) throw new Error(`font has no ${name} table`);
    return table;
  };
  const head = need('head');
  const unitsPerEm = view.getUint16(head.offset + 18);
  const macStyle = view.getUint16(head.offset + 44);

  const nameTable = names(view, need('name'));
  const family = nameTable.get(1) ?? '';
  const subfamily = nameTable.get(2) ?? '';

  let weightClass = 400;
  let widthClass = 5;
  let xHeightRatio: number | null = null;
  let capHeightRatio: number | null = null;
  let italic = (macStyle & 0x2) !== 0;
  let panose: number[] = [];
  const os2 = tables.get('OS/2');
  if (os2) {
    const version = view.getUint16(os2.offset);
    weightClass = view.getUint16(os2.offset + 4);
    widthClass = view.getUint16(os2.offset + 6);
    panose = Array.from({ length: 10 }, (_, i) => view.getUint8(os2.offset + 32 + i));
    const fsSelection = view.getUint16(os2.offset + 62);
    italic = italic || (fsSelection & 0x1) !== 0;
    if (version >= 2 && os2.length >= 90) {
      const xHeight = view.getInt16(os2.offset + 86);
      const capHeight = view.getInt16(os2.offset + 88);
      xHeightRatio = xHeight > 0 ? xHeight / unitsPerEm : null;
      capHeightRatio = capHeight > 0 ? capHeight / unitsPerEm : null;
    }
  }

  const post = tables.get('post');
  const isFixedPitch = post ? view.getUint32(post.offset + 12) !== 0 : false;

  const axes: FvarAxis[] = [];
  const fvar = tables.get('fvar');
  if (fvar) {
    const axesOffset = fvar.offset + view.getUint16(fvar.offset + 4);
    const axisCount = view.getUint16(fvar.offset + 8);
    const axisSize = view.getUint16(fvar.offset + 10);
    for (let i = 0; i < axisCount; i += 1) {
      const record = axesOffset + i * axisSize;
      axes.push({ tag: tag(view, record), min: fixed(view, record + 4), default: fixed(view, record + 8), max: fixed(view, record + 12) });
    }
  }

  return {
    family,
    subfamily,
    typographicFamily: nameTable.get(16) ?? family,
    fullName: nameTable.get(4) ?? `${family} ${subfamily}`.trim(),
    version: nameTable.get(5) ?? '',
    unitsPerEm,
    weightClass,
    widthClass,
    xHeightRatio,
    capHeightRatio,
    isFixedPitch,
    italic,
    panose,
    licence: nameTable.get(13) ?? '',
    licenceUrl: nameTable.get(14) ?? '',
    axes,
    tables: [...tables.keys()].sort(),
  };
}

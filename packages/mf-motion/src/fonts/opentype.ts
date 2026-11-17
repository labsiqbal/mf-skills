// A small OpenType/TrueType table reader: just the tables mf-motion needs
// (name, OS/2, head, post, fvar). No native code, no font library.

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
    throw new Error('not an OpenType or TrueType font (collections and WOFF are not read)');
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

/** Read the tables mf-motion uses from a TTF/OTF file's bytes. */
export function readFont(bytes: Uint8Array): FontInfo {
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
    axes,
    tables: [...tables.keys()].sort(),
  };
}

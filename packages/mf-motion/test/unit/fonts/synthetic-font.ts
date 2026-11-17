// Builds a minimal sfnt with only the tables the reader uses (head, name,
// OS/2, post, optional fvar), so classification fixtures are exact.
export interface SyntheticFont {
  family: string;
  unitsPerEm?: number;
  xHeight?: number;
  panose?: number[];
  fixedPitch?: boolean;
  weightClass?: number;
  axes?: Array<{ tag: string; min: number; default: number; max: number }>;
}

function table(size: number) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function nameTable(family: string): Uint8Array {
  const records: Array<[number, string]> = [
    [1, family],
    [2, 'Regular'],
    [4, `${family} Regular`],
    [5, 'Version 1.000'],
  ];
  const strings = records.map(([, text]) => {
    const encoded = new Uint8Array(text.length * 2);
    const view = new DataView(encoded.buffer);
    for (let i = 0; i < text.length; i += 1) view.setUint16(i * 2, text.charCodeAt(i));
    return encoded;
  });
  const header = 6 + records.length * 12;
  const total = header + strings.reduce((sum, s) => sum + s.length, 0);
  const { bytes, view } = table(total);
  view.setUint16(0, 0);
  view.setUint16(2, records.length);
  view.setUint16(4, header);
  let offset = 0;
  records.forEach(([id], i) => {
    const record = 6 + i * 12;
    view.setUint16(record, 3);
    view.setUint16(record + 2, 1);
    view.setUint16(record + 4, 0x0409);
    view.setUint16(record + 6, id);
    view.setUint16(record + 8, strings[i]?.length ?? 0);
    view.setUint16(record + 10, offset);
    bytes.set(strings[i] ?? new Uint8Array(), header + offset);
    offset += strings[i]?.length ?? 0;
  });
  return bytes;
}

export function buildFont(spec: SyntheticFont): Uint8Array {
  const upem = spec.unitsPerEm ?? 1000;
  const head = table(54);
  head.view.setUint32(0, 0x00010000);
  head.view.setUint16(18, upem);
  const os2 = table(96);
  os2.view.setUint16(0, 4);
  os2.view.setUint16(4, spec.weightClass ?? 400);
  os2.view.setUint16(6, 5);
  (spec.panose ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).forEach((value, i) => os2.view.setUint8(32 + i, value));
  os2.view.setInt16(86, spec.xHeight ?? 0);
  os2.view.setInt16(88, Math.round(upem * 0.7));
  const post = table(32);
  post.view.setUint32(0, 0x00030000);
  post.view.setUint32(12, spec.fixedPitch ? 1 : 0);
  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.bytes],
    ['head', head.bytes],
    ['name', nameTable(spec.family)],
    ['post', post.bytes],
  ];
  if (spec.axes) {
    const fvar = table(16 + spec.axes.length * 20);
    fvar.view.setUint16(0, 1);
    fvar.view.setUint16(4, 16);
    fvar.view.setUint16(8, spec.axes.length);
    fvar.view.setUint16(10, 20);
    spec.axes.forEach((axis, i) => {
      const record = 16 + i * 20;
      for (let c = 0; c < 4; c += 1) fvar.view.setUint8(record + c, axis.tag.charCodeAt(c));
      fvar.view.setInt32(record + 4, Math.round(axis.min * 65536));
      fvar.view.setInt32(record + 8, Math.round(axis.default * 65536));
      fvar.view.setInt32(record + 12, Math.round(axis.max * 65536));
    });
    tables.push(['fvar', fvar.bytes]);
  }
  tables.sort(([a], [b]) => (a < b ? -1 : 1));
  const headerSize = 12 + tables.length * 16;
  const total = headerSize + tables.reduce((sum, [, bytes]) => sum + Math.ceil(bytes.length / 4) * 4, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let offset = headerSize;
  tables.forEach(([tag, bytes], i) => {
    const record = 12 + i * 16;
    for (let c = 0; c < 4; c += 1) view.setUint8(record + c, tag.charCodeAt(c));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, bytes.length);
    out.set(bytes, offset);
    offset += Math.ceil(bytes.length / 4) * 4;
  });
  return out;
}

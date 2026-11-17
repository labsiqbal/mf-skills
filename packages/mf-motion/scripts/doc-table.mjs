// Usage: node scripts/doc-table.mjs --doc <md> --section <heading> [--codes]
//                                   [--pattern <regex>] [--code <module>#<export>] [--out <json>]
//
// Extracts the first Markdown table of a section (rows keyed by header text,
// inline-code backticks removed) or, with --codes, the unique inline-code
// tokens of the section in order (only those matching --pattern, when given).
// The JSON written is a spec snapshot:
//   { "doc": "<file name>", "section": "<heading>", "mode": "table" | "codes",
//     "pattern": "<regex>" (optional), "code": "<module>#<export>" (optional),
//     "data": [...] }
// Snapshots committed under test/spec/ are checked by test/unit/spec: `data`
// must equal the named code export (called first when it is a function) and,
// when MFM_SPEC_DOCS points at the docs folder, a fresh extraction of the doc.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

function normalise(text) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Lines of one section: below its heading, up to the next heading of the same or a higher level. */
export function sectionLines(markdown, section) {
  const lines = markdown.split(/\r?\n/);
  const headings = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    const match = !fenced && HEADING.exec(line);
    if (match) headings.push({ index, level: match[1].length, text: match[2] });
  });
  const wanted = normalise(section);
  let found = headings.filter((heading) => normalise(heading.text) === wanted);
  if (found.length === 0) found = headings.filter((heading) => normalise(heading.text).startsWith(wanted));
  if (found.length !== 1) {
    const reason = found.length === 0 ? 'not found' : `ambiguous (${found.length} headings match)`;
    throw new Error(`section "${section}" ${reason}`);
  }
  const start = found[0];
  const end = headings.find((heading) => heading.index > start.index && heading.level <= start.level);
  return lines.slice(start.index + 1, end ? end.index : lines.length);
}

/** Split one table row into cells, honouring escaped pipes and pipes inside inline code. */
function cells(row) {
  let text = row.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const out = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (char === '`') {
      inCode = !inCode;
      current += char;
    } else if (char === '|' && !inCode) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((cell) => cell.trim().replace(/`([^`]*)`/g, '$1'));
}

const DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** The first table of a section as row objects keyed by header text. */
export function extractTable(markdown, section) {
  const lines = sectionLines(markdown, section);
  let fenced = false;
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (FENCE.test(lines[i])) fenced = !fenced;
    if (fenced || !lines[i].includes('|') || !DELIMITER.test(lines[i + 1])) continue;
    const header = cells(lines[i]);
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j += 1) {
      const values = cells(lines[j]);
      rows.push(Object.fromEntries(header.map((key, k) => [key, values[k] ?? ''])));
    }
    return rows;
  }
  throw new Error(`section "${section}" has no table`);
}

/** Unique inline-code tokens of a section, in order of first appearance, outside fenced blocks. */
export function extractCodes(markdown, section, pattern) {
  const keep = pattern ? new RegExp(pattern) : null;
  const seen = new Set();
  let fenced = false;
  for (const line of sectionLines(markdown, section)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      if (!keep || keep.test(match[1])) seen.add(match[1]);
    }
  }
  return [...seen];
}

/** Build a spec snapshot document. */
export function snapshot({ doc, section, codes = false, pattern, code }) {
  const markdown = readFileSync(doc, 'utf8');
  return {
    doc: basename(doc),
    section,
    mode: codes ? 'codes' : 'table',
    ...(codes && pattern ? { pattern } : {}),
    ...(code ? { code } : {}),
    data: codes ? extractCodes(markdown, section, pattern) : extractTable(markdown, section),
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      doc: { type: 'string' },
      section: { type: 'string' },
      codes: { type: 'boolean', default: false },
      pattern: { type: 'string' },
      code: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.doc || !values.section) {
    process.stderr.write('usage: doc-table.mjs --doc <md> --section <heading> [--codes [--pattern <regex>]] [--code <module>#<export>] [--out <json>]\n');
    process.exit(2);
  }
  let result;
  try {
    result = snapshot(values);
  } catch (error) {
    process.stderr.write(`doc-table: ${error.message}\n`);
    process.exit(1);
  }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) {
    mkdirSync(dirname(resolve(values.out)), { recursive: true });
    writeFileSync(values.out, json);
  } else {
    process.stdout.write(json);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

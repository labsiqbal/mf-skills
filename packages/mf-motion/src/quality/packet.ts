// The judge packet builder (judge-packet.md "Builder rules"): copies a round's
// sheets into rounds/<n>/packet/ under their role names, downscales images
// over the budget, writes facts.md from metrics.json (never from plan prose or
// notes) and packet.json with a content hash, so the same inputs always give
// the same packet.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import type { Engine } from '../engine/index';
import { NUMBERS } from '../kit/numbers';
import { probe } from '../media/probe';
import { type SheetItem, renderSheet } from '../media/sheet';
import { run } from '../proc/run';
import type { BrandDoc } from '../schemas/brand';
import { readDoc, writeDoc } from '../schemas/index';
import {
  type FactRow,
  MAX_FINDINGS,
  PACKET_BUDGET,
  type PacketRole,
  type UnitType,
  canonicalJson,
  checkBudget,
  packetFiles,
  packetHash,
  renderFacts,
  renderInstruction,
} from './packetSpec';
import { RUBRIC } from './rubric';

export interface PacketInput {
  /** rounds/<n>: holds metrics.json and the sheets. */
  roundDir: string;
  unit: { type: UnitType; id: string; version: string | null };
  /** Films: the brief's one-sentence purpose. */
  purpose?: string | null;
  /** Moves: the move's oneLiner and `say` triggers. */
  oneLiner?: string | null;
  say?: string[];
  /** Project brand folder (brand.json beside its files): draws brand-card.png when the round has none. */
  brandDir?: string | null;
  target?: 8 | 9;
  builder?: { provider: string | null; modelId: string | null };
  /** Lab packets add the uniqueness neighbours. */
  lab?: boolean;
  engine?: Engine;
  browserPath?: string;
}

export interface PacketFile {
  role: string;
  path: string;
  sha256: string;
  bytes: number;
}

export interface PacketResult {
  dir: string;
  hash: string;
  files: PacketFile[];
  /** Images left out to keep within PACKET_BUDGET.maxImages, as round file names. */
  dropped: string[];
  instruction: string;
}

/** The judge routes `packet` offers in `next`. */
export const JUDGE_ROUTES = [
  'Dispatch a fresh-context subagent with the packet folder and the judge instruction; it writes scores.json (judge mode fresh).',
  'Without subagents, judge the packet in this session with the same instruction and write scores.json (judge mode self).',
  'If you cannot see images, run `mf-motion gate --no-vision --json` (verdict level PASS-MEASURED).',
] as const;

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Round files for each role: the first match of each pattern, or every numbered one in order. */
function roundSources(roundDir: string): Record<PacketRole, string[]> {
  const names = existsSync(roundDir) ? readdirSync(roundDir).sort() : [];
  const first = (...candidates: string[]) => candidates.filter((name) => names.includes(name)).slice(0, 1);
  const numbered = (pattern: RegExp) => names.filter((name) => pattern.test(name));
  const full = (list: string[]) => list.map((name) => path.join(roundDir, name));
  return {
    beats: full(first('beats.jpg', 'beats.png')),
    seams: full(numbered(/^seams-\d{2}\.(jpg|png)$/)),
    phone: full(first('phone.png', 'phone.jpg')),
    dense: full(first('dense.png')),
    plates: full(first('plates.png')),
    finding: full(numbered(/^finding-\d{2}\.png$/)).slice(0, MAX_FINDINGS),
    'brand-card': full(first('brand-card.png')),
    facts: [],
    neighbours: full(numbered(/^neighbours-\d{2}\.png$/)),
  };
}

const ffmpegFlags = ['-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1'];

/** Write `source` as `out` within the size budget: converted when the type differs, downscaled while too large. */
async function budgetImage(source: string, out: string): Promise<void> {
  const info = await probe(source);
  const width = info.video?.width ?? 0;
  const height = info.video?.height ?? 0;
  const sameType = path.extname(source).toLowerCase() === path.extname(out).toLowerCase();
  const edge = Math.max(width, height);
  if (sameType && edge <= PACKET_BUDGET.maxEdgePx && statSync(source).size <= PACKET_BUDGET.maxBytes) {
    copyFileSync(source, out);
    return;
  }
  let scale = edge > PACKET_BUDGET.maxEdgePx ? PACKET_BUDGET.maxEdgePx / edge : 1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    // Even sizes; lanczos keeps sheet text readable.
    const w = Math.max(2, Math.floor((width * scale) / 2) * 2);
    const h = Math.max(2, Math.floor((height * scale) / 2) * 2);
    const quality = path.extname(out).toLowerCase() === '.jpg' ? ['-q:v', '3'] : [];
    const result = await run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vf', `scale=${w}:${h}:flags=lanczos`, ...quality, ...ffmpegFlags, '-frames:v', '1', out], { timeoutMs: 120_000 });
    if (result.spawnError) throw new MfmError('FFMPEG_MISSING', { tool: 'ffmpeg' });
    if (result.code !== 0) throw new MfmError('ENCODE_FAILED', { tool: 'ffmpeg', file: source, stderrTail: result.stderr.slice(-1500) }, { message: `FFmpeg could not write ${path.basename(out)}.` });
    if (statSync(out).size <= PACKET_BUDGET.maxBytes) return;
    scale *= 0.85;
  }
  throw new MfmError('ENCODE_FAILED', { file: source, bytes: statSync(out).size, limit: PACKET_BUDGET.maxBytes }, { message: `${path.basename(source)} stays over the packet size budget.` });
}

/** brand-card.png from the project's brand: logo, palette by role, type specimen. */
async function drawBrandCard(brandDir: string, out: string, options: { engine?: Engine; browserPath?: string }): Promise<boolean> {
  const file = path.join(brandDir, 'brand.json');
  if (!existsSync(file)) return false;
  const brand = readDoc('brand', file).doc as BrandDoc;
  const items: SheetItem[] = [];
  const logo = brand.logo ?? brand.mark;
  if (logo && logo.kind !== 'mp4' && existsSync(path.join(brandDir, logo.path))) items.push({ role: 'logo', image: path.join(brandDir, logo.path), label: 'logo', color: brand.colors.ground });
  const colors = brand.colors;
  for (const role of ['ground', 'surface', 'ink', 'muted', 'accent', 'accent2'] as const) {
    const color = colors[role];
    if (color) items.push({ role: 'swatch', color, label: role });
  }
  // One specimen per family (display and body often share one).
  const families = new Set<string>();
  for (const role of ['display', 'heading', 'body', 'mono'] as const) {
    const type = brand.type[role];
    if (!type || families.has(type.family)) continue;
    families.add(type.family);
    items.push({ role: 'specimen', sublabel: type.family, text: role === 'mono' ? brand.copy.domain ?? brand.name : (brand.copy.headline ?? brand.name) });
  }
  await renderSheet('brand-card', items, out, { title: brand.name, ...(options.engine ? { engine: options.engine } : {}), ...(options.browserPath ? { browserPath: options.browserPath } : {}) });
  return true;
}

/** Hard results and applied caps of metrics.json as facts.md rows. */
function factRows(metrics: { hard: Array<{ check: string; pass: boolean; value: number | string; limit: number | string }>; caps: Array<{ axis: string; cap: number; because: string }> }): FactRow[] {
  const rows: FactRow[] = metrics.hard.map((entry) => ({ check: entry.check, kind: 'hard', value: entry.value, limit: entry.limit, result: entry.pass ? 'pass' : 'fail' }));
  for (const cap of metrics.caps) rows.push({ check: cap.because.replace(/\|/g, '/'), kind: 'cap', value: '-', limit: '-', result: 'capped', cap: { axis: cap.axis, cap: cap.cap } });
  return rows;
}

/** Assemble rounds/<n>/packet/ and return its hash. */
export async function buildPacket(input: PacketInput): Promise<PacketResult> {
  const metricsFile = path.join(input.roundDir, 'metrics.json');
  if (!existsSync(metricsFile)) {
    throw new MfmError('PACKET_MISSING', { round: input.roundDir, missing: ['metrics.json'] }, { message: `${metricsFile} is missing; run measure before the packet.`, hint: 'Run `mf-motion measure <render> --json` for this round first.' });
  }
  const metrics = readDoc('metrics', metricsFile).doc;
  const spec = packetFiles(input.unit.type, metrics.profile, input.lab ? { lab: true } : {});
  const sources = roundSources(input.roundDir);
  const dir = path.join(input.roundDir, 'packet');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // The brand card is drawn from the project brand when the round has none.
  if (spec.required.includes('brand-card') && sources['brand-card'].length === 0 && input.brandDir) {
    const drawn = path.join(dir, '.brand-card.png');
    if (await drawBrandCard(input.brandDir, drawn, input)) sources['brand-card'] = [drawn];
  }

  const missing = spec.required.filter((role) => role !== 'facts' && sources[role].length === 0);
  if (missing.length > 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new MfmError('PACKET_MISSING', { round: input.roundDir, missing }, {
      message: `The round is missing ${missing.join(', ')} for a ${input.unit.type} packet.`,
      hint: 'Run `mf-motion sheets <render> --json` for this round (with --build for films), then run packet again.',
    });
  }

  // Image order decides what stays within the image budget: one of each required role first,
  // then the remaining seams and neighbours, then finding crops by severity.
  const imageRoles = spec.required.filter((role) => role !== 'facts');
  const ordered: Array<{ role: PacketRole; source: string }> = [];
  for (const role of imageRoles) ordered.push({ role, source: sources[role][0] as string });
  for (const role of imageRoles) for (const source of sources[role].slice(1)) ordered.push({ role, source });
  for (const role of spec.whenPresent) for (const source of sources[role]) ordered.push({ role, source });
  const kept = ordered.slice(0, PACKET_BUDGET.maxImages);
  const dropped = ordered.slice(PACKET_BUDGET.maxImages).map((entry) => path.basename(entry.source));

  const files: PacketFile[] = [];
  const counters: Partial<Record<PacketRole, number>> = {};
  const nameFor = (role: PacketRole) => {
    const n = (counters[role] ?? 0) + 1;
    counters[role] = n;
    const fixed: Partial<Record<PacketRole, string>> = { beats: 'beats.jpg', phone: 'phone.png', dense: 'dense.png', plates: 'plates.png', 'brand-card': 'brand-card.png' };
    return fixed[role] ?? `${role}-${String(n).padStart(2, '0')}.${role === 'seams' ? 'jpg' : 'png'}`;
  };
  for (const entry of kept) {
    const name = nameFor(entry.role);
    const out = path.join(dir, name);
    await budgetImage(entry.source, out);
    files.push({ role: entry.role, path: name, sha256: sha256(out), bytes: statSync(out).size });
  }
  rmSync(path.join(dir, '.brand-card.png'), { force: true });

  const images = await Promise.all(
    files.map(async (file) => {
      const info = await probe(path.join(dir, file.path));
      return { path: file.path, width: info.video?.width ?? 0, height: info.video?.height ?? 0, bytes: file.bytes };
    }),
  );
  const problems = checkBudget(images);
  if (problems.length > 0) throw new MfmError('INTERNAL', { problems }, { message: 'The packet images are still over the budget after downscaling.' });

  // facts.md: measured facts and the stated purpose only.
  const target = input.target ?? (NUMBERS['rubric.target.runtime'] as 8 | 9);
  const facts = renderFacts({
    unitType: input.unit.type,
    profile: metrics.profile,
    aspect: metrics.aspect,
    mode: metrics.mode,
    durationSec: metrics.durationSec,
    target,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.oneLiner ? { oneLiner: input.oneLiner } : {}),
    ...(input.say ? { say: input.say } : {}),
    facts: factRows(metrics),
  });
  writeFileSync(path.join(dir, 'facts.md'), facts);
  files.push({ role: 'facts', path: 'facts.md', sha256: sha256(path.join(dir, 'facts.md')), bytes: Buffer.byteLength(facts) });
  // metrics.json as normalised JSON, so formatting never changes the hash.
  const metricsCopy = path.join(dir, 'metrics.json');
  writeFileSync(metricsCopy, `${canonicalJson(JSON.parse(readFileSync(metricsFile, 'utf8')))}\n`);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'judge-packet',
    unit: input.unit,
    profile: metrics.profile,
    aspect: metrics.aspect,
    mode: metrics.mode,
    target,
    rubricVersion: RUBRIC.version,
    builder: input.builder ?? { provider: null, modelId: null },
    files,
    metrics: { path: 'metrics.json', sha256: sha256(metricsCopy) },
  };
  const hash = packetHash(manifest);
  writeDoc('judge-packet', path.join(dir, 'packet.json'), { ...manifest, hash } as never);
  return { dir, hash, files, dropped, instruction: renderInstruction(target, hash) };
}

/** The highest-numbered round folder of a project, or null. */
export function latestRound(project: string): number | null {
  const rounds = path.join(project, 'rounds');
  if (!existsSync(rounds)) return null;
  const numbers = readdirSync(rounds)
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .sort((a, b) => b - a);
  return numbers[0] ?? null;
}

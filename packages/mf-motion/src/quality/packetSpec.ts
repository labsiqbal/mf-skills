// The judge packet contract (judge-packet.md): which files a packet holds per
// unit type and profile, the size budget, the content hash over canonical
// JSON, the facts.md template and the judge instruction. The packet builder
// (MFM-038) and the lab share it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../engine/pins';
import type { Profile } from './profiles';

export type UnitType = 'film' | 'move' | 'theme';

export const PACKET_ROLES = ['beats', 'seams', 'phone', 'dense', 'plates', 'finding', 'brand-card', 'facts', 'neighbours'] as const;
export type PacketRole = (typeof PACKET_ROLES)[number];

/** File name of each role; NN numbers repeated roles from 01. */
export const ROLE_FILES: Record<PacketRole, string> = {
  beats: 'beats.jpg',
  seams: 'seams-NN.jpg',
  phone: 'phone.png',
  dense: 'dense.png',
  plates: 'plates.png',
  finding: 'finding-NN.png',
  'brand-card': 'brand-card.png',
  facts: 'facts.md',
  neighbours: 'neighbours-NN.png',
};

/** At most this many finding crops. */
export const MAX_FINDINGS = 6;

export interface PacketFileSpec {
  /** Roles every packet of this kind must hold. */
  required: PacketRole[];
  /** Roles included only when present (engine findings). */
  whenPresent: PacketRole[];
}

/** The roles of judge-packet.md "Contents per unit type". `lab` adds the uniqueness neighbours (moves and themes). */
export function packetFiles(unitType: UnitType, profile: Profile, options: { lab?: boolean } = {}): PacketFileSpec {
  const required: PacketRole[] = [];
  if (unitType !== 'move') required.push('beats', 'seams');
  required.push('phone', 'dense');
  if (unitType === 'move' && profile === 'overlay-alpha') required.push('plates');
  required.push('brand-card', 'facts');
  if (options.lab && unitType !== 'film') required.push('neighbours');
  return { required, whenPresent: ['finding'] };
}

/** The role a packet file name plays ("seams-03.jpg" -> seams), or null. */
export function roleOf(file: string): PacketRole | null {
  const name = path.basename(file);
  for (const role of PACKET_ROLES) {
    const pattern = new RegExp(`^${ROLE_FILES[role].replace('.', '\\.').replace('NN', '\\d{2}')}$`);
    if (pattern.test(name)) return role;
  }
  return null;
}

/** Size budget: one vision context. */
export const PACKET_BUDGET = { maxImages: 8, maxEdgePx: 2048, maxBytes: 1.5 * 1024 * 1024 } as const;

export interface PacketImage {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface BudgetProblem {
  path: string | null;
  problem: 'too-many-images' | 'too-long-edge' | 'too-large';
  value: number;
  limit: number;
}

/** Budget problems of a packet's images (an empty list passes). */
export function checkBudget(images: PacketImage[]): BudgetProblem[] {
  const problems: BudgetProblem[] = [];
  if (images.length > PACKET_BUDGET.maxImages) problems.push({ path: null, problem: 'too-many-images', value: images.length, limit: PACKET_BUDGET.maxImages });
  for (const image of images) {
    const edge = Math.max(image.width, image.height);
    if (edge > PACKET_BUDGET.maxEdgePx) problems.push({ path: image.path, problem: 'too-long-edge', value: edge, limit: PACKET_BUDGET.maxEdgePx });
    if (image.bytes > PACKET_BUDGET.maxBytes) problems.push({ path: image.path, problem: 'too-large', value: image.bytes, limit: PACKET_BUDGET.maxBytes });
  }
  return problems;
}

/** Packet roles missing from a list of file names. */
export function missingRoles(spec: PacketFileSpec, files: string[]): PacketRole[] {
  const present = new Set(files.map(roleOf).filter((role): role is PacketRole => role !== null));
  return spec.required.filter((role) => !present.has(role));
}

/** JSON with object keys sorted at every level and no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical JSON cannot hold a non-finite number');
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`;
}

/** sha256 over the canonical JSON of the manifest without `hash`. */
export function packetHash(manifest: Record<string, unknown>): string {
  const { hash: _ignored, ...rest } = manifest;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** The judge instruction template ({target} and {hash} slots), as shipped. */
export function judgeInstructionTemplate(): string {
  return readFileSync(path.join(packageRoot(), 'assets', 'rubric', 'judge-instruction.txt'), 'utf8');
}

/** The instruction with the target and the packet hash filled in. */
export function renderInstruction(target: number, hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`packet hash "${hash}" is not a sha256 hex digest`);
  return judgeInstructionTemplate().replaceAll('{target}', String(target)).replaceAll('{hash}', hash);
}

export interface FactRow {
  /** Check id or name. */
  check: string;
  kind: 'hard' | 'cap';
  value: string | number;
  limit: string | number;
  /** hard: passed; cap: the cap applies. */
  result: 'pass' | 'fail' | 'capped' | 'clear';
  /** The capped axis and cap, for caps that apply. */
  cap?: { axis: string; cap: number };
}

export interface FactsInput {
  unitType: UnitType;
  profile: Profile;
  aspect: string;
  mode: 'full' | 'alpha' | 'key';
  durationSec: number;
  target: number;
  /** Films: the brief's purpose sentence. */
  purpose?: string;
  /** Moves: the one-liner and the first two `say` triggers. */
  oneLiner?: string;
  say?: string[];
  facts: FactRow[];
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** facts.md: plain lines of measured facts, no builder adjectives. */
export function renderFacts(input: FactsInput): string {
  const lines = [
    '# Facts',
    '',
    `unit type: ${input.unitType}`,
    `profile: ${input.profile}`,
    `aspect: ${input.aspect}`,
    `mode: ${input.mode}`,
    `duration: ${Math.round(input.durationSec * 1000) / 1000} s`,
  ];
  if (input.unitType === 'film' && input.purpose) lines.push(`purpose: ${oneLine(input.purpose)}`);
  if (input.unitType === 'move') {
    if (input.oneLiner) lines.push(`one-liner: ${oneLine(input.oneLiner)}`);
    for (const say of (input.say ?? []).slice(0, 2)) lines.push(`say: ${oneLine(say)}`);
  }
  lines.push(`rubric target: ${input.target} on every axis`, '', '| check | kind | value | limit | result |', '|---|---|---|---|---|');
  for (const fact of input.facts) {
    const result = fact.cap && fact.result === 'capped' ? `capped: ${fact.cap.axis} at most ${fact.cap.cap}` : fact.result;
    lines.push(`| ${fact.check} | ${fact.kind} | ${fact.value} | ${fact.limit} | ${result} |`);
  }
  return `${lines.join('\n')}\n`;
}

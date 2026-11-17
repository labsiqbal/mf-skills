// The engine's own checks, reused: `check --json --snapshots --at-transitions`
// becomes check.json (counts, findings, snapshot and finding-crop files), and
// `snapshot --review --json` gives the beats, seam and phone sheets.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { MfmError } from '../cli/errors';
import { type Engine, check, ensureBrowser, ensureEngine, readOk, snapshotReview } from '../engine/index';

const Finding = v.strictObject({
  section: v.string(),
  code: v.string(),
  severity: v.string(),
  message: v.string(),
  atSec: v.nullable(v.number()),
  selector: v.nullable(v.string()),
});

const FindingCrop = v.strictObject({ code: v.string(), severity: v.string(), atSec: v.nullable(v.number()), path: v.string() });

/** check.json: the engine check of one build. */
export const CheckDocSchema = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.literal('check'),
  engineVersion: v.string(),
  errors: v.pipe(v.number(), v.integer(), v.minValue(0)),
  warnings: v.pipe(v.number(), v.integer(), v.minValue(0)),
  findings: v.array(Finding),
  /** Contrast-pass stills, absolute paths. */
  snapshots: v.array(v.string()),
  /** Engine crops of findings, most severe first, absolute paths. */
  findingCrops: v.array(FindingCrop),
});
export type CheckDoc = v.InferOutput<typeof CheckDocSchema>;

/** Validate a check.json value. */
export function parseCheck(value: unknown, source = 'check.json'): CheckDoc {
  const result = v.safeParse(CheckDocSchema, value);
  if (!result.success) {
    const issues = result.issues.map((issue) => ({ path: (issue.path ?? []).map((item) => String(item.key)).join('.'), message: issue.message }));
    throw new MfmError('SCHEMA_INVALID', { kind: 'check', file: source, issues }, { message: `${source} is not a valid check document.` });
  }
  return result.output;
}

/** Read and validate a check.json file. */
export function readCheck(file: string): CheckDoc {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new MfmError('SCHEMA_INVALID', { kind: 'check', file }, { message: `${file} is not valid JSON.` });
  }
  return parseCheck(value, file);
}

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };
const rank = (severity: string) => SEVERITY_RANK[severity] ?? 3;

/** Crops paired with their findings by code (the engine names them finding-NN-<code>.png), most severe first. */
export function cropsBySeverity(files: string[], findings: CheckDoc['findings']): CheckDoc['findingCrops'] {
  const used = new Set<number>();
  const crops = files.map((file, order) => {
    const code = path.basename(file).match(/^finding-\d+-(.+)\.png$/)?.[1] ?? '';
    const index = findings.findIndex((finding, i) => !used.has(i) && finding.code === code);
    if (index >= 0) used.add(index);
    const finding = findings[index];
    return { order, crop: { code, severity: finding?.severity ?? 'info', atSec: finding?.atSec ?? null, path: file } };
  });
  crops.sort((a, b) => rank(a.crop.severity) - rank(b.crop.severity) || a.order - b.order);
  return crops.map((entry) => entry.crop);
}

async function engineFor(engine: Engine | undefined): Promise<Engine> {
  const ready = engine ?? (await ensureEngine());
  if (!readOk(ready.dir)?.browserPath) await ensureBrowser(ready);
  return ready;
}

/** Run the engine check on a build folder and write check.json (default `<buildDir>/check.json`). */
export async function runCheck(buildDir: string, options: { engine?: Engine; at?: number[]; out?: string } = {}): Promise<{ file: string; doc: CheckDoc }> {
  const engine = await engineFor(options.engine);
  const result = await check(engine, buildDir, options.at ? { at: options.at } : {});
  const findings = result.findings.map((finding) => ({
    section: finding.section,
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    atSec: finding.time,
    selector: finding.selector,
  }));
  const doc = parseCheck({
    schemaVersion: 1,
    kind: 'check',
    engineVersion: engine.version,
    errors: result.errors,
    warnings: result.warnings,
    findings,
    snapshots: result.snapshots.map((file) => path.resolve(buildDir, file)),
    findingCrops: cropsBySeverity(
      result.findingFiles.map((file) => path.resolve(buildDir, file)),
      findings,
    ),
  });
  const file = options.out ?? path.join(buildDir, 'check.json');
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(temp, file);
  return { file, doc };
}

export interface ReviewSheets {
  beats: string[];
  seams: string[];
  phone: string[];
}

/** The engine's review sheets for a build folder (`snapshot --review --json`), written under `outDir`. */
export async function reviewSheets(buildDir: string, options: { engine?: Engine; outDir: string }): Promise<ReviewSheets> {
  const engine = await engineFor(options.engine);
  const result = await snapshotReview(engine, buildDir, options.outDir);
  const sheets = (result.raw as { review?: { sheets?: Partial<Record<keyof ReviewSheets, unknown>> } }).review?.sheets;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  if (sheets) return { beats: list(sheets.beats), seams: list(sheets.seams), phone: list(sheets.phone) };
  // Without the review block, sort the contact sheets by the engine's file names.
  const named = (pattern: RegExp) => result.sheets.filter((file) => pattern.test(path.basename(file)));
  return { beats: named(/^review-beats/), seams: named(/^review-seam-/), phone: named(/^review-phone/) };
}

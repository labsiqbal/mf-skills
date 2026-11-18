// Writes the gate fixtures: one tiny round folder per case (metrics.json,
// packet/ with placeholder sheets, facts.md, the packet's metrics copy and
// packet.json, and scores.json, lint.json, audit.json or check.json when the
// case needs them) plus expect.json with the runs and their expected verdicts.
// Regenerate: see README.md.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalJson, packetHash } from '../../../src/quality/packetSpec';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(path.join(here, '..', 'packets', 'film-round', 'metrics.json'), 'utf8'));
const AXES = ['hook', 'brand', 'motion', 'legibility', 'rhythm', 'finish'] as const;
// A valid 1 x 1 PNG: the gate hashes packet files, it does not decode them.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const AT = '2026-11-18T09:00:00.000Z';

interface Run {
  args?: { library?: boolean; noVision?: boolean; target?: 8 | 9 };
  level?: string;
  code?: string;
  hardFailures?: string[];
  capped?: Array<{ axis: string; raw: number; capped: number }>;
}

interface Case {
  about: string;
  profile?: string;
  mode?: 'full' | 'alpha' | 'key';
  hard?: Array<{ check: string; value: number | string; limit: number | string }>;
  caps?: Array<{ axis: string; cap: number; because: string }>;
  longestStillSec?: number;
  /** Score on every axis (or per axis), judge mode and provider; null: no scores. */
  scores?: { all?: number; axes?: Partial<Record<(typeof AXES)[number], number>>; mode?: 'fresh' | 'self'; provider?: string | null; fixFor?: string[]; packetHash?: string } | null;
  builder?: string | null;
  lint?: number;
  runs: Run[];
}

const fresh = (all: number) => ({ all, mode: 'fresh' as const, provider: 'openai' });

const cases: Record<string, Case> = {
  'high-scores-measured-defect': {
    about: 'All axes 10 from a fresh judge; the longest still is 3.1 s, so rhythm is capped to 6.',
    longestStillSec: 3.1,
    caps: [{ axis: 'rhythm', cap: 6, because: 'Longest still 3.1 s over its limit (2 s)' }],
    scores: fresh(10),
    runs: [{ level: 'FAIL', hardFailures: [], capped: [{ axis: 'rhythm', raw: 10, capped: 6 }] }],
  },
  'hard-failure-perfect-scores': {
    about: 'Copy outside the copy-safe box; all axes 10: no score overrules it.',
    hard: [{ check: 'copy-safe', value: 3, limit: 0 }],
    scores: fresh(10),
    runs: [{ level: 'FAIL', hardFailures: ['copy-safe'], capped: [] }],
  },
  'no-vision': {
    about: 'No scores and no hard failures, judged with --no-vision.',
    scores: null,
    runs: [{ args: { noVision: true }, level: 'PASS-MEASURED', hardFailures: [] }, { code: 'SCORES_INVALID' }],
  },
  'self-judge': {
    about: 'All axes 9 from the building session: PASS-SELF at runtime, FAIL in library mode.',
    scores: { all: 9, mode: 'self', provider: 'anthropic' },
    builder: 'anthropic',
    runs: [{ level: 'PASS-SELF' }, { args: { library: true }, level: 'FAIL' }],
  },
  'stale-scores': {
    about: 'scores.json written for another packet.',
    scores: { ...fresh(9), packetHash: 'f'.repeat(64) },
    runs: [{ code: 'SCORES_STALE' }],
  },
  'same-family-library': {
    about: 'Library mode where the judge and the builder share a provider.',
    scores: { all: 9, mode: 'fresh', provider: 'anthropic' },
    builder: 'anthropic',
    runs: [{ args: { library: true }, code: 'JUDGE_NOT_INDEPENDENT', level: 'FAIL' }, { level: 'PASS' }],
  },
  'missing-fix': {
    about: 'Rhythm scored 7 under target 8 without a fix line.',
    scores: { all: 9, axes: { rhythm: 7 }, mode: 'fresh', provider: 'openai' },
    runs: [{ code: 'SCORES_INVALID' }],
  },
  'below-target': {
    about: 'Rhythm scored 7 with a fix line: FAIL below target.',
    scores: { all: 9, axes: { rhythm: 7 }, mode: 'fresh', provider: 'openai', fixFor: ['rhythm'] },
    runs: [{ level: 'FAIL', hardFailures: [], capped: [] }],
  },
  'clean-pass': {
    about: 'All axes 9 from a fresh judge of another family: PASS at runtime and in library mode.',
    scores: fresh(9),
    builder: 'anthropic',
    runs: [{ level: 'PASS' }, { args: { library: true }, level: 'PASS' }, { args: { target: 9 }, level: 'PASS' }],
  },
};

// One fixture per hard check: the failing entry in metrics.hard (lint through lint.json), perfect scores.
const HARD: Array<[string, string, number | string, number | string, string?]> = [
  ['duration', 'film', '4.2 s', '4 s +-1 frame'],
  ['timestamps', 'film', 3.4, 1],
  ['overlay-empty', 'overlay-alpha', 'first 0.4, last 0, first ink 0.1 s', 'coverage <= 0.002, first ink <= 0.3 s'],
  ['key-purity', 'overlay-key', 12, 0],
  ['contrast-hard', 'film', 2.4, 3],
  ['frame-margin', 'film', 2, 0],
  ['copy-safe', 'broll', 1, 0],
  ['caption-band', 'overlay-alpha', 1, 0],
  ['spill', 'film', 1, 0],
  ['overlap', 'film', 2, 0],
  ['engine-errors', 'film', 1, 0],
  ['true-peak', 'film', -0.3, -1],
];
for (const [check, profile, value, limit] of HARD) {
  cases[`hard-${check}`] = {
    about: `Hard check ${check} failed (${profile}); perfect scores.`,
    profile,
    ...(profile === 'overlay-alpha' ? { mode: 'alpha' as const } : profile === 'overlay-key' ? { mode: 'key' as const } : {}),
    hard: [{ check, value, limit }],
    scores: fresh(10),
    runs: [{ level: 'FAIL', hardFailures: [check] }],
  };
}
cases['hard-lint'] = { about: 'Two lint errors in lint.json; perfect scores.', lint: 2, scores: fresh(10), runs: [{ level: 'FAIL', hardFailures: ['lint'] }] };

// One fixture per cap: the cap in metrics.caps, fresh judge at 10. Caps under the target fail; a cap at 8 passes target 8, capped.
const CAPS: Array<[string, string, number, string]> = [
  ['frame0-ink', 'hook', 5, 'Frame 0 ink 0.01 under 0.02'],
  ['still', 'rhythm', 6, 'Longest still 3.1 s over its limit (2 s)'],
  ['contrast-soft', 'legibility', 6, 'Contrast 3.6 on headline under 4.5'],
  ['min-size', 'legibility', 6, 'Text 20 px under 28 px'],
  ['reading-hold', 'legibility', 7, 'quick holds 0.6 s for 6 words (needs 2.3 s)'],
  ['face-band', 'finish', 6, 'Text in the face band'],
  ['engine-warnings', 'finish', 8, '3 engine check warnings'],
  ['loudness', 'finish', 7, 'Loudness -18 LUFS (target -14 +-1)'],
  ['low-share', 'finish', 8, 'Bed low-end share 0.7 over 0.55'],
  ['sfx-timing', 'rhythm', 7, 'SFX cta at 1.5 s peaks 116.7 ms after the picture'],
  ['sfx-rise', 'rhythm', 8, 'SFX rise under the minimum: badge at 3.5 s rises 1 dB'],
];
for (const [name, axis, cap, because] of CAPS) {
  cases[`cap-${name}`] = {
    about: `Measured cap ${name}: ${axis} at most ${cap}; fresh judge at 10.`,
    caps: [{ axis, cap, because }],
    scores: fresh(10),
    runs: [{ level: cap < 8 ? 'FAIL' : 'PASS', hardFailures: [], capped: [{ axis, raw: 10, capped: cap }] }],
  };
}

for (const [name, spec] of Object.entries(cases)) {
  const dir = path.join(here, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'packet'), { recursive: true });
  const metrics = {
    ...base,
    profile: spec.profile ?? 'film',
    mode: spec.mode ?? 'full',
    hard: [...base.hard.filter((entry: { check: string }) => !(spec.hard ?? []).some((h) => h.check === entry.check)), ...(spec.hard ?? []).map((entry) => ({ ...entry, pass: false }))],
    caps: spec.caps ?? [],
    ...(spec.longestStillSec !== undefined ? { longestStillSec: spec.longestStillSec } : {}),
  };
  writeFileSync(path.join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  const metricsCopy = `${canonicalJson(metrics)}\n`;
  writeFileSync(path.join(dir, 'packet', 'metrics.json'), metricsCopy);
  const facts = `# Facts\n\nunit type: film\nprofile: ${metrics.profile}\nfixture: ${name}\n`;
  const files: Array<{ role: string; path: string; sha256: string; bytes: number }> = [];
  for (const [role, file] of [['brand-card', 'brand-card.png'], ['dense', 'dense.png'], ['phone', 'phone.png']] as const) {
    writeFileSync(path.join(dir, 'packet', file), PNG);
    files.push({ role, path: file, sha256: sha(PNG), bytes: PNG.length });
  }
  writeFileSync(path.join(dir, 'packet', 'facts.md'), facts);
  files.push({ role: 'facts', path: 'facts.md', sha256: sha(facts), bytes: Buffer.byteLength(facts) });
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'judge-packet',
    unit: { type: 'film', id: `gate-${name}`.slice(0, 48).replace(/-+$/, ''), version: null },
    profile: metrics.profile,
    aspect: metrics.aspect,
    mode: metrics.mode,
    target: 8,
    rubricVersion: '1.0.0',
    builder: { provider: spec.builder ?? null, modelId: spec.builder ? `${spec.builder}-builder` : null },
    files,
    metrics: { path: 'metrics.json', sha256: sha(metricsCopy) },
  };
  const hash = packetHash(manifest);
  writeFileSync(path.join(dir, 'packet', 'packet.json'), `${JSON.stringify({ ...manifest, hash }, null, 2)}\n`);
  if (spec.scores) {
    const s = spec.scores;
    const axes = Object.fromEntries(
      AXES.map((axis) => {
        const score = s.axes?.[axis] ?? s.all ?? 9;
        const fixes = (s.fixFor ?? []).includes(axis) ? [{ at: '1.20-2.40', where: 'headline', problem: 'holds 0.6 s for 6 words', change: 'move the exit from 1.45 s to 3.2 s' }] : [];
        return [axis, { score, notes: [], fixes }];
      }),
    );
    const scores = { schemaVersion: 1, kind: 'scores', packetHash: s.packetHash ?? hash, judge: { mode: s.mode ?? 'fresh', context: s.mode === 'self' ? 'same-session' : 'subagent', provider: s.provider ?? null, modelId: s.provider ? `${s.provider}-judge` : null }, axes, at: AT };
    writeFileSync(path.join(dir, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
  }
  if (spec.lint !== undefined) {
    const errors = Array.from({ length: spec.lint }, (_, i) => ({ code: 'SEC001', file: 'index.html', line: 10 + i, col: 1, message: 'Network URL in a script src.' }));
    writeFileSync(path.join(dir, 'lint.json'), `${JSON.stringify({ schemaVersion: 1, kind: 'lint', errors, warnings: [] }, null, 2)}\n`);
  }
  writeFileSync(path.join(dir, 'expect.json'), `${JSON.stringify({ about: spec.about, runs: spec.runs }, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(cases).length} gate fixtures`);

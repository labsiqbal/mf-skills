// The rubric as data: equal to rubric.md (snapshots, and the live doc with
// MFM_SPEC_DOCS), versioned by a hash of its wording, rendered to the
// judge-facing asset, and applied to measurements by capFor.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AXES, type CapMetrics, RUBRIC, type Rubric, capFor, capsTable, rubricHash, rubricMarkdown } from '../../../../src/quality/rubric';
import { NUMBERS } from '../../../../src/kit/numbers';
import { parseDoc } from '../../../../src/schemas/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../../../..');
const anchorTables = JSON.parse(readFileSync(path.join(here, 'anchors.json'), 'utf8')) as Array<{ doc: string; section: string; data: Array<{ Score: string; Anchor: string }> }>;
const capsSpec = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'spec', 'rubric.json'), 'utf8')) as { data: unknown };
const asset = path.join(packageRoot, 'assets', 'rubric', `rubric-${RUBRIC.version}.md`);
const metricsFixture = JSON.parse(readFileSync(path.join(packageRoot, 'test', 'fixtures', 'schemas', 'metrics.valid.json'), 'utf8')) as CapMetrics;

/**
 * Every released rubric version and the hash of its wording. A wording change
 * fails here until it gets a new version and a new line; old lines never change.
 */
const RELEASED: Record<string, string> = {
  '1.0.0': '3f993dc4808e45f20e47c1951af7a33f7d2532c30b94d9c8dea7a0fdab4981f8',
};

const clone = (): Rubric => JSON.parse(JSON.stringify(RUBRIC)) as Rubric;

describe('RUBRIC', () => {
  it('holds the six axes, the anchor tables and the caps of rubric.md', () => {
    expect(RUBRIC.axes).toEqual(NUMBERS['rubric.axes']);
    expect(RUBRIC.axes).toEqual(AXES);
    expect(anchorTables.map((table) => table.section)).toEqual([...AXES]);
    for (const table of anchorTables) {
      expect(RUBRIC.anchors[table.section as (typeof AXES)[number]].map(({ score, anchor }) => ({ Score: score, Anchor: anchor }))).toEqual(table.data);
    }
    expect(capsTable()).toEqual(capsSpec.data);
    expect(RUBRIC.target).toEqual({ runtime: 8, library: 9 });
    expect(Object.isFrozen(RUBRIC.anchors.hook[0])).toBe(true);
  });

  it('matches the hash recorded for its version', () => {
    expect(RELEASED[RUBRIC.version], `rubric ${RUBRIC.version} is not a released version`).toBeDefined();
    expect(rubricHash()).toBe(RELEASED[RUBRIC.version]);
  });

  it('a changed anchor, question, note or cap without a version bump fails the hash check', () => {
    const changes: Array<(rubric: Rubric) => void> = [
      (rubric) => {
        rubric.anchors.motion[2] = { score: '8', anchor: 'Purposeful and varied; some moves feel mechanical.' };
      },
      (rubric) => {
        rubric.questions.brand = "Would the brand's designer recognise this as theirs?";
      },
      (rubric) => {
        rubric.notes.rhythm = 'For silent moves, rhythm judges cadence.';
      },
      (rubric) => {
        rubric.caps[6] = { defect: 'Engine check warnings, 3 or more', axis: 'finish', cap: 7 };
      },
    ];
    for (const change of changes) {
      const edited = clone();
      change(edited);
      expect(rubricHash(edited)).not.toBe(RELEASED[edited.version]);
    }
  });

  const docs = process.env.MFM_SPEC_DOCS;
  it.runIf(docs)('equals the live rubric.md: anchors, caps, questions, notes, scale and fix lines', async () => {
    const file = path.join(docs ?? '', 'rubric.md');
    const { snapshot } = (await import(pathToFileURL(path.join(packageRoot, 'scripts', 'doc-table.mjs')).href)) as {
      snapshot: (options: { doc: string; section: string }) => { data: unknown };
    };
    for (const table of anchorTables) expect(snapshot({ doc: file, section: table.section }).data, table.section).toEqual(table.data);
    expect(snapshot({ doc: file, section: 'Measured caps' }).data).toEqual(capsTable());
    const markdown = readFileSync(file, 'utf8');
    for (const axis of AXES) {
      expect(markdown).toContain(`Question: ${RUBRIC.questions[axis]}\n`);
      const note = RUBRIC.notes[axis];
      if (note) expect(markdown).toContain(`\n${note}\n`);
    }
    for (const sentence of RUBRIC.scale.split(/(?<=\.) /)) expect(markdown).toContain(sentence);
    expect(markdown).toContain(`\n${RUBRIC.fixLines}`);
    expect(markdown).toContain(`Rubric version \`${RUBRIC.version}\``);
  });
});

describe('rubric asset', () => {
  it('assets/rubric/rubric-<version>.md is generated from RUBRIC', () => {
    // MFM_WRITE_RUBRIC=1 regenerates the asset after a version bump.
    if (process.env.MFM_WRITE_RUBRIC === '1') writeFileSync(asset, rubricMarkdown());
    expect(existsSync(asset), `${asset} is missing; run the test with MFM_WRITE_RUBRIC=1`).toBe(true);
    expect(readFileSync(asset, 'utf8')).toBe(rubricMarkdown());
    const text = rubricMarkdown();
    for (const axis of AXES) {
      expect(text).toContain(`## ${axis}\n\nQuestion: ${RUBRIC.questions[axis]}`);
      for (const anchor of RUBRIC.anchors[axis]) expect(text).toContain(`| ${anchor.score} | ${anchor.anchor} |`);
    }
    expect(text).toContain(RUBRIC.notes.hook ?? '');
    expect(text).toContain(RUBRIC.notes.rhythm ?? '');
    expect(text).not.toMatch(/Measured caps/);
  });
});

describe('capFor', () => {
  const metrics = (change: (m: CapMetrics) => void): CapMetrics => {
    const copy = JSON.parse(JSON.stringify(metricsFixture)) as CapMetrics;
    change(copy);
    return copy;
  };

  it('finds no caps in the valid fixture', () => {
    expect(capFor(metricsFixture)).toEqual([]);
  });

  it('a 2.6 s still caps rhythm at 6; 3 engine warnings cap finish at 8', () => {
    const capped = capFor(
      metrics((m) => {
        m.stills.push({ fromSec: 6.0, toSec: 8.6, lenSec: 2.6, exempt: null });
        m.engineCheck.warnings = 3;
      }),
    );
    expect(capped.map(({ axis, cap }) => ({ axis, cap }))).toEqual([
      { axis: 'rhythm', cap: 6 },
      { axis: 'finish', cap: 8 },
    ]);
    expect(capped[0]?.because).toBe('Longest still stretch over its limit: 2.6 s still at 6-8.6 s (limit 2 s)');
    expect(capped[1]?.because).toBe('Engine check warnings, 3 or more: 3 warnings');
    expect(capFor(metrics((m) => void (m.engineCheck.warnings = 2)))).toEqual([]);
  });

  it('respects the end-card and hold limits for exempt stills', () => {
    expect(capFor(metrics((m) => m.stills.push({ fromSec: 2, toSec: 5.9, lenSec: 3.9, exempt: 'hold' })))).toEqual([]);
    expect(capFor(metrics((m) => m.stills.push({ fromSec: 2, toSec: 6.1, lenSec: 4.1, exempt: 'hold' }))).map((cap) => cap.cap)).toEqual([6]);
    expect(capFor(metrics((m) => m.stills.push({ fromSec: 16, toSec: 19.6, lenSec: 3.6, exempt: 'end-card' }))).map((cap) => cap.axis)).toEqual(['rhythm']);
  });

  it('caps every other measured defect on its axis', () => {
    const all = capFor(
      metrics((m) => {
        m.frame0Ink = 0.01;
        m.contrast.push({ atSec: 3, elementId: 'sub', ratio: 3.8 });
        m.audit.hits.push({ fromSec: 4, elementId: 'small', problem: 'min-size' }, { fromSec: 5, elementId: 'name', problem: 'face-band' });
        m.lines.push({ elementId: 'fast', holdSec: 0.6, words: 6, ok: false });
        if (m.audio) {
          m.audio.lufs = -16.2;
          m.audio.lowShare = 0.6;
          m.audio.sfx.push({ event: 'late', atSec: 9, peakOffsetMs: 70, riseDb: 2.5 });
        }
      }),
    );
    expect(all.map(({ axis, cap }) => `${axis}:${cap}`)).toEqual([
      'hook:5',
      'legibility:6',
      'legibility:6',
      'legibility:7',
      'finish:6',
      'finish:7',
      'finish:8',
      'rhythm:7',
      'rhythm:8',
    ]);
    // Contrast below contrast.hardMin is a hard failure, not a cap.
    expect(capFor(metrics((m) => m.contrast.push({ atSec: 1, elementId: 'x', ratio: 2.4 })))).toEqual([]);
  });

  it('a 1:1 overlay short-line hit validates in metrics.json and caps like min-size (v1.2)', () => {
    const doc = JSON.parse(JSON.stringify(metricsFixture)) as Record<string, any>;
    doc.audit.hits.push({ fromSec: 0.2, toSec: 5.7, elementId: 'mc-first', problem: 'short-line' });
    expect(parseDoc('metrics', doc).doc.audit.hits.at(-1)?.problem).toBe('short-line');
    const short = capFor(metrics((m) => m.audit.hits.push({ fromSec: 0.2, elementId: 'mc-first', problem: 'short-line' })));
    const small = capFor(metrics((m) => m.audit.hits.push({ fromSec: 0.2, elementId: 'mc-first', problem: 'min-size' })));
    expect(short).toEqual(small);
    expect(short.map(({ axis, cap }) => `${axis}:${cap}`)).toEqual([`${RUBRIC.caps[3]?.axis}:${RUBRIC.caps[3]?.cap}`]);
    // One cap per defect: a min-size and a short-line hit together still cap once.
    expect(capFor(metrics((m) => m.audit.hits.push({ fromSec: 1, elementId: 'a', problem: 'short-line' }, { fromSec: 2, elementId: 'b', problem: 'min-size' })))).toHaveLength(1);
  });
});

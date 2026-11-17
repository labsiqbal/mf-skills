// Signature distance, nearest neighbours, the publish-time comparison plan and
// the spec-time spread rule.
import { describe, expect, it } from 'vitest';
import { MfmError } from '../../../../src/cli/errors';
import { type Unit, assertUnique, comparisonPlan, distance, nearest, signatureKind, specSpread } from '../../../../src/library/signature';
import type { MoveSignatureValue, ThemeSignatureValue } from '../../../../src/schemas/signature';

const base: MoveSignatureValue = { layout: 'single-hero', motion: 'assemble', material: 'flat', data: 'none', use: 'proof' };
const move = (id: string, category: string, change: Partial<MoveSignatureValue> = {}): Unit => ({ id, category, signature: { ...base, ...change } });
const theme: ThemeSignatureValue = { pace: 'bar-cuts', grammar: 'product-hero', material: 'flat-ui', palette: 'brand-dark', type: 'grotesk-tight', sound: 'driving' };

const LAYOUTS = ['single-hero', 'stack', 'grid', 'row', 'radial', 'path', 'split', 'frame-in-frame', 'full-bleed', 'corner-callout'] as const;
const MOTIONS = ['assemble', 'reveal-wipe', 'type-on', 'count-up', 'grow', 'sort', 'draw-on', 'pop-sequence', 'flip', 'slide-through'] as const;
const USES = ['proof', 'reaction', 'emphasis', 'process', 'comparison'] as const;

/** Ten varied, distinct concepts of one category. */
function spreadCategory(category: string, layouts: readonly MoveSignatureValue['layout'][] = LAYOUTS): Unit[] {
  return Array.from({ length: 10 }, (_, i) =>
    move(`${category}-${String(i + 1).padStart(2, '0')}`, category, {
      layout: layouts[i % layouts.length] as MoveSignatureValue['layout'],
      motion: MOTIONS[i] as MoveSignatureValue['motion'],
      use: USES[i % USES.length] as MoveSignatureValue['use'],
    }),
  );
}

describe('distance', () => {
  it('counts differing fields: moves 0-5, themes 0-6', () => {
    expect(distance(base, { ...base })).toBe(0);
    expect(distance(base, { ...base, layout: 'grid', use: 'reaction' })).toBe(2);
    expect(distance(base, { layout: 'orbit', motion: 'pan-scan', material: 'neon-line', data: 'timeline', use: 'navigation' })).toBe(5);
    expect(distance(theme, { pace: 'loop', grammar: 'collage', material: 'neon', palette: 'duotone', type: 'mono-technical', sound: 'lofi' })).toBe(6);
    expect(signatureKind(theme)).toBe('theme');
  });

  it('refuses mixed kinds and values outside the vocabularies', () => {
    expect(() => distance(base, theme)).toThrow(MfmError);
    expect(() => distance(base, { ...base, layout: 'spiral' } as unknown as MoveSignatureValue)).toThrow(/closed vocabularies/);
  });
});

describe('nearest', () => {
  it('sorts by distance, then category, then id, and leaves the candidate out', () => {
    const candidate = move('data-01', 'data');
    const units = [
      candidate,
      move('social-02', 'social', { use: 'reaction' }),
      move('ai-09', 'ai', { material: 'glass' }),
      move('ai-03', 'ai', { data: 'series' }),
      move('dev-01', 'dev', { layout: 'grid', use: 'process' }),
      move('business-01', 'business', { layout: 'row', motion: 'grow', data: 'series' }),
    ];
    expect(nearest(candidate, units, 4)).toEqual([
      { id: 'ai-03', category: 'ai', distance: 1 },
      { id: 'ai-09', category: 'ai', distance: 1 },
      { id: 'social-02', category: 'social', distance: 1 },
      { id: 'dev-01', category: 'dev', distance: 2 },
    ]);
    expect(nearest(candidate, units, 0)).toEqual([]);
  });

  it('plans duplicates, every distance-1 neighbour and the 3 nearest distance-2 neighbours', () => {
    const candidate = move('cand', 'data');
    const units = [
      move('twin', 'social'),
      move('one', 'ai', { use: 'reaction' }),
      ...['d', 'c', 'b', 'a'].map((id) => move(`two-${id}`, 'dev', { layout: 'grid', use: 'process' })),
      move('far', 'dev', { layout: 'grid', motion: 'grow', use: 'process' }),
    ];
    const plan = comparisonPlan(candidate, units);
    expect(plan.duplicates.map((unit) => unit.id)).toEqual(['twin']);
    expect(plan.compare.map((unit) => unit.id)).toEqual(['one', 'two-a', 'two-b', 'two-c']);
    expect(() => assertUnique(candidate, units)).toThrow(expect.objectContaining({ code: 'SIGNATURE_DUPLICATE', details: expect.objectContaining({ ids: ['cand', 'twin'] }) }));
    expect(() => assertUnique(candidate, units.slice(1))).not.toThrow();
  });
});

describe('specSpread', () => {
  it('passes a varied category', () => {
    expect(specSpread(spreadCategory('data'))).toEqual({ ok: true, problems: [] });
  });

  it('two identical move signatures have distance 0 and report SIGNATURE_DUPLICATE with the colliding ids', () => {
    const concepts = spreadCategory('data');
    const copy = { ...concepts[3], id: 'social-07', category: 'social' } as Unit;
    expect(distance(copy.signature, (concepts[3] as Unit).signature)).toBe(0);
    const report = specSpread([...concepts, copy]);
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([expect.objectContaining({ code: 'SIGNATURE_DUPLICATE', ids: ['data-04', 'social-07'] })]);
  });

  it('ten concepts with only 3 layouts fail the spread rule naming layout', () => {
    const report = specSpread(spreadCategory('dev', ['stack', 'grid', 'row']));
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([expect.objectContaining({ code: 'SPREAD', category: 'dev', field: 'layout', distinct: 3, min: 4 })]);
    expect(report.problems[0]?.message).toContain('3 distinct layout value(s); the rule needs 4');
  });

  it('checks motions and uses, each run of 10 separately, and a short last run by its share', () => {
    const flat = spreadCategory('ai').map((concept, i) =>
      move(concept.id, 'ai', { ...(concept.signature as MoveSignatureValue), motion: MOTIONS[i % 4] as MoveSignatureValue['motion'], use: USES[i % 2] as MoveSignatureValue['use'] }),
    );
    const fields = specSpread(flat).problems.map((problem) => (problem.code === 'SPREAD' ? problem.field : problem.code));
    expect(fields).toEqual(['motion', 'use']);
    // A second run of 5 needs ceil(4 * 5 / 10) = 2 layouts.
    const second = spreadCategory('ai').map((concept, i) => move(`ai-${11 + i}`, 'ai', { ...(concept.signature as MoveSignatureValue), layout: 'band', material: 'riso' }));
    const report = specSpread([...spreadCategory('ai'), ...second.slice(0, 5)]);
    expect(report.problems).toEqual([expect.objectContaining({ code: 'SPREAD', field: 'layout', distinct: 1, min: 2, ids: ['ai-11', 'ai-12', 'ai-13', 'ai-14', 'ai-15'] })]);
  });
});

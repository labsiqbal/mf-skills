// Builders (html escaping, line(), the type ramp) and the text-line rules the
// runtime shares with Node (cues, splits, durations, counts).
import { describe, expect, it } from 'vitest';
import { escapeHtml, html, isTrusted, trusted } from '../../../../src/kit/build/html';
import { TYPE_ROLES, line, typeCss, typeRamp } from '../../../../src/kit/build/type';
import { NUMBERS } from '../../../../src/kit/numbers';
import {
  ENTRANCE_KINDS,
  EXIT,
  EXIT_KINDS,
  entranceDuration,
  exitDuration,
  formatCount,
  hasComplexScript,
  parseCount,
  parseEntrance,
  parseExit,
  splitFor,
} from '../../../../src/kit/runtime/spec';
import { entranceSeconds } from '../../../../src/lint/numbers';

describe('html', () => {
  it('escapes every interpolation and keeps nested html and trusted() raw', () => {
    const hostile = '</script><img src=x onerror="alert(1)">\'`&';
    expect(html`<p title="${hostile}">${hostile}</p>`.value).toBe(
      '<p title="&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&#96;&amp;">&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&#96;&amp;</p>',
    );
    const inner = html`<b>${'a<b'}</b>`;
    expect(html`<div>${inner}${trusted('<i>kit</i>')}${['x', '<y>']}${null}${undefined}${false}${0}</div>`.value).toBe('<div><b>a&lt;b</b><i>kit</i>x&lt;y&gt;0</div>');
    expect(isTrusted(inner)).toBe(true);
    expect(isTrusted({ value: '<i>' })).toBe(false);
    expect(escapeHtml('"')).toBe('&quot;');
  });
});

describe('line', () => {
  it('emits an mf-line with its cues, escaped text and attributes', () => {
    expect(line({ text: 'Fast <b>times</b>', role: 'title', in: 'words@bar2+0.5b', out: 'fall@bar4-0.25s', accent: true, id: 'h1', variable: 'headline' }).value).toBe(
      '<div class="mf-line mf-role-title" id="h1" data-mf-in="words@bar2+0.5b" data-mf-out="fall@bar4-0.25s" data-mf-accent data-mf-var="headline">Fast &lt;b&gt;times&lt;/b&gt;</div>',
    );
    expect(line({ text: 'قصص هادئة', role: 'hero', in: 'letters@0', out: 'end', tag: 'h1' }).value).toContain('<h1 class="mf-line mf-role-hero" data-mf-in="letters@0" data-mf-out="end" dir="rtl">');
    expect(line({ text: 'Saturday', role: 'label', in: 'slot@1', out: 'cut@3', options: ['Monday', 'Tue"sday'] }).value).toContain('data-mf-options="Monday|Tue&quot;sday"');
    expect(line({ text: '12,480', role: 'title', in: 'count@1', out: 'end', from: 9000 }).value).toContain('data-mf-from="9000"');
  });

  it('refuses unknown kinds, roles and tags at build time', () => {
    expect(() => line({ text: 'x', role: 'title', in: 'bounce@1', out: 'end' })).toThrow(/unknown kind "bounce"/);
    expect(() => line({ text: 'x', role: 'title', in: 'rise', out: 'end' })).toThrow(/needs a time/);
    expect(() => line({ text: 'x', role: 'title', in: 'rise@1', out: 'melt@2' })).toThrow(/data-mf-out/);
    expect(() => line({ text: 'x', role: 'giant' as 'title', in: 'rise@1', out: 'end' })).toThrow(/role/);
    expect(() => line({ text: 'x', role: 'title', in: 'rise@1', out: 'end', tag: 'script' as 'div' })).toThrow(/tag "script"/);
  });
});

describe('typeRamp', () => {
  it('keeps titles and heroes inside the type.* shares and nothing under the readable minimum', () => {
    for (const aspect of ['16:9', '9:16', '1:1'] as const) {
      const ramp = typeRamp(aspect);
      const share = (px: number) => px / ramp.height;
      const title = NUMBERS['type.titleHeightShare'];
      const hero = NUMBERS['type.heroHeightShare'];
      expect(share(ramp.sizes.title), `${aspect} title`).toBeGreaterThanOrEqual(title.min);
      expect(share(ramp.sizes.title), `${aspect} title`).toBeLessThanOrEqual(title.max);
      expect(share(ramp.sizes.hero), `${aspect} hero`).toBeGreaterThanOrEqual(hero.min);
      expect(share(ramp.sizes.hero), `${aspect} hero`).toBeLessThanOrEqual(hero.max);
      for (const role of TYPE_ROLES) expect(ramp.sizes[role]).toBeGreaterThanOrEqual(ramp.minPx);
    }
    expect(typeRamp('16:9').minPx).toBe(28.08);
    expect(typeRamp('9:16').sizes.title).toBeCloseTo(typeRamp('16:9').sizes.title * NUMBERS['type.verticalTitleScale'], 2);
    expect(typeRamp('16:9', { width: 960 }).sizes.title).toBe(35);
    expect(typeCss(typeRamp('16:9'))).toContain('.mf-role-title { font-family: var(--mf-font-heading); font-size: 70px;');
  });
});

describe('text-line rules', () => {
  it('parses cues', () => {
    expect(parseEntrance('words@bar2+0.5b')).toEqual({ kind: 'words', at: 'bar2+0.5b' });
    expect(parseExit('end')).toEqual({ kind: 'end', at: '' });
    expect(parseExit('fall@ bar4-0.25s ')).toEqual({ kind: 'fall', at: 'bar4-0.25s' });
  });

  it('splits by letter only for Latin, Cyrillic and Greek left-to-right text', () => {
    expect(splitFor('letters', 'Evals')).toBe('char');
    expect(splitFor('letters', 'Каждый шаг')).toBe('char');
    expect(splitFor('letters', 'Ευχαριστώ')).toBe('char');
    expect(splitFor('letters', 'قصص هادئة')).toBe('word');
    expect(splitFor('scatter', 'धीमी कहानियाँ')).toBe('word');
    expect(splitFor('type', '每一步都看得见')).toBe('word');
    expect(splitFor('letters', 'Evals', true)).toBe('word');
    expect(splitFor('rise', 'Evals')).toBe('line');
    expect(splitFor('zoom', 'Ship it')).toBe('word');
    expect(hasComplexScript('ไทย')).toBe(true);
    expect(hasComplexScript('Hello')).toBe(false);
  });

  it('entrance landings match lint for Latin text and exits keep their defaults', () => {
    for (const kind of ENTRANCE_KINDS) {
      for (const text of ['Go', 'See every step your agents take']) {
        expect(entranceDuration(kind, text, 30), `${kind} "${text}"`).toBeCloseTo(entranceSeconds(kind, text, 30), 9);
      }
    }
    // Complex scripts fall back to word timing for letter kinds.
    expect(entranceDuration('letters', 'قصص هادئة لزمن سريع', 30)).toBeCloseTo(0.16 + 0.07 * 3, 9);
    expect(EXIT_KINDS.map(exitDuration)).toEqual([0.25, 0.25, 0.25, 0.3, 0.2, 0.3, 0, 0]);
    expect(EXIT.zoom.scaleTo).toBe(1.6);
  });

  it('formats count values like the target', () => {
    const format = parseCount('$12,480+');
    expect(format).toEqual({ prefix: '$', suffix: '+', value: 12480, decimals: 0, grouping: true });
    expect(formatCount(format as NonNullable<typeof format>, 1234.6)).toBe('$1,235+');
    const pct = parseCount('92.5%');
    expect(formatCount(pct as NonNullable<typeof pct>, 7)).toBe('7.0%');
    expect(parseCount('no digits')).toBeNull();
  });
});

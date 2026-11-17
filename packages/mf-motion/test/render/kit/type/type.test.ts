// Text lines in the pinned Chrome: entrance landings and exit lengths at frame
// precision, script fixtures (Arabic, Devanagari, CJK with the fetched font,
// Cyrillic) without letter splitting where shaping matters, fitText, and
// hostile text rendered as text.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { line } from '../../../../src/kit/build/type';
import { ENTRANCE_KINDS, EXIT, EXIT_KINDS, type EntranceKind } from '../../../../src/kit/runtime/spec';
import type { Engine } from '../../../../src/engine/index';
import { fetchFonts, fetchManifest } from '../../../../src/fonts/index';
import { type DriverPage, evaluate, screenshot, seek, withPage } from '../../../../src/media/chrome';
import { changedFraction, frameAt } from '../../../../src/media/pixels';
import { entranceSeconds } from '../../../../src/lint/numbers';
import { testBrowser, testCacheRoot } from '../../../helpers/engine';
import { buildRuntime, compositionDir, writePage } from './page';

const FPS = 30;
const FRAME = 1 / FPS;
let engine: Engine;
let browserPath: string;
let dir = '';
let fonts: Record<string, { family: string; file: string }> = {};

interface Scheduled {
  id: string;
  entrance: string;
  exit: string;
  split: string;
  inSec: number;
  landSec: number;
  outSec: number | null;
  goneSec: number | null;
}

const TEXT: Record<EntranceKind, string> = {
  rise: 'Traces for every run',
  words: 'See every step your agents take',
  letters: 'Evals',
  ink: 'Cost per run, in one place',
  type: 'tessarine trace --last',
  slot: 'Saturday',
  count: '12,480',
  mask: 'Prompt diffs, side by side',
  zoom: 'Ship it',
  scatter: 'Calm',
  stroke: 'Signal',
};

async function open<T>(entry: string, size: { width: number; height: number }, fn: (page: DriverPage) => Promise<T>): Promise<T> {
  return withPage({ dir, entry, width: size.width, height: size.height, engine, browserPath }, async (page, session) => {
    const result = await fn(page);
    expect(session.errors).toEqual([]);
    return result;
  });
}

const schedule = (page: DriverPage) => evaluate(page, () => (window as unknown as { __schedule: Scheduled[] }).__schedule, null);
const state = (page: DriverPage, id: string) =>
  evaluate(page, (target: string) => {
    const w = window as unknown as { mf: { settled: (el: Element) => boolean; gone: (el: Element) => boolean } };
    const el = document.getElementById(target) as HTMLElement;
    return { settled: w.mf.settled(el), gone: w.mf.gone(el) };
  }, id);

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
  // CJK: Noto Sans SC from the pinned fetch manifest, into the private test cache.
  const sc = fetchManifest().filter((entry) => entry.id === 'noto-sans-sc');
  const fetched = await fetchFonts(['cjk'], { cacheDir: testCacheRoot(), manifest: sc });
  const scFile = fetched.find((font) => font.id === 'noto-sans-sc')?.path ?? fetched[0]?.path;
  if (!scFile) throw new Error('Noto Sans SC was not fetched');
  ({ dir, fonts } = compositionDir(engine, { cjk: { family: 'Noto Sans SC', file: scFile } }));
}, 900_000);

describe('entrances', () => {
  it('each entrance lands at its declared time within 1 frame', async () => {
    const body = ENTRANCE_KINDS.map((kind, i) =>
      line({ id: `in-${kind}`, text: TEXT[kind], role: 'title', in: `${kind}@${0.5 + i * 0.1}`, out: 'end', ...(kind === 'slot' ? { options: ['Monday', 'Tuesday', 'Friday'] } : {}) }).value.replace(
        '<div ',
        `<div style="position:absolute;left:120px;top:${40 + i * 92}px;font-size:56px" `,
      ),
    ).join('\n');
    const entry = writePage(dir, 'entrances.html', { durationSec: 6, body, fonts });
    await open(entry, { width: 1920, height: 1080 }, async (page) => {
      const lines = await schedule(page);
      expect(lines.map((item) => item.entrance)).toEqual([...ENTRANCE_KINDS]);
      for (const item of lines) {
        const kind = item.entrance as EntranceKind;
        // Same landing as lint's table for Latin text.
        expect(item.landSec - item.inSec, kind).toBeCloseTo(entranceSeconds(kind, TEXT[kind], FPS, { options: 3 }), 6);
        await seek(page, item.inSec - FRAME);
        expect((await state(page, item.id)).gone, `${kind} hidden before its entrance`).toBe(true);
        if (kind === 'rise' || kind === 'words' || kind === 'letters') {
          // At the entrance start, clipped parts sit wholly below the clip: nothing peeks in.
          await seek(page, item.inSec);
          const peeking = await evaluate(page, (id: string) => {
            const el = document.getElementById(id) as HTMLElement;
            const clip = (el.querySelector('.mf-clip') as HTMLElement).getBoundingClientRect();
            return [...el.querySelectorAll<HTMLElement>('.mf-body, .mf-word, .mf-char')].filter((part) => part.getBoundingClientRect().top < clip.bottom - 0.5 && part.getBoundingClientRect().height > 0 && getComputedStyle(part).transform !== 'none').length;
          }, item.id);
          expect(peeking, `${kind} parts inside the clip at the start`).toBe(0);
        }
        await seek(page, item.landSec - FRAME);
        expect((await state(page, item.id)).settled, `${kind} not yet landed one frame early`).toBe(false);
        await seek(page, item.landSec + FRAME);
        expect((await state(page, item.id)).settled, `${kind} landed within a frame`).toBe(true);
      }
      // Count stamps the target number; slot rests on the final word.
      expect(await evaluate(page, () => document.getElementById('in-count')?.textContent, null)).toBe('12,480');
    });
  }, 300_000);
});

describe('exits', () => {
  it('each exit lasts its default', async () => {
    const body = EXIT_KINDS.map((kind, i) =>
      line({ id: `out-${kind}`, text: `Exit ${kind}`, role: 'title', in: 'rise@0', out: kind === 'end' ? 'end' : `${kind}@${1.5 + i * 0.1}` }).value.replace(
        '<div ',
        `<div style="position:absolute;left:120px;top:${60 + i * 120}px;font-size:64px" `,
      ),
    ).join('\n');
    const entry = writePage(dir, 'exits.html', { durationSec: 4, body, fonts });
    await open(entry, { width: 1920, height: 1080 }, async (page) => {
      for (const item of await schedule(page)) {
        const kind = item.exit as (typeof EXIT_KINDS)[number];
        if (kind === 'end') {
          expect(item.outSec).toBeNull();
          await seek(page, 3.9);
          expect((await state(page, item.id)).settled, 'end holds to the composition end').toBe(true);
          continue;
        }
        expect((item.goneSec ?? 0) - (item.outSec ?? 0), kind).toBeCloseTo(EXIT[kind].sec, 6);
        await seek(page, (item.outSec ?? 0) - FRAME);
        expect((await state(page, item.id)).settled, `${kind} still resting before its exit`).toBe(true);
        if (EXIT[kind].sec > 0) {
          await seek(page, (item.goneSec ?? 0) - FRAME);
          expect((await state(page, item.id)).gone, `${kind} still visible one frame before its end`).toBe(false);
        }
        await seek(page, (item.goneSec ?? 0) + FRAME);
        expect((await state(page, item.id)).gone, `${kind} gone after ${EXIT[kind].sec} s`).toBe(true);
      }
    });
  }, 300_000);
});

describe('scripts', () => {
  const SCRIPTS = {
    arabic: { text: 'قصص هادئة لزمن سريع', font: 'Noto Sans Arabic', split: 'word', lang: 'ar' },
    devanagari: { text: 'धीमी कहानियाँ तेज़ समय के लिए', font: 'Noto Sans Devanagari', split: 'word', lang: 'hi' },
    cjk: { text: '每一步都看得见', font: 'Noto Sans SC', split: 'word', lang: 'zh' },
    cyrillic: { text: 'Каждый шаг виден', font: 'Inter', split: 'char', lang: 'ru' },
  } as const;

  for (const [name, script] of Object.entries(SCRIPTS)) {
    it(`${name}: letters splits by ${script.split}, and the landed line looks like the unsplit text`, async () => {
      const style = `position:absolute;left:120px;top:400px;font-size:96px;font-family:"${script.font}"`;
      const animated = line({ id: 'subject', text: script.text, role: 'title', in: 'letters@0.2', out: 'end', lang: script.lang }).value.replace('<div ', `<div style='${style}' `);
      const still = line({ id: 'subject', text: script.text, role: 'title', in: 'letters@0.2', out: 'end', lang: script.lang })
        .value.replace('class="mf-line mf-role-title"', 'class="mf-role-title"')
        .replace('<div ', `<div style='${style}' `);
      const shots: Buffer[] = [];
      for (const [entry, body, lines] of [
        [`${name}-line.html`, animated, true],
        [`${name}-still.html`, still, false],
      ] as const) {
        writePage(dir, entry, { durationSec: 3, body, fonts, lines });
        shots.push(
          await open(entry, { width: 1920, height: 1080 }, async (page) => {
            if (lines) {
              const [item] = await schedule(page);
              expect(item?.split).toBe(script.split);
              const counts = await evaluate(page, () => ({ chars: document.querySelectorAll('#subject .mf-char').length, words: document.querySelectorAll('#subject .mf-word').length }), null);
              if (script.split === 'word') expect(counts.chars).toBe(0);
              expect(counts.words).toBeGreaterThan(0);
            }
            expect(await evaluate(page, (family: string) => document.fonts.check(`96px "${family}"`, 'x'), script.font)).toBe(true);
            await seek(page, 2.5);
            return screenshot(page);
          }),
        );
      }
      const out = mkdtempSync(path.join(tmpdir(), `mfm-script-${name}-`));
      writeFileSync(path.join(out, 'line.png'), shots[0] as Buffer);
      writeFileSync(path.join(out, 'still.png'), shots[1] as Buffer);
      const [a, b] = await Promise.all([frameAt(path.join(out, 'line.png'), 0, { format: 'rgba' }), frameAt(path.join(out, 'still.png'), 0, { format: 'rgba' })]);
      // Word splits keep shaping: the landed line matches the unsplit text (letter splits may only lose kerning).
      expect(changedFraction(a, b), name).toBeLessThan(script.split === 'word' ? 0.001 : 0.01);
    }, 300_000);
  }

  it('splitting Arabic by letter would break its shaping (the check is sensitive)', async () => {
    const text = 'قصص هادئة لزمن سريع';
    const style = 'position:absolute;left:120px;top:400px;font-size:96px;font-family:"Noto Sans Arabic"';
    const broken = `<div dir="rtl" style='${style}'>${[...text].map((char) => (char === ' ' ? ' ' : `<span style="display:inline-block">${char}</span>`)).join('')}</div>`;
    const whole = `<div dir="rtl" style='${style}'>${text}</div>`;
    const shots: string[] = [];
    for (const [entry, body] of [
      ['arabic-broken.html', broken],
      ['arabic-whole.html', whole],
    ] as const) {
      writePage(dir, entry, { durationSec: 1, body, fonts, lines: false });
      const png = await open(entry, { width: 1920, height: 1080 }, async (page) => {
        await seek(page, 0.5);
        return screenshot(page);
      });
      const file = path.join(mkdtempSync(path.join(tmpdir(), 'mfm-arabic-')), 'shot.png');
      writeFileSync(file, png);
      shots.push(file);
    }
    const [a, b] = await Promise.all(shots.map((file) => frameAt(file, 0, { format: 'rgba' })));
    expect(changedFraction(a as Awaited<ReturnType<typeof frameAt>>, b as Awaited<ReturnType<typeof frameAt>>)).toBeGreaterThan(0.002);
  }, 300_000);
});

describe('fitText', () => {
  it('fits a maxChars string of W characters, or fails naming the variable', async () => {
    const body = [
      `<div id="fits" data-mf-var="headline" style="position:absolute;left:100px;top:100px;width:900px;font-size:120px;font-family:Inter;font-weight:800">${'W'.repeat(24)}</div>`,
      `<div id="too-long" data-mf-var="subline" style="position:absolute;left:100px;top:500px;width:900px;font-size:60px;font-family:Inter">${'W'.repeat(80)}</div>`,
    ].join('\n');
    const entry = writePage(dir, 'fit.html', { durationSec: 1, body, fonts, lines: false });
    await open(entry, { width: 1920, height: 1080 }, async (page) => {
      const result = await evaluate(page, async () => {
        await document.fonts.ready;
        const w = window as unknown as { mf: { fitText: (el: Element, max: number) => { sizePx: number; widthPx: number; steps: number } } };
        const fit = w.mf.fitText(document.getElementById('fits') as Element, 900);
        let error = '';
        try {
          w.mf.fitText(document.getElementById('too-long') as Element, 900);
        } catch (caught) {
          error = (caught as Error).message;
        }
        return { fit, error, recorded: (window as unknown as { __mfErrors?: unknown[] }).__mfErrors ?? [] };
      }, null);
      expect(result.fit.sizePx).toBeLessThan(120);
      expect(result.fit.sizePx).toBeGreaterThanOrEqual(28.08);
      expect(result.fit.widthPx).toBeLessThanOrEqual(900);
      expect(result.fit.steps).toBeGreaterThan(0);
      expect(result.error).toMatch(/^variable "subline" is too long: 80 characters/);
      expect(result.recorded).toEqual([expect.objectContaining({ code: 'VARIABLE_TOO_LONG', variable: 'subline' })]);
    });
  }, 300_000);
});

describe('hostile text', () => {
  it('renders </script> and <img onerror> as text', async () => {
    const hostile = '</script><img src=x onerror="window.__pwned=1"><b>bold?</b>';
    const markup = line({ id: 'hostile', text: hostile, role: 'body', in: 'rise@0', out: 'end', variable: 'quote" onmouseover="x' }).value;
    expect(markup).not.toContain('<img');
    const entry = writePage(dir, 'hostile.html', { durationSec: 2, body: markup, fonts });
    await open(entry, { width: 1280, height: 720 }, async (page) => {
      await seek(page, 1.5);
      const found = await evaluate(page, () => ({
        pwned: (window as unknown as { __pwned?: number }).__pwned ?? null,
        images: document.querySelectorAll('img, b').length,
        text: document.getElementById('hostile')?.textContent ?? '',
        variable: document.getElementById('hostile')?.getAttribute('data-mf-var'),
      }), null);
      expect(found).toEqual({ pwned: null, images: 0, text: hostile, variable: 'quote" onmouseover="x' });
    });
  }, 300_000);
});

// One story per entrance and exit kind: a composition with a single line,
// sampled across its motion and laid out as a strip sheet for review. Each
// story must move (its frames differ) and run without page errors.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { line } from '../../../../src/kit/build/type';
import { ENTRANCE_KINDS, EXIT, EXIT_KINDS, type EntranceKind, type ExitKind, entranceDuration } from '../../../../src/kit/runtime/spec';
import type { Engine } from '../../../../src/engine/index';
import { screenshot, seek, withPage } from '../../../../src/media/chrome';
import { changedFraction, frameAt } from '../../../../src/media/pixels';
import { renderSheet } from '../../../../src/media/sheet';
import { testBrowser } from '../../../helpers/engine';
import { buildRuntime, compositionDir, writePage } from '../type/page';

const STORY_TEXT: Record<EntranceKind, string> = {
  rise: 'Traces for every run',
  words: 'See every step your agents take',
  letters: 'Evaluate',
  ink: 'Cost per run, in one place',
  type: 'tessarine trace --last',
  slot: 'Saturday',
  count: '12,480',
  mask: 'Prompt diffs, side by side',
  zoom: 'Ship it',
  scatter: 'Calm',
  stroke: 'Signal',
};

let engine: Engine;
let browserPath: string;
let dir = '';
let fonts: Record<string, { family: string; file: string }> = {};
let sheets = '';

beforeAll(async () => {
  buildRuntime();
  ({ engine, browserPath } = await testBrowser());
  ({ dir, fonts } = compositionDir(engine));
  sheets = mkdtempSync(path.join(tmpdir(), 'mfm-stories-'));
}, 900_000);

async function story(name: string, body: string, times: number[], durationSec: number): Promise<string[]> {
  const entry = writePage(dir, `${name}.html`, { durationSec, body, fonts, width: 1280, height: 720, css: '.story { position: absolute; left: 96px; top: 300px; font-size: 72px; font-family: Inter; font-weight: 800; }' });
  const frames = path.join(sheets, name);
  mkdirSync(frames, { recursive: true });
  return withPage({ dir, entry, width: 1280, height: 720, engine, browserPath }, async (page, session) => {
    const files: string[] = [];
    for (const [i, time] of times.entries()) {
      await seek(page, time);
      const file = path.join(frames, `${String(i).padStart(2, '0')}.png`);
      writeFileSync(file, await screenshot(page));
      files.push(file);
    }
    expect(session.errors).toEqual([]);
    return files;
  });
}

async function moved(files: string[]): Promise<number> {
  const first = await frameAt(files[0] as string, 0, { format: 'rgba' });
  const last = await frameAt(files[files.length - 1] as string, 0, { format: 'rgba' });
  return changedFraction(first, last);
}

describe('stories', () => {
  it('one story per entrance kind', async () => {
    for (const kind of ENTRANCE_KINDS) {
      const text = STORY_TEXT[kind];
      const land = 0.3 + entranceDuration(kind, text, 30, { options: 3 });
      const body = line({ text, role: 'title', in: `${kind}@0.3`, out: 'end', className: 'story', ...(kind === 'slot' ? { options: ['Monday', 'Tuesday', 'Friday'] } : {}) }).value;
      const times = Array.from({ length: 8 }, (_, i) => Math.round((0.2 + ((land + 0.2 - 0.2) * i) / 7) * 30) / 30);
      const files = await story(`in-${kind}`, body, times, land + 1);
      expect(await moved(files), kind).toBeGreaterThan(0.002);
      const sheet = await renderSheet('strip', files.map((file, i) => ({ image: file, label: `${times[i]?.toFixed(2)} s` })), path.join(sheets, `in-${kind}.png`), { title: `entrance ${kind}`, engine, browserPath });
      expect(sheet.files.length).toBe(1);
    }
  }, 900_000);

  it('one story per exit kind', async () => {
    for (const kind of EXIT_KINDS) {
      const out = kind === 'end' ? 'end' : `${kind}@1.0`;
      const body = line({ text: `Exit: ${kind}`, role: 'title', in: 'rise@0', out, className: 'story' }).value;
      const end = 1.0 + EXIT[kind as ExitKind].sec;
      const times = Array.from({ length: 8 }, (_, i) => Math.round((0.9 + ((end + 0.2 - 0.9) * i) / 7) * 30) / 30);
      const files = await story(`out-${kind}`, body, times, end + 0.5);
      expect(await moved(files), kind).toBeGreaterThan(kind === 'end' ? -1 : 0.002);
      if (kind === 'end') expect(await moved(files)).toBe(0);
      await renderSheet('strip', files.map((file, i) => ({ image: file, label: `${times[i]?.toFixed(2)} s` })), path.join(sheets, `out-${kind}.png`), { title: `exit ${kind}`, engine, browserPath });
    }
    // Sheets are kept in the OS temp folder for review.
    console.log(`stories: ${sheets}`);
  }, 900_000);
});

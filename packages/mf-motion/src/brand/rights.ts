// The one-time rights notices. Each prints once per data home and is recorded
// in <home>/receipts/rights.json (and as a rights.notice event when a project is open).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, homeLayout } from '../paths/index';

export const BRAND_NOTICE =
  'Use brands, logos, screenshots and fonts you have the right to use. Web fonts are often licensed for websites only, not for video; run `mf-motion brand fonts <id> --substitute-ofl` to switch to free OFL fonts. mf-motion keeps everything on this computer.';

export const REFERENCE_NOTICE =
  'You are responsible for having the right to download and study this video. mf-motion reads its pacing, palette and motion as numbers and never puts its frames, logos, characters, footage or audio into your output.';

export type NoticeKind = 'brand' | 'reference';

interface Receipt {
  schemaVersion: 1;
  kind: 'rights';
  brand: { shownAt: string } | null;
  reference: { shownAt: string } | null;
}

export function rightsFile(home: string): string {
  return path.join(homeLayout(home).receipts, 'rights.json');
}

export function readRights(home: string): Receipt {
  const file = rightsFile(home);
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<Receipt>;
      return { schemaVersion: 1, kind: 'rights', brand: value.brand ?? null, reference: value.reference ?? null };
    } catch {
      // A damaged receipt is rewritten.
    }
  }
  return { schemaVersion: 1, kind: 'rights', brand: null, reference: null };
}

export interface NoticeResult {
  /** The text to show the user now, or null when it was shown before. */
  text: string | null;
  shownAt: string;
}

/**
 * Show the notice if this data home has not seen it: returns its text and
 * records the time; afterwards returns null with the recorded time.
 */
export function rightsNotice(home: string, kind: NoticeKind, options: { project?: string | null; now?: Date } = {}): NoticeResult {
  const receipt = readRights(home);
  const previous = receipt[kind];
  if (previous) return { text: null, shownAt: previous.shownAt };
  const shownAt = (options.now ?? new Date()).toISOString();
  receipt[kind] = { shownAt };
  mkdirSync(path.dirname(rightsFile(home)), { recursive: true });
  writeFileSync(rightsFile(home), `${JSON.stringify(receipt, null, 2)}\n`);
  if (options.project) appendEvent(options.project, { type: 'rights.notice', actor: 'cli', data: { notice: kind } });
  return { text: kind === 'brand' ? BRAND_NOTICE : REFERENCE_NOTICE, shownAt };
}

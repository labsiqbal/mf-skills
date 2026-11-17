// Plan hashes tie an approval to the exact plan the user was shown: the CLI
// appends plan.shown { subject, planHash } when it shows a plan, and
// `approve` refuses when the plan file's hash no longer matches.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type ProjectEvent, readEvents } from './events';

export const APPROVAL_SUBJECTS = ['beatgrid', 'placement', 'extra-round', 'theme', 'library-add'] as const;
export type ApprovalSubject = (typeof APPROVAL_SUBJECTS)[number];

/**
 * The project file whose content an approval of each subject covers, relative
 * to the project root; null when the subject has no single plan file, in which
 * case the hash recorded by plan.shown is taken as is.
 */
export const PLAN_FILES: Record<ApprovalSubject, string | null> = {
  beatgrid: 'plan/beatgrid.json',
  placement: 'plan/placement.json',
  theme: 'themes/board.json',
  'extra-round': null,
  'library-add': null,
};

/** sha256 hex of a plan file, with CRLF folded to LF so an editor's line endings do not matter. */
export function planHash(file: string): string {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

/** The most recent plan.shown event for a subject, or null. */
export function lastShown(projectRoot: string, subject: ApprovalSubject, events: ProjectEvent[] = readEvents(projectRoot)): ProjectEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'plan.shown' && event.data.subject === subject) return event;
  }
  return null;
}

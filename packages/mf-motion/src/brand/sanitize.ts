// Captured text is data. Before it reaches brand.md or brand.json it is
// reduced to plain text, truncated, and stripped of lines that address an
// assistant; those drops are counted and reported.

export const TEXT_LIMITS = { headline: 120, tagline: 160, button: 32, heading: 120, headings: 6, name: 80, line: 160 } as const;

/** Lines that talk to an assistant rather than describe the brand. */
const INSTRUCTION = /ignore (all )?previous|\byou are\b|system prompt|\bassistant\b|\binstructions?\b/i;

/** Plain text: no tags, no control characters, single spaces. */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) return value;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export function isInstruction(line: string): boolean {
  return INSTRUCTION.test(line);
}

export interface SanitizedText {
  kept: string[];
  dropped: number;
}

/** Sanitise captured lines: plain text, each line capped, instruction-like lines dropped. */
export function sanitizeLines(lines: string[], max: number = TEXT_LIMITS.line): SanitizedText {
  const kept: string[] = [];
  let dropped = 0;
  for (const raw of lines) {
    const text = plainText(raw);
    if (text === '') continue;
    if (isInstruction(text)) {
      dropped += 1;
      continue;
    }
    kept.push(truncate(text, max));
  }
  return { kept, dropped };
}

/** One sanitised field, or null when empty or instruction-like (counted). */
export function sanitizeField(value: unknown, max: number, counter: { dropped: number }): string | null {
  if (typeof value !== 'string') return null;
  const text = plainText(value);
  if (text === '') return null;
  if (isInstruction(text)) {
    counter.dropped += 1;
    return null;
  }
  return truncate(text, max);
}

/** Text inside a Markdown fence that cannot close the fence. */
export function fenceSafe(line: string): string {
  return line.replace(/`{3,}/g, (run) => run.split('').join(' ')).replace(/~{3,}/g, (run) => run.split('').join(' '));
}

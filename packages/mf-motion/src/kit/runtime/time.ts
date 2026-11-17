/// <reference lib="dom" />
// Time positions in the page: the resolved grid when the build set one,
// otherwise the composition's own frame rate and duration.
import { type TimeGrid, type TimeSpec, resolveSpec, setGrid as setGrammarGrid } from '../../time/grammar';

let grid: TimeGrid | null = null;

export function setGrid(next: TimeGrid | null): void {
  grid = next;
  setGrammarGrid(next);
}

/** The composition's fps and length as a grid without bars. */
function compositionGrid(): TimeGrid {
  const root = typeof document === 'undefined' ? null : (document.querySelector('[data-composition-id]') as HTMLElement | null);
  const duration = Number(root?.dataset.duration ?? '0');
  return { fps: root?.dataset.fps ?? '30', lengthSec: duration > 0 ? duration : 3600 };
}

/** Seconds for a time spec, snapped to the frame. */
export function t(spec: TimeSpec): number {
  return resolveSpec(spec, grid ?? compositionGrid()).sec;
}

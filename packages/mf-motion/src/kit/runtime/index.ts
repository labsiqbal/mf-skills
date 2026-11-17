/// <reference lib="dom" />
// The composition runtime, bundled to dist/vendor/mf-runtime.js (IIFE) and
// exposed as the global `mf`: time positions, text lines, fitting.
import type { TimeGrid } from '../../time/grammar';
import { setGrid, t } from './time';
import { FitError, fitText, textWidth } from './fit';
import { gone, line, lines, settled } from './lines';
import { ENTRANCE, ENTRANCE_KINDS, EXIT, EXIT_KINDS, entranceDuration, exitDuration, splitFor } from './spec';

/** Reads an inline resolved grid (<script type="application/json" id="mf-grid">) when the page has one. */
function loadInlineGrid(): void {
  const node = typeof document === 'undefined' ? null : document.getElementById('mf-grid');
  if (!node?.textContent) return;
  setGrid(JSON.parse(node.textContent) as TimeGrid);
}

/** Run fn once fonts have loaded (fitting and measuring need final metrics). */
function ready(fn: () => void): Promise<void> {
  return document.fonts.ready.then(() => fn());
}

const mf = {
  version: '1.0.0',
  t,
  setGrid,
  line,
  lines,
  fitText,
  textWidth,
  FitError,
  settled,
  gone,
  ready,
  entranceDuration,
  exitDuration,
  splitFor,
  kinds: { entrance: ENTRANCE_KINDS, exit: EXIT_KINDS },
  defaults: { entrance: ENTRANCE, exit: EXIT },
};

loadInlineGrid();
(globalThis as unknown as { mf: typeof mf }).mf = mf;

export type MfRuntime = typeof mf;

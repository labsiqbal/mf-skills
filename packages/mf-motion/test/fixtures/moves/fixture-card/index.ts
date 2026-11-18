// The contract fixture move (MFM-041): kit tokens only, sizes in u, every text
// an mf-line with an entrance and an exit, the card in and out by the timeline.
// It sits clear of the face band: bottom left in 16:9, at the top in 9:16.
// The card shows ink by 0.3 s (overlay.firstInkSec), the count holds at least
// read.lastLineMinSec, and the card is gone before the last frame.
import type { MoveModule, ResolvedVars } from '../../../../src/library/contract';
import { html } from '../../../../src/kit/build/html';
import type { Composition, MoveCtx } from '../../../../src/kit/build/move';
import { line } from '../../../../src/kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const tone = v.tone === 'ink' ? 'var(--mf-ink)' : 'var(--mf-accent)';
  const end = ctx.durationSec;
  return {
    id: meta.id,
    html: html`<div class="fc-card" id="fc-card">${line({ text: String(v.value), role: 'hero', in: 'count@0.25', out: `up@${(end - 0.75).toFixed(2)}`, from: 0, className: 'fc-value' })}${line({ text: String(v.title), role: 'title', in: 'rise@0.4', out: `up@${(end - 0.75).toFixed(2)}`, className: 'fc-title', variable: 'title' })}</div>`,
    css: `
.fc-card { position: absolute; left: 0; bottom: 0; box-sizing: border-box; width: ${u(820)}; max-width: 100%; padding: ${u(20)} ${u(24)}; background: var(--mf-surface); border-radius: var(--mf-radius); box-shadow: var(--mf-shadow-box); }
.is-landscape .fc-card { width: ${u(440)}; }
.is-portrait .fc-card { top: 0; bottom: auto; }
.fc-value { font-family: var(--mf-font-display); font-size: ${u(64)}; line-height: 1.2; font-weight: 700; color: ${tone}; }
.fc-title { font-family: var(--mf-font-heading); font-size: ${u(30)}; line-height: 1.25; font-weight: 600; color: var(--mf-ink); white-space: nowrap; }
`,
    script: `tl.from('#fc-card', { opacity: 0, y: 30 * ctx.u, duration: 0.4, ease: 'power2.out' }, 0.1);\n  tl.to('#fc-card', { opacity: 0, duration: 0.35, ease: 'power2.in' }, ctx.durationSec - 0.45);`,
    assets: [],
    needsThree: false,
    holds: meta.holds.map((hold) => ({ from: hold.from * end, to: hold.to * end })),
  };
}

export default { meta, vars, build } satisfies MoveModule;

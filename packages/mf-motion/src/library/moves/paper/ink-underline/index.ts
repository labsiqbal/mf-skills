import type { MoveModule, ResolvedVars } from '../../../contract';
import { html } from '../../../../kit/build/html';
import { paper } from '../../../../kit/build/materials';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const duration = ctx.durationSec;
  const stock = paper(ctx, { id: 'iu-fibres' });
  const word = line({
    text: String(v.keyword),
    role: 'body',
    in: 'rise@0.12',
    out: `up@${(duration - 0.42).toFixed(2)}`,
    accent: true,
    variable: 'keyword',
    id: 'iu-word',
  });

  return {
    id: meta.id,
    html: html`<div id="iu-slip">${stock.html}<div class="iu-copy">
      ${word}
      <svg class="iu-mark" viewBox="0 0 240 84" preserveAspectRatio="none" aria-hidden="true">
        <path id="iu-underline" pathLength="100" d="M 21 67 Q 113 72 219 66"/>
        <path id="iu-circle" pathLength="100" d="M 192 73 C 131 83 24 76 10 55 C -4 33 20 10 63 8 C 116 2 198 5 222 22 C 252 44 229 68 202 72"/>
      </svg>
    </div></div>`,
    css: `
${stock.css}
#iu-slip { position: absolute; box-sizing: border-box; display: flex; justify-content: center; width: min(${u(420)}, 100%); padding: ${u(14)} ${u(18)}; background: var(--mf-ground); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); overflow: hidden; clip-path: inset(0 100% 0 0); }
.iu-copy { position: relative; display: grid; justify-items: center; padding: ${u(9)} ${u(22)} ${u(13)}; }
#iu-word { font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(32)}; line-height: 1.1; white-space: nowrap; color: var(--mf-ink); }
.iu-mark { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.iu-mark path { fill: none; stroke: var(--mf-accent); stroke-width: ${u(4)}; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; stroke-dasharray: 100; stroke-dashoffset: 101; }
.is-landscape #iu-slip { left: 0; bottom: ${u(154)}; max-width: ${u(440)}; padding-inline: ${u(6)}; }
.is-portrait #iu-slip { left: 0; top: ${u(78)}; }
.is-square #iu-slip { left: 0; top: ${u(2)}; width: min(${u(500)}, 100%); padding: ${u(2)} ${u(10)}; }
.is-square .iu-copy { padding: ${u(5)} ${u(18)} ${u(8)}; }
.is-square #iu-word { font-size: ${u(30)}; }
.is-square #iu-word > .mf-clip { padding-block: 0; margin-block: 0; }
.is-square .iu-mark path { stroke-width: ${u(3)}; }
`,
    script: `
${stock.script}
tl.fromTo('#iu-slip', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.55, ease: 'power4.out' }, 0.04);
tl.to('#iu-underline', { strokeDashoffset: 0, duration: 0.48, ease: 'power2.inOut' }, 0.63);
tl.to('#iu-circle', { strokeDashoffset: 0, duration: 0.65, ease: 'power2.inOut' }, 1.06);
tl.to('#iu-slip', { clipPath: 'inset(0 0 0 100%)', duration: 0.25, ease: 'power3.in' }, ${duration - 0.34});
`,
    assets: [],
    needsThree: false,
    holds: meta.holds.map(({ from, to }) => ({ from: from * duration, to: to * duration })),
  };
}

export default { meta, vars, build } satisfies MoveModule;

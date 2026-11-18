import type { MoveModule, ResolvedVars } from '../../../contract';
import { html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { card, onAccent } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const STEPS = [
  { name: 'first', at: 0.14 },
  { name: 'second', at: 0.78 },
  { name: 'third', at: 1.42 },
] as const;
const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const nodes = STEPS.map(({ name, at }) => {
    const piece = card(ctx, { id: `tf-${name}`, title: '', body: '', at });
    const label = line({
      text: String(v[name]),
      role: 'body',
      in: `rise@${(at + 0.1).toFixed(2)}`,
      out: 'end',
      id: `tf-${name}-label`,
      className: 'tf-label',
      variable: name,
    });
    return {
      ...piece,
      html: trusted(piece.html.value.replace(
        '<span class="mf-s-title" data-mf-static></span><span class="mf-s-body" data-mf-static></span>',
        label.value,
      )),
    };
  });
  const arrow = (id: string) => html`<svg class="tf-arrow" id="${id}" viewBox="0 0 64 64" aria-hidden="true">
    <path class="tf-shaft" d="M 5 32 H 56" pathLength="100"/>
    <path class="tf-head" d="M 45 20 L 57 32 L 45 44" pathLength="100"/>
  </svg>`;
  const stage = html`<div class="tf-stage"><div class="tf-band" aria-hidden="true"></div>
    <div id="tf-track">${nodes[0]?.html}${arrow('tf-link-1')}${nodes[1]?.html}${arrow('tf-link-2')}${nodes[2]?.html}</div>
  </div>`;
  const cam = camera(ctx, stage, { id: 'tf-camera', moves: [{ kind: 'drift', from: 0, to: ctx.durationSec }] });

  return {
    id: meta.id,
    html: cam.html,
    css: `
${nodes.map((piece) => piece.css).join('\n')}
.tf-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.tf-band { position: absolute; left: 0; right: 0; height: ${u(118)}; background: var(--mf-accent); }
#tf-track { position: relative; display: grid; align-items: center; grid-template-columns: minmax(0, 1fr) ${u(74)} minmax(0, 1fr) ${u(74)} minmax(0, 1fr); width: min(${u(1260)}, calc(100% - ${u(52)})); }
#tf-track .mf-s-card { box-sizing: border-box; position: relative; inset: auto; width: auto; min-width: 0; min-height: ${u(186)}; padding: ${u(28)} ${u(24)}; display: grid; place-items: center; text-align: center; box-shadow: none; }
#tf-track #tf-second { background: var(--mf-ground); border-color: var(--mf-accent); }
#tf-second::after { position: absolute; inset: ${u(5)}; content: ''; border: ${u(2)} solid var(--mf-accent); border-radius: calc(var(--mf-radius) - ${u(4)}); opacity: var(--tf-highlight, 0); pointer-events: none; }
.tf-label { min-width: 0; max-width: 100%; overflow-wrap: anywhere; font-family: var(--mf-font-heading); font-size: ${u(38)}; font-weight: 700; line-height: 1.15; color: var(--mf-ink); }
.tf-arrow { width: 100%; aspect-ratio: 1; overflow: visible; }
.tf-arrow path { fill: none; stroke: ${onAccent(ctx)}; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 100; stroke-dashoffset: 101; }
.is-square #tf-track { grid-template-columns: minmax(0, 1fr) ${u(48)} minmax(0, 1fr) ${u(48)} minmax(0, 1fr); }
.is-square .tf-label { font-size: ${u(32)}; }
.is-portrait .tf-band { inset: 0 auto; width: ${u(100)}; height: auto; }
.is-portrait #tf-track { width: min(${u(560)}, calc(100% - ${u(52)})); grid-template-columns: minmax(0, 1fr); justify-items: center; }
.is-portrait #tf-track .mf-s-card { width: 100%; min-height: ${u(140)}; }
.is-portrait .tf-arrow { width: ${u(66)}; transform: rotate(90deg); }
${cam.css}
`,
    script: `
${nodes.map((piece) => piece.script).join('\n')}
for (const [index, selector] of ['#tf-link-1', '#tf-link-2'].entries()) {
  const start = 0.55 + index * 0.64;
  tl.to(selector + ' .tf-shaft', { strokeDashoffset: 0, duration: 0.38, ease: 'power2.inOut' }, start);
  tl.to(selector + ' .tf-head', { strokeDashoffset: 0, duration: 0.22, ease: 'power2.out' }, start + 0.29);
}
tl.to('#tf-second', { '--tf-highlight': 1, duration: 0.45, ease: 'power4.out' }, 1.95);
${cam.script}
`,
    assets: [],
    needsThree: false,
    holds: [],
  };
}

export default { meta, vars, build } satisfies MoveModule;

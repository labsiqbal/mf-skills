import type { MoveModule, ResolvedVars } from '../../../contract';
import { formatValue, race, raceRanking } from '../../../../kit/build/charts';
import { html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { chip, onAccent } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const PITCH_U = 124;
const SORT = { at: 2.13, duration: 0.55 };
const STAMP_AT = 2.91;
const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const labels = [String(v.first), String(v.second), String(v.third)];
  const values = [Number(v.firstValue), Number(v.secondValue), Number(v.thirdValue)];
  const order = raceRanking(values);
  const ranks = values.map((_, i) => order.indexOf(i));
  const max = Math.max(...values);
  // Use the kit race structure and ranking. Own the timeline so each row draws
  // once, then sorts after its labels clear the crossing paths.
  const chart = race(ctx, { id: 'rb-chart', labels, steps: [values] });
  const title = line({ text: String(v.title), role: 'title', in: 'rise@0.08', out: 'end', variable: 'title', id: 'rb-title', className: 'rb-title' });
  const rowText = (text: string, kind: 'name' | 'value', i: number, variable?: string) => {
    const id = `rb-${kind}-${i}`;
    const classes = `rb-copy rb-${kind}`;
    const before = line({ text, role: 'body', in: `rise@${(0.06 + 0.04 * i).toFixed(2)}`, out: 'up@1.85', id, className: classes, ...(variable ? { variable } : {}) });
    const after = line({ text, role: 'body', in: 'rise@2.7', out: 'end', id: `${id}-sorted`, className: classes, ...(variable ? { variable } : {}) });
    return html`<div class="rb-copy-slot rb-${kind}-slot">${before}${after}</div>`.value;
  };
  let nameIndex = 0;
  let valueIndex = 0;
  const chartWithCues = chart.html.value
    .replace(/<span class="mf-c-label" data-mf-static>[^<]*<\/span>/g, () => {
      const i = nameIndex++;
      return rowText(labels[i] as string, 'name', i, ['first', 'second', 'third'][i]);
    })
    .replace(/<span class="mf-c-value" data-mf-static>[^<]*<\/span>/g, () => {
      const i = valueIndex++;
      return rowText(formatValue(values[i] as number), 'value', i);
    });
  const stamp = chip(ctx, { id: 'rb-stamp', label: '' });
  const stampCopy = line({ text: 'Leader', role: 'label', in: `rise@${STAMP_AT}`, out: 'end', id: 'rb-leader', className: 'rb-leader' });
  const stampWithCue = stamp.html.value.replace('<span class="mf-s-label" data-mf-static></span>', stampCopy.value);
  const stage = html`<div class="rb-stage"><div class="rb-panel">
    <div class="rb-head">${title}</div>
    <div class="rb-plot">${trusted(chartWithCues)}${trusted(stampWithCue)}</div>
  </div></div>`;
  const cam = camera(ctx, stage, { id: 'rb-camera', moves: [{ kind: 'drift', from: 0, to: ctx.durationSec }] });

  const css = `
${chart.css}
${stamp.css}
.rb-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.rb-panel { box-sizing: border-box; display: grid; grid-template-columns: ${u(330)} minmax(0, 1fr); width: min(${u(1350)}, calc(100% - ${u(72)})); background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); }
.rb-head { display: grid; align-items: center; padding: ${u(30)}; background: var(--mf-accent); border-radius: var(--mf-radius) 0 0 var(--mf-radius); }
.rb-title { font-family: var(--mf-font-heading); font-size: ${u(58)}; font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; color: ${onAccent(ctx)}; }
.rb-plot { position: relative; padding: ${u(26)} ${u(32)}; }
#rb-chart { position: relative; top: auto; left: auto; width: auto; height: ${u(PITCH_U * 3)}; }
#rb-chart .mf-c-row { height: ${u(PITCH_U)}; right: ${u(146)}; grid-template-columns: ${u(210)} minmax(0, 1fr); gap: ${u(20)}; }
#rb-chart .mf-c-lane { display: grid; grid-template-columns: minmax(0, 1fr) ${u(68)}; gap: ${u(16)}; }
#rb-chart .mf-c-bar { height: ${u(34)}; width: 100%; max-width: none; background: var(--mf-muted); transform-origin: left center; transform: scaleX(0); }
#rb-chart .mf-c-row[data-index="${order[0]}"] .mf-c-bar { background: var(--mf-accent); }
.rb-copy-slot { display: grid; align-items: center; min-width: 0; }
.rb-copy { grid-area: 1 / 1; font-family: var(--mf-font-body); font-size: ${u(32)}; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.rb-value { text-align: right; font-variant-numeric: tabular-nums; }
#rb-stamp { top: ${u(26)}; bottom: auto; right: ${u(32)}; left: auto; margin-top: ${u(29)}; background: var(--mf-ground); border: 1px solid var(--mf-accent); padding: ${u(14)} ${u(20)}; opacity: 0; }
#rb-stamp .mf-s-dot { display: none; }
.rb-leader { font-size: ${u(30)}; line-height: 1.1; font-weight: 700; color: var(--mf-ink); }
.is-square .rb-panel, .is-portrait .rb-panel { grid-template-columns: minmax(0, 1fr); }
.is-square .rb-head, .is-portrait .rb-head { border-radius: var(--mf-radius) var(--mf-radius) 0 0; }
.is-square .rb-title, .is-portrait .rb-title { font-size: ${u(52)}; }
.is-portrait #rb-chart .mf-c-row { grid-template-columns: ${u(224)} minmax(0, 1fr); }
${cam.css}
`;
  const script = `
    const finalSlots = ${JSON.stringify(ranks)};
    const widths = ${JSON.stringify(values.map((value) => value / max))};
    root.querySelectorAll('#rb-chart .mf-c-row').forEach((row, i) => {
      tl.set(row, { y: i * ${PITCH_U} * ctx.u }, 0);
      tl.to(row.querySelector('.mf-c-bar'), { scaleX: widths[i], duration: 0.7, ease: 'power4.out' }, 0.27 + i * 0.08);
      tl.to(row, { y: finalSlots[i] * ${PITCH_U} * ctx.u, duration: ${SORT.duration}, ease: 'power2.inOut' }, ${SORT.at});
    });
    tl.fromTo('#rb-stamp', { scale: 0.91, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.6)' }, ${STAMP_AT});
    ${cam.script}
  `;
  return { id: meta.id, html: cam.html, css, script, assets: [], needsThree: false, holds: [] };
}

export default { meta, vars, build } satisfies MoveModule;

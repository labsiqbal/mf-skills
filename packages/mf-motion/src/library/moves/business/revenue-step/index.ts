import type { MoveModule, ResolvedVars } from '../../../contract';
import { bars, formatValue } from '../../../../kit/build/charts';
import { html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { chip, onAccent } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const REVENUE_FORMAT = { prefix: '$', suffix: 'k' };
const TIME = { firstBar: 0.4, quarterGap: 0.5, growth: 0.65, valueDelay: 0.3, delta: 2.55 };
const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const revenue = [Number(v.q1), Number(v.q2), Number(v.q3), Number(v.q4)];
  const changes = Math.round(((Number(v.q4) - Number(v.q3)) / Number(v.q3)) * 100);
  const delta = formatValue(changes, { prefix: changes > 0 ? '+' : '', suffix: '% vs Q3' });
  const chart = bars(ctx, { id: 'rs-chart', series: revenue, labels: QUARTERS, format: REVENUE_FORMAT });
  const title = line({ text: String(v.title), role: 'title', in: 'rise@0.08', out: 'end', variable: 'title', id: 'rs-title', className: 'rs-title' });

  // Put kit line cues on the chart labels so the quarter and its value can arrive separately.
  let quarterIndex = 0;
  let valueIndex = 0;
  const chartWithCues = chart.html.value
    .replace(/<span class="mf-c-label" data-mf-static>[^<]*<\/span>/g, () => {
      const i = quarterIndex++;
      return line({ text: QUARTERS[i] as string, role: 'label', in: `rise@${(0.16 + i * 0.06).toFixed(2)}`, out: 'end', id: `rs-quarter-${i}`, className: 'rs-quarter' }).value;
    })
    .replace(/<span class="mf-c-value" data-mf-static>[^<]*<\/span>/g, () => {
      const i = valueIndex++;
      const arrival = TIME.firstBar + i * TIME.quarterGap + TIME.valueDelay;
      return line({ text: formatValue(revenue[i] as number, REVENUE_FORMAT), role: 'body', in: `rise@${arrival.toFixed(2)}`, out: 'end', id: `rs-value-${i}`, className: 'rs-value' }).value;
    });

  const badge = chip(ctx, { id: 'rs-delta', label: '' });
  const chipCopy = line({ text: delta, role: 'label', in: `rise@${TIME.delta}`, out: 'end', id: 'rs-change', className: 'rs-change' });
  const badgeWithCue = badge.html.value.replace('<span class="mf-s-label" data-mf-static></span>', chipCopy.value);
  const stage = html`<div class="rs-stage"><div class="rs-panel">
    <div class="rs-header">${title}<div class="rs-chip-slot">${trusted(badgeWithCue)}</div></div>
    <div class="rs-plot">${trusted(chartWithCues)}</div>
  </div></div>`;
  const cam = camera(ctx, stage, { id: 'rs-camera', moves: [{ kind: 'drift', from: 0, to: ctx.durationSec }] });

  const css = `
${chart.css}
${badge.css}
.rs-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.rs-panel { box-sizing: border-box; width: min(${u(1060)}, calc(100% - ${u(72)})); background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); }
.rs-header { display: flex; gap: ${u(24)}; align-items: center; justify-content: space-between; min-height: ${u(112)}; padding: ${u(32)} ${u(40)}; border-radius: var(--mf-radius) var(--mf-radius) 0 0; background: var(--mf-accent); }
.rs-title { min-width: 0; font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(58)}; line-height: 1.1; overflow-wrap: anywhere; color: ${onAccent(ctx)}; }
.rs-chip-slot { flex: none; }
#rs-delta { position: relative; top: auto; left: auto; background: var(--mf-ground); padding-block: ${u(18)}; opacity: 0; }
#rs-delta .mf-s-dot { display: none; }
.rs-change { display: block; font-size: ${u(34)}; color: var(--mf-ink); white-space: nowrap; }
.rs-plot { padding: ${u(26)} ${u(40)} ${u(42)}; }
#rs-chart { position: relative; top: auto; left: auto; width: auto; height: ${u(402)}; gap: ${u(22)}; }
#rs-chart .mf-c-col { min-width: 0; }
#rs-chart .mf-c-stack { box-sizing: content-box; min-height: 0; padding-top: ${u(50)}; }
#rs-chart .mf-c-bar { flex: none; transform-origin: 50% 100%; transform: scaleY(0); background: var(--mf-muted); }
#rs-chart .mf-c-col:last-child .mf-c-bar { background: var(--mf-accent); }
.rs-quarter, .rs-value { display: block; white-space: nowrap; font-size: ${u(34)}; font-variant-numeric: tabular-nums; font-weight: 700; }
.is-portrait .rs-title { font-size: ${u(48)}; }
.is-square .rs-title { font-size: ${u(54)}; }
${cam.css}
`;

  const script = `
    root.querySelectorAll('#rs-chart .mf-c-bar').forEach((bar, i) => {
      tl.to(bar, { scaleY: 1, duration: ${TIME.growth}, ease: 'power4.out' }, ${TIME.firstBar} + i * ${TIME.quarterGap});
    });
    tl.fromTo('#rs-delta', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(1.6)' }, ${TIME.delta});
    ${cam.script}
  `;
  return { id: meta.id, html: cam.html, css, script, assets: [], needsThree: false, holds: [] };
}

export default { meta, vars, build } satisfies MoveModule;

// Charts and counters (component-kit.md, MFM-027): bar (vertical, horizontal,
// race), line with draw-on, area, donut, stacked bar, sparkline, counter with
// stamp, KPI tile, table with row fill and map dots. Builders take
// { series, labels, format } data and are pure functions of (props, ctx);
// sizes in u, colours from tokens; labels are static UI text, numbers that
// count use the text-line `count` entrance. Animation runs through
// src/kit/runtime/charts.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../../engine/pins';
import { type TrustedHtml, html, trusted } from './html';
import type { Piece } from './materials';
import type { MoveCtx } from './move';
import { RAMP_U, line } from './type';
import { drawArcs, drawOn, grow, pulse, race as raceRuntime, reveal, rows as rowsRuntime } from '../runtime/charts';

export const CHART_IDS = ['bars', 'hbars', 'race', 'line', 'area', 'donut', 'stacked', 'sparkline', 'counter', 'kpi', 'table', 'map'] as const;
export type ChartId = (typeof CHART_IDS)[number];

export interface Format {
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export interface ChartPlace {
  id?: string;
  /** Offset from the copy box's top left, in u. */
  xU?: number;
  yU?: number;
  /** Entrance time (s). */
  at?: number;
  /** Exit time (s), or none. */
  out?: number | null;
  widthU?: number;
  heightU?: number;
}

const u = (n: number) => `calc(var(--mf-u) * ${n})`;
const fn = (f: (...args: never[]) => void) => `(${f.toString()})`;
const round = (n: number) => Math.round(n * 1000) / 1000;
/** Series colours in order, all tokens. */
const SERIES = ['var(--mf-accent)', 'var(--mf-accent2)', 'var(--mf-accent-soft)', 'var(--mf-muted)'];

/** A number as the chart shows it: prefix, grouped thousands, fixed decimals, suffix. */
export function formatValue(value: number, format: Format = {}): string {
  const decimals = format.decimals ?? 0;
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${format.prefix ?? ''}${grouped}${fraction ? `.${fraction}` : ''}${format.suffix ?? ''}`;
}

const label = (className: string, value: string) => html`<span class="${className}" data-mf-static>${value}</span>`;

function baseCss(): string {
  return `.mf-chart { position: absolute; box-sizing: border-box; font-family: var(--mf-font-body); color: var(--mf-ink); }
.mf-chart [data-mf-static] { white-space: nowrap; }
.mf-c-label { font-size: ${u(24)}; color: var(--mf-muted); line-height: 1.2; }
.mf-c-value { font-size: ${u(26)}; font-weight: 700; color: var(--mf-ink); line-height: 1.2; font-variant-numeric: tabular-nums; }
.mf-c-title { font-family: var(--mf-font-heading); font-size: ${u(30)}; font-weight: 700; line-height: 1.2; }
.mf-chart svg { display: block; overflow: visible; }`;
}

function place(kind: ChartId, props: ChartPlace, inner: TrustedHtml, css: string, script: string, size: { widthU: number; heightU: number }): Piece {
  const id = props.id ?? `c-${kind}`;
  const at = props.at ?? 0.2;
  const leave = props.out === null || props.out === undefined ? '' : `\n    tl.to('#${id}', { opacity: 0, duration: 0.35, ease: 'power2.in' }, ${props.out});`;
  return {
    html: html`<div class="mf-chart mf-c-${kind}" id="${id}" data-mf-piece="${kind}">${inner}</div>`,
    css: `${baseCss()}\n#${id} { left: calc(var(--mf-safe-l) + ${u(props.xU ?? 0)}); top: calc(var(--mf-safe-t) + ${u(props.yU ?? 0)}); width: ${u(props.widthU ?? size.widthU)}; height: ${u(props.heightU ?? size.heightU)}; }\n${css.replaceAll('#ID', `#${id}`)}`,
    script: `{\n    const piece = root.querySelector('#${id}');\n    const at = ${at};\n    tl.fromTo(piece, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, at);${leave}\n${script}\n  }`,
  };
}

export interface BarData extends ChartPlace {
  series?: number[];
  labels?: string[];
  format?: Format;
}

const DEFAULT_BARS = { series: [1.2, 2.6, 4.1, 6.8], labels: ['Q1', 'Q2', 'Q3', 'Q4'], format: { suffix: 'M', decimals: 1 } };

/** Vertical bars with value labels above and category labels below. */
export function bars(_ctx: MoveCtx, props: BarData = {}): Piece {
  const series = props.series ?? DEFAULT_BARS.series;
  const labels = props.labels ?? DEFAULT_BARS.labels;
  const format = props.format ?? DEFAULT_BARS.format;
  const max = Math.max(...series, 1e-9);
  const cols = trusted(
    series
      .map((value, i) => html`<div class="mf-c-col"><div class="mf-c-stack">${label('mf-c-value', formatValue(value, format))}<div class="mf-c-bar" style="height: ${round((value / max) * 100)}%"></div></div>${label('mf-c-label', labels[i] ?? '')}</div>`.value)
      .join(''),
  );
  return place('bars', props, cols, `#ID { display: flex; align-items: stretch; gap: ${u(28)}; }
#ID .mf-c-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: ${u(12)}; }
#ID .mf-c-stack { flex: 1; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: ${u(8)}; }
#ID .mf-c-bar { width: 100%; border-radius: ${u(10)} ${u(10)} ${u(4)} ${u(4)}; background: var(--mf-accent); }`, `    ${fn(grow)}(tl, [...piece.querySelectorAll('.mf-c-bar')], 'y', at + 0.1, 0.12);`, { widthU: 620, heightU: 420 });
}

/** Horizontal bars, label left, value right of the bar. */
export function hbars(_ctx: MoveCtx, props: BarData = {}): Piece {
  const series = props.series ?? [4820, 3910, 3650, 2740, 1980];
  const labels = props.labels ?? ['draft reply', 'plan', 'search', 'lookup', 'send'];
  const format = props.format ?? { suffix: ' ms' };
  const max = Math.max(...series, 1e-9);
  const rows = trusted(
    series
      .map((value, i) => html`<div class="mf-c-row">${label('mf-c-label', labels[i] ?? '')}<div class="mf-c-lane"><div class="mf-c-bar" style="width: ${round((value / max) * 100)}%"></div>${label('mf-c-value', formatValue(value, format))}</div></div>`.value)
      .join(''),
  );
  return place('hbars', props, rows, `#ID { display: flex; flex-direction: column; justify-content: space-between; }
#ID .mf-c-row { display: grid; grid-template-columns: ${u(180)} 1fr; align-items: center; gap: ${u(18)}; }
#ID .mf-c-lane { display: flex; align-items: center; gap: ${u(14)}; }
#ID .mf-c-bar { height: ${u(34)}; max-width: 70%; border-radius: ${u(6)}; background: var(--mf-accent); }`, `    ${fn(grow)}(tl, [...piece.querySelectorAll('.mf-c-bar')], 'x', at + 0.1, 0.1);`, { widthU: 680, heightU: 360 });
}

export interface RaceData extends ChartPlace {
  /** One array of values per step, one value per item. */
  steps?: number[][];
  labels?: string[];
  stepSec?: number;
  decimals?: number;
}

/** The final ranking of a race: item indices from first to last. */
export function raceRanking(values: number[]): number[] {
  return values.map((value, i) => [value, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
}

/** A bar race: bars resize and re-sort at each step; the leader ends on top. */
export function race(_ctx: MoveCtx, props: RaceData = {}): Piece {
  const steps = props.steps ?? [[30, 50, 20, 40], [55, 52, 35, 41], [62, 58, 70, 44], [70, 61, 88, 52]];
  const labels = props.labels ?? ['Traces', 'Evals', 'Prompts', 'Cost'];
  const pitchU = 72;
  const count = steps[0]?.length ?? 0;
  const items = trusted(
    Array.from({ length: count }, (_, i) => html`<div class="mf-c-row" data-index="${i}">${label('mf-c-label', labels[i] ?? '')}<div class="mf-c-lane"><div class="mf-c-bar"></div>${label('mf-c-value', String(steps[0]?.[i] ?? 0))}</div></div>`.value).join(''),
  );
  return place(
    'race',
    props,
    items,
    `#ID .mf-c-row { position: absolute; left: 0; right: 0; top: 0; height: ${u(pitchU - 16)}; display: grid; grid-template-columns: ${u(170)} 1fr; align-items: center; gap: ${u(16)}; }
#ID .mf-c-lane { display: flex; align-items: center; gap: ${u(14)}; }
#ID .mf-c-bar { height: ${u(36)}; width: 70%; border-radius: ${u(6)}; background: var(--mf-accent); }`,
    `    ${fn(raceRuntime)}(tl, [...piece.querySelectorAll('.mf-c-row')], ${JSON.stringify(steps)}, ${pitchU} * ctx.u, at + 0.5, ${props.stepSec ?? 0.8}, ${props.decimals ?? 0});`,
    { widthU: 640, heightU: pitchU * count },
  );
}

export interface LineData extends ChartPlace {
  series?: number[][];
  labels?: string[];
  format?: Format;
}

/** Polyline points of a series inside a w x h box (0 at the bottom). */
function points(series: number[], w: number, h: number, min: number, max: number): Array<[number, number]> {
  const span = max - min || 1;
  return series.map((value, i) => [round((i / Math.max(1, series.length - 1)) * w), round(h - ((value - min) / span) * h)]);
}

const toPath = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');

/** Line chart with draw-on: one stroke per series, end value labelled. */
export function lineChart(_ctx: MoveCtx, props: LineData = {}): Piece {
  const series = props.series ?? [[3.4, 3.1, 3.6, 3.0, 2.8, 2.9, 2.5, 2.4, 2.2, 2.1]];
  const format = props.format ?? { suffix: '¢', decimals: 1 };
  const w = props.widthU ?? 640;
  const h = (props.heightU ?? 360) - 60;
  const all = series.flat();
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 1e-9);
  const strokes = series.map((s, i) => `<path class="mf-c-stroke" d="${toPath(points(s, w, h, min, max))}" style="stroke: ${SERIES[i % SERIES.length]}"/>`).join('');
  const last = series[0] ?? [];
  const svg = trusted(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="mf-c-svg" aria-hidden="true"><path class="mf-c-axis" d="M0 ${h} L${w} ${h}"/>${strokes}</svg>`);
  return place('line', props, html`${svg}${label('mf-c-value', formatValue(last[last.length - 1] ?? 0, format))}`, `#ID .mf-c-svg { width: 100%; height: ${u(h)}; }
#ID .mf-c-stroke { fill: none; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
#ID .mf-c-axis { stroke: var(--mf-line); stroke-width: 2; }
#ID .mf-c-value { display: block; margin-top: ${u(16)}; text-align: right; }`, `    ${fn(drawOn)}(tl, [...piece.querySelectorAll('.mf-c-stroke')], at + 0.1, 1.2, 0.2);`, { widthU: w, heightU: props.heightU ?? 360 });
}

/** Area chart revealed left to right. */
export function area(_ctx: MoveCtx, props: LineData = {}): Piece {
  const series = props.series?.[0] ?? [12, 18, 15, 26, 31, 29, 38, 44];
  const w = props.widthU ?? 640;
  const h = (props.heightU ?? 360) - 60;
  const pts = points(series, w, h, 0, Math.max(...series, 1e-9));
  const clip = `${props.id ?? 'c-area'}-clip`;
  const svg = trusted(
    `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="mf-c-svg" aria-hidden="true"><defs><clipPath id="${clip}"><rect class="mf-c-clip" x="0" y="-20" width="${w}" height="${h + 40}"/></clipPath></defs><g clip-path="url(#${clip})"><path class="mf-c-fill" d="${toPath(pts)} L${w} ${h} L0 ${h} Z"/><path class="mf-c-edge" d="${toPath(pts)}"/></g></svg>`,
  );
  return place('area', props, html`${svg}${label('mf-c-label', props.labels?.[0] ?? 'Runs per day')}`, `#ID .mf-c-svg { width: 100%; height: ${u(h)}; }
#ID .mf-c-fill { fill: var(--mf-accent-soft); }
#ID .mf-c-edge { fill: none; stroke: var(--mf-accent); stroke-width: 5; stroke-linejoin: round; }
#ID .mf-c-label { display: block; margin-top: ${u(16)}; }`, `    ${fn(reveal)}(tl, piece.querySelector('.mf-c-clip'), ${w}, at + 0.1, 1.2);`, { widthU: w, heightU: props.heightU ?? 360 });
}

/** Donut: segments in series colours draw on in turn; the total in the middle. */
export function donut(_ctx: MoveCtx, props: BarData = {}): Piece {
  const series = props.series ?? [62, 23, 15];
  const labels = props.labels ?? ['Passed', 'Flaky', 'Failed'];
  const total = series.reduce((sum, v) => sum + v, 0) || 1;
  const r = 120;
  const c = round(2 * Math.PI * r);
  let offset = 0;
  const arcs = series
    .map((value, i) => {
      const arc = `<circle class="mf-c-arc" cx="160" cy="160" r="${r}" style="stroke: ${SERIES[i % SERIES.length]}; stroke-dashoffset: ${round(-offset)}" transform="rotate(-90 160 160)"/>`;
      offset += (value / total) * c;
      return arc;
    })
    .join('');
  const svg = trusted(`<svg viewBox="0 0 320 320" width="320" height="320" class="mf-c-svg" aria-hidden="true"><circle class="mf-c-ring" cx="160" cy="160" r="${r}"/>${arcs}</svg>`);
  const legend = trusted(labels.map((name, i) => html`<span class="mf-c-key"><span class="mf-c-swatch" style="background: ${SERIES[i % SERIES.length]}"></span>${label('mf-c-label', `${name} ${formatValue(((series[i] ?? 0) / total) * 100, { suffix: '%' })}`)}</span>`.value).join(''));
  return place(
    'donut',
    props,
    html`<div class="mf-c-wheel">${svg}${label('mf-c-value', formatValue(((series[0] ?? 0) / total) * 100, props.format ?? { suffix: '%' }))}</div><div class="mf-c-legend">${legend}</div>`,
    `#ID { display: flex; align-items: center; gap: ${u(36)}; }
#ID .mf-c-wheel { position: relative; width: ${u(320)}; height: ${u(320)}; flex: none; }
#ID .mf-c-svg { width: 100%; height: 100%; }
#ID .mf-c-ring { fill: none; stroke: var(--mf-line); stroke-width: 36; }
#ID .mf-c-arc { fill: none; stroke-width: 36; }
#ID .mf-c-wheel .mf-c-value { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: ${u(44)}; }
#ID .mf-c-legend { display: flex; flex-direction: column; gap: ${u(14)}; }
#ID .mf-c-key { display: flex; align-items: center; gap: ${u(12)}; }
#ID .mf-c-swatch { width: ${u(20)}; height: ${u(20)}; border-radius: ${u(5)}; }`,
    `    ${fn(drawArcs)}(tl, [...piece.querySelectorAll('.mf-c-arc')], ${JSON.stringify(series.map((v) => v / total))}, ${c}, at + 0.1, 1.2);`,
    { widthU: 640, heightU: 320 },
  );
}

export interface StackedData extends ChartPlace {
  /** One array per bar, one value per segment. */
  series?: number[][];
  labels?: string[];
}

/** Stacked bars: segments in series colours, growing from the base. */
export function stacked(_ctx: MoveCtx, props: StackedData = {}): Piece {
  const series = props.series ?? [[40, 25, 10], [45, 30, 12], [52, 28, 15], [60, 30, 18]];
  const labels = props.labels ?? ['Q1', 'Q2', 'Q3', 'Q4'];
  const max = Math.max(...series.map((bar) => bar.reduce((a, b) => a + b, 0)), 1e-9);
  const cols = trusted(
    series
      .map((bar, i) => {
        const segments = bar.map((value, k) => `<div class="mf-c-seg" style="height: ${round((value / max) * 100)}%; background: ${SERIES[k % SERIES.length]}"></div>`).join('');
        return html`<div class="mf-c-col"><div class="mf-c-stack"><div class="mf-c-bar">${trusted(segments)}</div></div>${label('mf-c-label', labels[i] ?? '')}</div>`.value;
      })
      .join(''),
  );
  return place('stacked', props, cols, `#ID { display: flex; gap: ${u(28)}; }
#ID .mf-c-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: ${u(12)}; }
#ID .mf-c-stack { flex: 1; width: 100%; display: flex; align-items: flex-end; }
#ID .mf-c-bar { width: 100%; height: 100%; display: flex; flex-direction: column-reverse; gap: ${u(3)}; }
#ID .mf-c-seg { width: 100%; border-radius: ${u(4)}; }`, `    ${fn(grow)}(tl, [...piece.querySelectorAll('.mf-c-bar')], 'y', at + 0.1, 0.12);`, { widthU: 600, heightU: 420 });
}

/** A sparkline: one small stroke with its last value, drawn on. */
export function sparkline(_ctx: MoveCtx, props: LineData = {}): Piece {
  const series = props.series?.[0] ?? [5, 6, 5, 7, 8, 7, 9, 10, 9, 12];
  const w = 260;
  const h = 70;
  const pts = points(series, w, h, Math.min(...series), Math.max(...series));
  const svg = trusted(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="mf-c-svg" aria-hidden="true"><path class="mf-c-stroke" d="${toPath(pts)}"/></svg>`);
  return place('sparkline', props, html`${label('mf-c-label', props.labels?.[0] ?? 'Pass rate')}${svg}${label('mf-c-value', formatValue(series[series.length - 1] ?? 0, props.format ?? { suffix: '%' }))}`, `#ID { display: flex; align-items: center; gap: ${u(20)}; }
#ID .mf-c-svg { width: ${u(w)}; height: ${u(h)}; }
#ID .mf-c-stroke { fill: none; stroke: var(--mf-accent); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }`, `    ${fn(drawOn)}(tl, [...piece.querySelectorAll('.mf-c-stroke')], at + 0.1, 0.9, 0);`, { widthU: 560, heightU: 90 });
}

export interface CounterData extends ChartPlace {
  value?: number;
  from?: number;
  format?: Format;
  label?: string;
}

/** A number counter: the text-line `count` entrance counts up and stamps the exact target. */
export function counter(_ctx: MoveCtx, props: CounterData = {}): Piece {
  const at = props.at ?? 0.2;
  const target = formatValue(props.value ?? 12480, props.format ?? {});
  const number = line({ text: target, role: 'hero', in: `count@${at}`, out: 'end', className: 'mf-c-count', id: `${props.id ?? 'c-counter'}-number`, from: props.from ?? 0 });
  return place('counter', props, html`${number}${label('mf-c-label', props.label ?? 'runs traced today')}`, `#ID { display: flex; flex-direction: column; gap: ${u(8)}; }
#ID .mf-c-count { font-family: var(--mf-font-display); font-weight: 800; font-size: ${u(RAMP_U.hero)}; line-height: 1; color: var(--mf-ink); font-variant-numeric: tabular-nums; }`, '', { widthU: 640, heightU: 240 });
}

/** A KPI tile: label, counted value and a delta chip. */
export function kpi(_ctx: MoveCtx, props: CounterData & { delta?: string } = {}): Piece {
  const at = props.at ?? 0.2;
  const target = formatValue(props.value ?? 94.2, props.format ?? { suffix: '%', decimals: 1 });
  const number = line({ text: target, role: 'title', in: `count@${at + 0.2}`, out: 'end', className: 'mf-c-count', id: `${props.id ?? 'c-kpi'}-number`, from: props.from ?? 0 });
  return place('kpi', props, html`${label('mf-c-label', props.label ?? 'Pass rate')}${number}<span class="mf-c-delta">${label('mf-c-dtext', props.delta ?? '+1.2 pts')}</span>`, `#ID { display: flex; flex-direction: column; gap: ${u(10)}; padding: ${u(28)} ${u(32)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); }
#ID .mf-c-count { font-family: var(--mf-font-display); font-weight: 800; font-size: ${u(RAMP_U.title)}; line-height: 1.05; color: var(--mf-ink); font-variant-numeric: tabular-nums; }
#ID .mf-c-delta { align-self: flex-start; padding: ${u(6)} ${u(14)}; border-radius: ${u(999)}; background: var(--mf-accent-soft); }
#ID .mf-c-dtext { font-size: ${u(22)}; font-weight: 700; color: var(--mf-ink); }`, '', { widthU: 380, heightU: 250 });
}

export interface TableData extends ChartPlace {
  rows?: string[][];
  head?: string[];
  highlight?: number | null;
}

/** A table whose rows appear one by one; the highlighted row's fill sweeps in last. */
export function table(_ctx: MoveCtx, props: TableData = {}): Piece {
  const head = props.head ?? ['Suite', 'Pass rate', 'vs v13'];
  const body = props.rows ?? [['refund-policy', '96.4%', '+1.2'], ['order-lookup', '93.8%', '+0.4'], ['escalation', '88.2%', '-2.6'], ['multi-step', '91.5%', '+3.1']];
  const highlight = props.highlight === undefined ? 2 : props.highlight;
  const cells = (cellsRow: string[], className: string) => trusted(cellsRow.map((cell) => label(className, cell).value).join(''));
  const rowsHtml = trusted(body.map((cellsRow, i) => html`<div class="mf-c-tr${i === highlight ? ' is-hot' : ''}">${i === highlight ? html`<span class="mf-c-hot"></span>` : ''}${cells(cellsRow, 'mf-c-td')}</div>`.value).join(''));
  return place('table', props, html`<div class="mf-c-th">${cells(head, 'mf-c-label')}</div>${rowsHtml}`, `#ID { display: flex; flex-direction: column; border: 1px solid var(--mf-line); border-radius: var(--mf-radius); background: var(--mf-surface); overflow: hidden; }
#ID .mf-c-th, #ID .mf-c-tr { position: relative; display: grid; grid-template-columns: 1.6fr 1fr 0.8fr; gap: ${u(16)}; padding: ${u(16)} ${u(24)}; align-items: center; }
#ID .mf-c-tr { border-top: 1px solid var(--mf-line); }
#ID .mf-c-hot { position: absolute; inset: 0; background: var(--mf-accent-soft); }
#ID .mf-c-td { position: relative; font-size: ${u(26)}; color: var(--mf-ink); }`, `    ${fn(rowsRuntime)}(tl, [...piece.querySelectorAll('.mf-c-tr')], piece.querySelector('.mf-c-hot'), at + 0.2, 0.18);`, { widthU: 640, heightU: 340 });
}

let landMask: Uint8Array | null = null;

/** The committed land mask (assets/kit/land-110m.bin, 360 x 180 one-degree cells). */
export function land(root = packageRoot()): (lat: number, lon: number) => boolean {
  landMask ??= new Uint8Array(readFileSync(path.join(root, 'assets', 'kit', 'land-110m.bin')));
  const bits = landMask;
  return (lat, lon) => {
    const row = Math.min(179, Math.max(0, Math.floor(90 - lat)));
    const col = Math.min(359, Math.max(0, Math.floor(lon + 180)));
    const index = row * 360 + col;
    return ((bits[index >> 3] ?? 0) & (0x80 >> (index & 7))) !== 0;
  };
}

export interface MapData extends ChartPlace {
  /** Highlighted places. */
  points?: Array<{ lat: number; lon: number }>;
  /** Dot pitch in degrees. */
  stepDeg?: number;
}

/** Map dots: land as a dot grid (equirectangular), highlighted places pulse in accent. */
export function map(_ctx: MoveCtx, props: MapData = {}): Piece {
  const step = props.stepDeg ?? 4;
  const isLand = land();
  const w = 720;
  const h = 300;
  const x = (lon: number) => round(((lon + 180) / 360) * w);
  const y = (lat: number) => round(((80 - lat) / 140) * h);
  const dots: string[] = [];
  for (let lat = 78; lat >= -58; lat -= step) for (let lon = -178; lon <= 178; lon += step) if (isLand(lat, lon)) dots.push(`<circle cx="${x(lon)}" cy="${y(lat)}" r="${round(step * 0.55)}"/>`);
  const hot = (props.points ?? [{ lat: 40.7, lon: -74 }, { lat: 51.5, lon: -0.1 }, { lat: 1.35, lon: 103.8 }, { lat: -33.9, lon: 151.2 }]).map((p) => `<circle class="mf-c-hotdot" cx="${x(p.lon)}" cy="${y(p.lat)}" r="${round(step * 1.1)}"/>`).join('');
  const svg = trusted(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="mf-c-svg" aria-hidden="true"><g class="mf-c-land">${dots.join('')}</g>${hot}</svg>`);
  return place('map', props, svg, `#ID .mf-c-svg { width: 100%; height: 100%; }
#ID .mf-c-land { fill: var(--mf-line); }
#ID .mf-c-hotdot { fill: var(--mf-accent); }`, `    ${fn(pulse)}(tl, piece.querySelector('.mf-c-land'), [...piece.querySelectorAll('.mf-c-hotdot')], at);`, { widthU: w, heightU: h });
}

export const CHARTS: Record<ChartId, (ctx: MoveCtx, props?: ChartPlace) => Piece> = {
  bars, hbars, race, line: lineChart, area, donut, stacked, sparkline, counter, kpi, table, map,
};

/// <reference lib="dom" />
// Runtime parts of the kit charts (component-kit.md, Charts and counters):
// growth, draw-on, the race re-sort and the row fill, as timeline tweens so
// every frame can be sought. Self-contained: the builder inlines the source.

interface Timeline {
  to(target: Element | Element[] | object, vars: Record<string, unknown>, position?: number): unknown;
  set(target: Element | Element[] | object, vars: Record<string, unknown>, position?: number): unknown;
}

/** Bars grow from their base on `axis` (x or y), staggered. */
export function grow(tl: Timeline, bars: Element[], axis: 'x' | 'y', at: number, stagger: number): void {
  const key = axis === 'x' ? 'scaleX' : 'scaleY';
  const origin = axis === 'x' ? '0% 50%' : '50% 100%';
  bars.forEach((bar, i) => {
    tl.set(bar, { [key]: 0, transformOrigin: origin }, 0);
    tl.to(bar, { [key]: 1, duration: 0.7, ease: 'power3.out' }, at + i * stagger);
  });
}

/** Strokes draw on from 0 to their full length (stroke-dashoffset). */
export function drawOn(tl: Timeline, paths: SVGGeometryElement[], at: number, duration: number, stagger: number): void {
  paths.forEach((path, i) => {
    const length = path.getTotalLength();
    tl.set(path, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length }, 0);
    tl.to(path, { strokeDashoffset: 0, duration, ease: 'power2.inOut' }, at + i * stagger);
  });
}

/** Donut segments draw on in turn: each arc grows from 0 to its share of the ring. */
export function drawArcs(tl: Timeline, arcs: SVGCircleElement[], shares: number[], circumference: number, at: number, duration: number): void {
  let start = at;
  arcs.forEach((arc, i) => {
    const length = (shares[i] ?? 0) * circumference;
    tl.set(arc, { strokeDasharray: `0 ${circumference}` }, 0);
    const own = duration * (shares[i] ?? 0);
    tl.to(arc, { strokeDasharray: `${length} ${circumference}`, duration: own, ease: 'none' }, start);
    start += own;
  });
}

/** An area reveals left to right through its clip rectangle. */
export function reveal(tl: Timeline, rect: Element, width: number, at: number, duration: number): void {
  tl.set(rect, { attr: { width: 0 } }, 0);
  tl.to(rect, { attr: { width }, duration, ease: 'power2.inOut' }, at);
}

/**
 * Race: at each step the bars take their widths (share of the step's maximum)
 * and slide to their rank; the value text follows the bar.
 */
export function race(tl: Timeline, rows: HTMLElement[], steps: number[][], rowPitch: number, at: number, stepSec: number, decimals: number): void {
  const ranks = (values: number[]) => {
    const order = values.map((value, i) => [value, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const out: number[] = [];
    order.forEach(([, i], rank) => {
      out[i] = rank;
    });
    return out;
  };
  const first = steps[0] ?? [];
  const firstMax = Math.max(...first, 1e-9);
  const firstRanks = ranks(first);
  rows.forEach((row, i) => {
    const bar = row.querySelector('.mf-c-bar') as HTMLElement;
    const label = row.querySelector('.mf-c-value') as HTMLElement;
    const state = { v: first[i] ?? 0 };
    const write = () => {
      label.textContent = state.v.toFixed(decimals);
    };
    tl.set(row, { y: (firstRanks[i] ?? 0) * rowPitch }, 0);
    tl.set(bar, { scaleX: (first[i] ?? 0) / firstMax, transformOrigin: '0% 50%' }, 0);
    write();
    for (let k = 1; k < steps.length; k += 1) {
      const values = steps[k] ?? [];
      const max = Math.max(...values, 1e-9);
      const when = at + (k - 1) * stepSec;
      const move = { duration: stepSec * 0.8, ease: 'power2.inOut' };
      tl.to(row, { ...move, y: (ranks(values)[i] ?? 0) * rowPitch }, when);
      tl.to(bar, { ...move, scaleX: (values[i] ?? 0) / max }, when);
      tl.to(state, { ...move, v: values[i] ?? 0, onUpdate: write }, when);
    }
  });
}

/** Table rows appear one by one; the highlighted row's fill sweeps in after them. */
export function rows(tl: Timeline, items: Element[], highlight: Element | null, at: number, stagger: number): void {
  items.forEach((item, i) => {
    tl.set(item, { opacity: 0, x: -12 }, 0);
    tl.to(item, { opacity: 1, x: 0, duration: 0.35, ease: 'power2.out' }, at + i * stagger);
  });
  if (highlight) {
    tl.set(highlight, { scaleX: 0, transformOrigin: '0% 50%' }, 0);
    tl.to(highlight, { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, at + items.length * stagger + 0.1);
  }
}

/** Map dots: the highlighted dots pulse in after the land dots fade up. */
export function pulse(tl: Timeline, land: Element, hot: Element[], at: number): void {
  tl.set(land, { opacity: 0 }, 0);
  tl.to(land, { opacity: 1, duration: 0.6, ease: 'power1.out' }, at);
  hot.forEach((dot, i) => {
    tl.set(dot, { scale: 0, transformOrigin: '50% 50%', transformBox: 'fill-box' }, 0);
    tl.to(dot, { scale: 1, duration: 0.4, ease: 'back.out(3)' }, at + 0.5 + i * 0.12);
  });
}

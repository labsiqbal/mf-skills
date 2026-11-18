/// <reference lib="dom" />
// Runtime part of the kit cursor (component-kit.md, Cursor and camera): a path
// through waypoints, hover, a click squash (scale 0.86 for 80 ms) and a
// selection box, all as timeline tweens keyed by resolved times.
// Self-contained: the builder inlines the source.

interface Timeline {
  to(target: Element | object, vars: Record<string, unknown>, position?: number): unknown;
  set(target: Element | object, vars: Record<string, unknown>, position?: number): unknown;
}

export interface CursorPlan {
  /** Waypoints: time (s) and position (px) inside the cursor layer. */
  path: Array<{ at: number; x: number; y: number }>;
  /** Click times (s). */
  clicks: number[];
  /** Hover: elements that lift while the cursor rests on them. */
  hovers: Array<{ el: Element; from: number; to: number }>;
  /** Selection box: drawn from (x, y) to (x + w, y + h) between from and to (px). */
  select: { box: HTMLElement; from: number; to: number; x: number; y: number; w: number; h: number } | null;
  /** Squash scale and duration (s). */
  squash: number;
  squashSec: number;
  /** Travel duration between waypoints (s) and its ease. */
  travelSec: number;
  ease: string;
}

export function runCursor(tl: Timeline, cursor: HTMLElement, plan: CursorPlan): void {
  const first = plan.path[0];
  if (first) tl.set(cursor, { x: first.x, y: first.y }, 0);
  for (let i = 1; i < plan.path.length; i += 1) {
    const point = plan.path[i];
    const before = plan.path[i - 1];
    if (!point || !before) continue;
    const duration = Math.max(0.05, Math.min(plan.travelSec, point.at - before.at));
    tl.to(cursor, { x: point.x, y: point.y, duration, ease: plan.ease }, point.at - duration);
  }
  for (const at of plan.clicks) {
    tl.to(cursor, { scale: plan.squash, duration: plan.squashSec / 2, ease: 'power2.out' }, at);
    tl.to(cursor, { scale: 1, duration: plan.squashSec / 2, ease: 'power2.in' }, at + plan.squashSec / 2);
  }
  for (const hover of plan.hovers) {
    tl.to(hover.el, { y: -4, duration: 0.15, ease: 'power2.out' }, hover.from);
    tl.to(hover.el, { y: 0, duration: 0.15, ease: 'power2.in' }, hover.to);
  }
  if (plan.select) {
    const s = plan.select;
    // The box has its final size from the start and grows by scale (layout never animates).
    s.box.style.width = `${s.w}px`;
    s.box.style.height = `${s.h}px`;
    tl.set(s.box, { x: s.x, y: s.y, scaleX: 0, scaleY: 0, transformOrigin: '0% 0%', autoAlpha: 0 }, 0);
    tl.set(s.box, { autoAlpha: 1 }, s.from);
    tl.to(s.box, { scaleX: 1, scaleY: 1, duration: s.to - s.from, ease: 'power1.inOut' }, s.from);
  }
}

/// <reference lib="dom" />
// Runtime parts of the kit's UI surfaces (component-kit.md, Cards and UI
// surfaces): press, caret blink, progress fill and checkbox tick, all as
// timeline tweens so any frame can be sought. Each function is self-contained
// because the builder inlines its source into the composition script.

interface Timeline {
  to(target: Element | object, vars: Record<string, unknown>, position?: number): unknown;
  set(target: Element | object, vars: Record<string, unknown>, position?: number): unknown;
}

/** Button press: scale down for 80 ms and back, transforms only. */
export function press(tl: Timeline, element: Element, at: number): void {
  tl.to(element, { scale: 0.94, duration: 0.08, ease: 'power2.out' }, at);
  tl.to(element, { scale: 1, duration: 0.22, ease: 'back.out(2)' }, at + 0.08);
}

/** Caret blink: on for 0.5 s, off for 0.5 s, from `from` to `to`, as stepped sets. */
export function blink(tl: Timeline, element: Element, from: number, to: number): void {
  tl.set(element, { opacity: 1 }, 0);
  for (let t = from; t < to; t += 1) {
    tl.set(element, { opacity: 0 }, t + 0.5);
    tl.set(element, { opacity: 1 }, t + 1);
  }
}

/** Progress fill: the bar's fill scales on x to `value` (0-1). */
export function fill(tl: Timeline, element: Element, value: number, at: number, duration: number): void {
  tl.set(element, { scaleX: 0, transformOrigin: '0% 50%' }, 0);
  tl.to(element, { scaleX: Math.max(0, Math.min(1, value)), duration, ease: 'power2.inOut' }, at);
}

/** Checkbox tick: the box fills and the mark draws in, transform and opacity only. */
export function tick(tl: Timeline, box: Element, mark: Element, at: number): void {
  tl.set(mark, { opacity: 0, scale: 0.4 }, 0);
  tl.to(box, { scale: 0.88, duration: 0.08, ease: 'power2.out' }, at);
  tl.to(box, { scale: 1, duration: 0.2, ease: 'back.out(2)' }, at + 0.08);
  tl.to(mark, { opacity: 1, scale: 1, duration: 0.22, ease: 'back.out(2.4)' }, at + 0.05);
}

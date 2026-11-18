/// <reference lib="dom" />
// Runtime part of the kit camera rig (component-kit.md, Cursor and camera):
// push, dive, whip (with directional motion blur), rack focus, orbit and a
// seeded drift on a stage element, all as timeline tweens keyed by resolved
// times. Self-contained: the builder inlines the source.

interface Timeline {
  to(target: Element | object, vars: Record<string, unknown>, position?: number): unknown;
  set(target: Element | object, vars: Record<string, unknown>, position?: number): unknown;
  fromTo(target: Element | object, from: Record<string, unknown>, to: Record<string, unknown>, position?: number): unknown;
}

export type CameraMove =
  | { kind: 'push'; at: number; scale: number; duration: number; ease: string }
  | { kind: 'dive'; at: number; scale: number; blur: number; duration: number; ease: string }
  | { kind: 'whip'; at: number; travel: number; blur: number; duration: number; direction: 1 | -1 }
  | { kind: 'rack'; at: number; blur: number; opacity: number; duration: number; ease: string }
  | { kind: 'orbit'; at: number; deg: number; duration: number; ease: string }
  | { kind: 'drift'; from: number; to: number; amplitude: number; periodSec: number };

export interface CameraParts {
  stage: HTMLElement;
  /** The layer around the stage that drift moves, so drift never adds to the stage's own moves. */
  drift: HTMLElement;
  /** The directional blur used by whip (an feGaussianBlur in the page). */
  blur: SVGElement | null;
  /** Rack focus: near and far layers. */
  near: HTMLElement | null;
  far: HTMLElement | null;
}

export function runCamera(tl: Timeline, parts: CameraParts, moves: CameraMove[], rand: () => number): void {
  const stage = parts.stage;
  tl.set(stage, { transformOrigin: '50% 50%', transformPerspective: 0 }, 0);
  for (const move of moves) {
    if (move.kind === 'push') {
      tl.to(stage, { scale: move.scale, duration: move.duration, ease: move.ease }, move.at);
    } else if (move.kind === 'dive') {
      tl.to(stage, { scale: move.scale, filter: `blur(${move.blur}px)`, opacity: 0, duration: move.duration, ease: move.ease }, move.at);
    } else if (move.kind === 'whip') {
      const half = move.duration / 2;
      tl.to(stage, { x: `+=${move.direction * move.travel}`, duration: move.duration, ease: 'power3.inOut' }, move.at);
      if (parts.blur) {
        tl.set(stage, { filter: 'url(#mf-cam-whip)' }, move.at);
        tl.fromTo(parts.blur, { attr: { stdDeviation: '0 0' } }, { attr: { stdDeviation: `${move.blur} 0` }, duration: half, ease: 'power2.in' }, move.at);
        tl.to(parts.blur, { attr: { stdDeviation: '0 0' }, duration: half, ease: 'power2.out' }, move.at + half);
        tl.set(stage, { filter: 'none' }, move.at + move.duration);
      }
    } else if (move.kind === 'rack') {
      if (parts.near && parts.far) {
        tl.set(parts.far, { filter: `blur(${move.blur}px)`, opacity: move.opacity }, 0);
        tl.to(parts.near, { filter: `blur(${move.blur}px)`, opacity: move.opacity, duration: move.duration, ease: move.ease }, move.at);
        tl.to(parts.far, { filter: 'blur(0px)', opacity: 1, duration: move.duration, ease: move.ease }, move.at);
      }
    } else if (move.kind === 'orbit') {
      tl.to(stage, { rotationY: move.deg, duration: move.duration, ease: move.ease }, move.at);
    } else {
      // Seeded drift: a gentle wander through random points around rest, one per period.
      let at = move.from;
      while (at < move.to) {
        const duration = Math.min(move.periodSec, move.to - at);
        tl.to(parts.drift, { x: (rand() - 0.5) * 2 * move.amplitude, y: (rand() - 0.5) * 2 * move.amplitude, duration, ease: 'sine.inOut' }, at);
        at += duration;
      }
    }
  }
}

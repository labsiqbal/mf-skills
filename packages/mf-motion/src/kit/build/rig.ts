// Cursor and camera (component-kit.md, MFM-029): a cursor with a path, hover,
// click squash (scale 0.86 for 80 ms) and selection box, and a camera rig with
// push, dive, whip (700 px travel with 26 px motion blur), rack (focus by blur
// and opacity), orbit (a small y turn) and seeded drift. Every move is keyed
// by a time spec, resolved in the page with mf.t; lengths are base pixels
// scaled by u; camera values come from the motion.* numbers.
import { NUMBERS } from '../numbers';
import { type TrustedHtml, html, trusted } from './html';
import type { Piece } from './materials';
import type { MoveCtx } from './move';
import { runCamera } from '../runtime/camera';
import { runCursor } from '../runtime/cursor';
import { parse } from '../../time/index';

type TimeSpec = string | number;

export const CURSOR = { squash: 0.86, squashMs: 80, travelSec: NUMBERS['motion.cameraSec'].typical, ease: NUMBERS['motion.cameraSec'].ease } as const;
export const CAMERA = { whipTravelPx: 700, whipBlurPx: 26, whipSec: 0.5, orbitDeg: 8, driftPx: 6, driftPeriodSec: 1.2 } as const;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;
const fn = (f: (...args: never[]) => void) => `(${f.toString()})`;

/** A time spec as page code: validated here so a bad spec fails the build, resolved in the page. */
function at(spec: TimeSpec): string {
  parse(spec);
  return `mf.t(${JSON.stringify(spec)})`;
}

export interface CursorProps {
  id?: string;
  /** Waypoints in u from the copy box's top left. */
  path: Array<{ at: TimeSpec; xU: number; yU: number }>;
  clicks?: TimeSpec[];
  /** Selectors (inside the move) that lift while the cursor rests on them. */
  hovers?: Array<{ selector: string; from: TimeSpec; to: TimeSpec }>;
  select?: { from: TimeSpec; to: TimeSpec; xU: number; yU: number; widthU: number; heightU: number };
  /** Cursor size in u. */
  sizeU?: number;
}

/** The cursor layer: an arrow (ink with a ground outline) and an optional selection box. */
export function cursor(_ctx: MoveCtx, props: CursorProps): Piece {
  const id = props.id ?? 'rig-cursor';
  const size = props.sizeU ?? 46;
  const arrow = trusted('<svg viewBox="0 0 24 24" class="mf-r-arrow" aria-hidden="true"><path d="M3 2 L3 19 L8 14.5 L11.5 22 L14.5 20.6 L11 13.2 L17.5 13.2 Z"/></svg>');
  const plan = [
    '{',
    `      path: [${props.path.map((p) => `{ at: ${at(p.at)}, x: ${p.xU} * ctx.u, y: ${p.yU} * ctx.u }`).join(', ')}],`,
    `      clicks: [${(props.clicks ?? []).map(at).join(', ')}],`,
    `      hovers: [${(props.hovers ?? []).map((h) => `{ el: root.querySelector(${JSON.stringify(h.selector)}), from: ${at(h.from)}, to: ${at(h.to)} }`).join(', ')}].filter((h) => h.el),`,
    `      select: ${props.select ? `{ box: layer.querySelector('.mf-r-select'), from: ${at(props.select.from)}, to: ${at(props.select.to)}, x: ${props.select.xU} * ctx.u, y: ${props.select.yU} * ctx.u, w: ${props.select.widthU} * ctx.u, h: ${props.select.heightU} * ctx.u }` : 'null'},`,
    `      squash: ${CURSOR.squash}, squashSec: ${CURSOR.squashMs / 1000}, travelSec: ${CURSOR.travelSec}, ease: '${CURSOR.ease}',`,
    '    }',
  ].join('\n');
  return {
    html: html`<div class="mf-r-layer" id="${id}" aria-hidden="true">${props.select ? html`<div class="mf-r-select"></div>` : ''}<div class="mf-r-cursor">${arrow}</div></div>`,
    css: `#${id} { position: absolute; left: var(--mf-safe-l); top: var(--mf-safe-t); width: 0; height: 0; z-index: 10; pointer-events: none; }
#${id} .mf-r-cursor { position: absolute; left: 0; top: 0; width: ${u(size)}; height: ${u(size)}; transform-origin: 15% 10%; filter: drop-shadow(0 ${u(4)} ${u(8)} var(--mf-shadow)); }
#${id} .mf-r-arrow { width: 100%; height: 100%; display: block; }
#${id} .mf-r-arrow path { fill: var(--mf-ink); stroke: var(--mf-ground); stroke-width: 1.6; stroke-linejoin: round; }
#${id} .mf-r-select { position: absolute; left: 0; top: 0; box-sizing: border-box; border: ${u(3)} solid var(--mf-accent); background: color-mix(in srgb, var(--mf-accent) 14%, transparent); border-radius: ${u(6)}; }`,
    script: `{\n    const layer = root.querySelector('#${id}');\n    ${fn(runCursor)}(tl, layer.querySelector('.mf-r-cursor'), ${plan});\n  }`,
  };
}

export type CameraSpec =
  | { kind: 'push'; at: TimeSpec; scale?: number }
  | { kind: 'dive'; at: TimeSpec; scale?: number }
  | { kind: 'whip'; at: TimeSpec; direction?: 1 | -1 }
  | { kind: 'rack'; at: TimeSpec }
  | { kind: 'orbit'; at: TimeSpec; deg?: number }
  | { kind: 'drift'; from: TimeSpec; to: TimeSpec };

export interface CameraProps {
  id?: string;
  moves: CameraSpec[];
  /** Rack focus: a near and a far layer instead of one stage body. */
  near?: TrustedHtml;
  far?: TrustedHtml;
}

/** Mid value of a numbers range. */
const mid = (range: { min: number; max: number }) => (range.min + range.max) / 2;

/** A camera around `inner` (the move's content): the stage takes push, dive, whip and orbit; drift moves the layer around it. */
export function camera(ctx: MoveCtx, inner: TrustedHtml, props: CameraProps): Piece {
  const id = props.id ?? 'rig-camera';
  const cam = NUMBERS['motion.cameraSec'];
  const moves = props.moves
    .map((move) => {
      switch (move.kind) {
        case 'push':
          return `{ kind: 'push', at: ${at(move.at)}, scale: ${move.scale ?? NUMBERS['motion.pushInScale']}, duration: ${cam.typical}, ease: '${cam.ease}' }`;
        case 'dive':
          return `{ kind: 'dive', at: ${at(move.at)}, scale: ${move.scale ?? mid(NUMBERS['motion.diveScale'])}, blur: ${mid(NUMBERS['motion.dofBlurPx'].blur)} * ctx.u, duration: ${cam.typical}, ease: '${NUMBERS['motion.diveScale'].ease}' }`;
        case 'whip':
          return `{ kind: 'whip', at: ${at(move.at)}, travel: ${CAMERA.whipTravelPx} * ctx.u, blur: ${CAMERA.whipBlurPx} * ctx.u, duration: ${CAMERA.whipSec}, direction: ${move.direction ?? -1} }`;
        case 'rack':
          return `{ kind: 'rack', at: ${at(move.at)}, blur: ${mid(NUMBERS['motion.dofBlurPx'].blur)} * ctx.u, opacity: ${mid(NUMBERS['motion.dofBlurPx'].opacity)}, duration: ${cam.typical}, ease: '${cam.ease}' }`;
        case 'orbit':
          return `{ kind: 'orbit', at: ${at(move.at)}, deg: ${move.deg ?? CAMERA.orbitDeg}, duration: ${cam.typical * 2}, ease: '${cam.ease}' }`;
        case 'drift':
          return `{ kind: 'drift', from: ${at(move.from)}, to: ${at(move.to)}, amplitude: ${CAMERA.driftPx} * ctx.u, periodSec: ${CAMERA.driftPeriodSec} }`;
      }
      return '';
    })
    .join(', ');
  const rack = props.near && props.far ? html`<div class="mf-r-far">${props.far}</div><div class="mf-r-near">${props.near}</div>` : '';
  return {
    html: html`<div class="mf-r-camera" id="${id}"><svg class="mf-r-defs" aria-hidden="true"><filter id="mf-cam-whip" x="-20%" y="0%" width="140%" height="100%"><feGaussianBlur stdDeviation="0 0"/></filter></svg><div class="mf-r-drift"><div class="mf-r-stage">${inner}${rack}</div></div></div>`,
    css: `#${id} { position: absolute; inset: 0; perspective: ${u(NUMBERS['motion.perspectivePx'])}; overflow: hidden; }
#${id} .mf-r-defs { position: absolute; width: 0; height: 0; }
#${id} .mf-r-drift, #${id} .mf-r-stage, #${id} .mf-r-near, #${id} .mf-r-far { position: absolute; inset: 0; }`,
    script: `{\n    const cam = root.querySelector('#${id}');\n    ${fn(runCamera)}(tl, { stage: cam.querySelector('.mf-r-stage'), drift: cam.querySelector('.mf-r-drift'), blur: cam.querySelector('#mf-cam-whip feGaussianBlur'), near: cam.querySelector('.mf-r-near'), far: cam.querySelector('.mf-r-far') }, [${moves}], mf.rand(${ctx.seed}));\n  }`,
  };
}

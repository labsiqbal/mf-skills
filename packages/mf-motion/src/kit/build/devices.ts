// Device frames (component-kit.md, MFM-028): procedural, unbranded phone,
// laptop, browser window and tablet in CSS 3D, and a true-3D laptop and phone
// in three.js. No notch shapes, logos or buttons of real products. Screens
// show an image, an image stack stepped at 12 fps, or a live kit sub-tree.
// Sizes in u, colours from tokens; screen images are build assets.
import { type TrustedHtml, html, trusted } from './html';
import type { Piece } from './materials';
import type { MoveCtx } from './move';
import { device3d, stepStack } from '../runtime/devices3d';

export const DEVICE_IDS = ['phone', 'laptop', 'browser', 'tablet', 'laptop3d', 'phone3d'] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];
export const STACK_FPS = 12;

export type Screen =
  | { kind: 'image'; file: string }
  /** Files shown in turn at 12 fps. */
  | { kind: 'stack'; files: string[] }
  /** Kit markup laid out inside the screen (CSS 3D devices only). */
  | { kind: 'tree'; html: TrustedHtml; css?: string };

export interface DevicePlace {
  id?: string;
  /** Offset from the copy box's top left, in u. */
  xU?: number;
  yU?: number;
  /** Device width in u (height follows the device's proportions). */
  widthU?: number;
  at?: number;
  out?: number | null;
  /** Turn on y in degrees, from and to over the piece's life. */
  turnFromDeg?: number;
  turnToDeg?: number;
  screen?: Screen;
}

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

/** Whether the brand ground is dark (relative luminance under 0.18). */
function groundIsDark(ctx: MoveCtx): boolean {
  const hex = ctx.brand.colors.ground.replace('#', '');
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) < 0.18;
}

/** Device frame colour: charcoal lifted from a dark ground, or the ink on a light one. */
const frameColor = (ctx: MoveCtx) => (groundIsDark(ctx) ? 'color-mix(in oklab, var(--mf-ground) 78%, var(--mf-ink))' : 'var(--mf-ink)');
const fn = (f: (...args: never[]) => void) => `(${f.toString()})`;

/** Width-to-height ratio of each device's outer frame. */
const RATIO: Record<DeviceId, number> = { phone: 9 / 19, laptop: 16 / 11, browser: 16 / 10.5, tablet: 3 / 4, laptop3d: 16 / 10, phone3d: 3 / 4 };
const DEFAULT_WIDTH: Record<DeviceId, number> = { phone: 300, laptop: 760, browser: 760, tablet: 460, laptop3d: 760, phone3d: 480 };

/** Screen markup: images become assets; a stack steps through its images. */
function screenMarkup(ctx: MoveCtx, screen: Screen, id: string): { markup: TrustedHtml; css: string; images: string[] } {
  if (screen.kind === 'tree') return { markup: html`<div class="mf-d-tree">${screen.html}</div>`, css: screen.css ?? '', images: [] };
  const files = screen.kind === 'image' ? [screen.file] : screen.files;
  const urls = files.map((file, i) => ctx.assets.add(file, `${id}-screen-${i}${file.slice(file.lastIndexOf('.'))}`));
  return { markup: trusted(urls.map((url, i) => html`<img class="mf-d-shot" data-frame="${i}" src="${url}" alt="">`.value).join('')), css: '', images: urls };
}

function place(kind: DeviceId, ctx: MoveCtx, props: DevicePlace, inner: TrustedHtml, css: string, script: string): Piece {
  const id = props.id ?? `d-${kind}`;
  const at = props.at ?? 0.2;
  const width = props.widthU ?? DEFAULT_WIDTH[kind];
  const leave = props.out === null || props.out === undefined ? '' : `\n    tl.to(piece, { opacity: 0, duration: 0.35, ease: 'power2.in' }, ${props.out});`;
  return {
    html: html`<div class="mf-device mf-d-${kind}" id="${id}" data-mf-piece="${kind}">${inner}</div>`,
    css: `.mf-device { position: absolute; box-sizing: border-box; perspective: ${u(2400)}; }
.mf-device * { box-sizing: border-box; }
.mf-d-shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.mf-d-tree { position: absolute; inset: 0; overflow: hidden; }
#${id} { left: calc(var(--mf-safe-l) + ${u(props.xU ?? 0)}); top: calc(var(--mf-safe-t) + ${u(props.yU ?? 0)}); width: ${u(width)}; height: ${u(Math.round(width / RATIO[kind]))}; }
${css.replaceAll('#ID', `#${id}`)}`,
    script: `{\n    const piece = root.querySelector('#${id}');\n    const at = ${at};\n    tl.fromTo(piece, { opacity: 0, y: 30 * ctx.u }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, at);${leave}\n${script}\n  }`,
  };
}

/** The stack stepping script for a CSS screen, or nothing for one image or a tree. */
function stackScript(props: DevicePlace, ctx: MoveCtx): string {
  if (props.screen?.kind !== 'stack') return '';
  return `    ${fn(stepStack)}(tl, [...piece.querySelectorAll('.mf-d-shot')], at, ${ctx.durationSec}, ${STACK_FPS});`;
}

/** The turn of a CSS device: rotateY tween over its life. */
function turnScript(props: DevicePlace, ctx: MoveCtx, selector: string): string {
  const from = props.turnFromDeg ?? -14;
  const to = props.turnToDeg ?? 8;
  return `    tl.fromTo(piece.querySelector('${selector}'), { rotateY: ${from} }, { rotateY: ${to}, duration: ${ctx.durationSec}, ease: 'none' }, 0);`;
}

const defaultScreen = (): Screen => ({ kind: 'tree', html: html`<div class="mf-d-blank"></div>`, css: `.mf-d-blank { position: absolute; inset: 0; background: linear-gradient(to bottom, var(--mf-surface), var(--mf-ground)); }` });

export function phone(ctx: MoveCtx, props: DevicePlace = {}): Piece {
  const id = props.id ?? 'd-phone';
  const screen = screenMarkup(ctx, props.screen ?? defaultScreen(), id);
  return place('phone', ctx, props, html`<div class="mf-d-body"><div class="mf-d-screen">${screen.markup}</div></div>`, `#ID .mf-d-body { position: absolute; inset: 0; transform-style: preserve-3d; border-radius: ${u(48)}; background: ${frameColor(ctx)}; padding: ${u(12)}; box-shadow: 0 ${u(30)} ${u(70)} var(--mf-shadow), inset 0 0 0 ${u(3)} var(--mf-line); }
#ID .mf-d-screen { position: relative; width: 100%; height: 100%; border-radius: ${u(38)}; overflow: hidden; background: var(--mf-ground); }
${screen.css}`, `${turnScript(props, ctx, '.mf-d-body')}\n${stackScript(props, ctx)}`);
}

export function tablet(ctx: MoveCtx, props: DevicePlace = {}): Piece {
  const id = props.id ?? 'd-tablet';
  const screen = screenMarkup(ctx, props.screen ?? defaultScreen(), id);
  return place('tablet', ctx, props, html`<div class="mf-d-body"><div class="mf-d-screen">${screen.markup}</div></div>`, `#ID .mf-d-body { position: absolute; inset: 0; transform-style: preserve-3d; border-radius: ${u(40)}; background: ${frameColor(ctx)}; padding: ${u(20)}; box-shadow: 0 ${u(30)} ${u(70)} var(--mf-shadow), inset 0 0 0 ${u(3)} var(--mf-line); }
#ID .mf-d-screen { position: relative; width: 100%; height: 100%; border-radius: ${u(22)}; overflow: hidden; background: var(--mf-ground); }
${screen.css}`, `${turnScript(props, ctx, '.mf-d-body')}\n${stackScript(props, ctx)}`);
}

export function laptop(ctx: MoveCtx, props: DevicePlace = {}): Piece {
  const id = props.id ?? 'd-laptop';
  const screen = screenMarkup(ctx, props.screen ?? defaultScreen(), id);
  return place('laptop', ctx, props, html`<div class="mf-d-body"><div class="mf-d-lid"><div class="mf-d-screen">${screen.markup}</div></div><div class="mf-d-base"></div></div>`, `#ID .mf-d-body { position: absolute; inset: 0; transform-style: preserve-3d; }
#ID .mf-d-lid { position: absolute; left: 6%; right: 6%; top: 0; height: 88%; border-radius: ${u(22)} ${u(22)} ${u(6)} ${u(6)}; background: ${frameColor(ctx)}; padding: ${u(16)}; box-shadow: inset 0 0 0 ${u(3)} var(--mf-line); }
#ID .mf-d-screen { position: relative; width: 100%; height: 100%; border-radius: ${u(8)}; overflow: hidden; background: var(--mf-ground); }
#ID .mf-d-base { position: absolute; left: 0; right: 0; top: 88%; height: 5%; border-radius: ${u(4)} ${u(4)} ${u(30)} ${u(30)}; background: var(--mf-muted); box-shadow: 0 ${u(26)} ${u(60)} var(--mf-shadow); }
${screen.css}`, `${turnScript({ turnFromDeg: -8, turnToDeg: 6, ...props }, ctx, '.mf-d-body')}\n${stackScript(props, ctx)}`);
}

export function browser(ctx: MoveCtx, props: DevicePlace = {}): Piece {
  const id = props.id ?? 'd-browser';
  const screen = screenMarkup(ctx, props.screen ?? defaultScreen(), id);
  return place('browser', ctx, props, html`<div class="mf-d-body"><div class="mf-d-bar"><span></span><span></span><span></span><div class="mf-d-url"></div></div><div class="mf-d-screen">${screen.markup}</div></div>`, `#ID .mf-d-body { position: absolute; inset: 0; transform-style: preserve-3d; display: flex; flex-direction: column; border-radius: ${u(20)}; overflow: hidden; background: var(--mf-surface); border: 1px solid var(--mf-line); box-shadow: 0 ${u(30)} ${u(70)} var(--mf-shadow); }
#ID .mf-d-bar { flex: none; display: flex; align-items: center; gap: ${u(10)}; height: ${u(52)}; padding: 0 ${u(20)}; border-bottom: 1px solid var(--mf-line); }
#ID .mf-d-bar > span { width: ${u(14)}; height: ${u(14)}; border-radius: 50%; background: var(--mf-line); }
#ID .mf-d-url { flex: 1; height: ${u(26)}; margin-left: ${u(18)}; border-radius: ${u(13)}; background: var(--mf-line); }
#ID .mf-d-screen { position: relative; flex: 1; overflow: hidden; background: var(--mf-ground); }
${screen.css}`, `${turnScript({ turnFromDeg: -6, turnToDeg: 4, ...props }, ctx, '.mf-d-body')}\n${stackScript(props, ctx)}`);
}

/** The inline module that loads three before the page's load event and announces it. */
const THREE_LOADER = trusted(`<script type="module">
import * as THREE from './vendor/three/three.module.js';
window.mfThree = THREE;
window.dispatchEvent(new Event('mf-three'));
</script>`);

function device3dPiece(kind: 'laptop3d' | 'phone3d', ctx: MoveCtx, props: DevicePlace): Piece {
  const id = props.id ?? `d-${kind}`;
  if (props.screen?.kind === 'tree') throw new Error(`${kind}: a three.js screen takes an image or an image stack, not a kit sub-tree`);
  const screen = props.screen ? screenMarkup(ctx, props.screen, id) : { markup: trusted(''), css: '', images: [] };
  const width = props.widthU ?? DEFAULT_WIDTH[kind];
  const pxW = Math.round(width * ctx.u);
  const pxH = Math.round((width / RATIO[kind]) * ctx.u);
  const turnFrom = ((props.turnFromDeg ?? -24) * Math.PI) / 180;
  const turnTo = ((props.turnToDeg ?? 18) * Math.PI) / 180;
  const piece = place(
    kind,
    ctx,
    props,
    html`<canvas class="mf-d-gl" width="${pxW}" height="${pxH}" aria-hidden="true"></canvas><div class="mf-d-sources" aria-hidden="true">${screen.markup}</div>${THREE_LOADER}`,
    `#ID .mf-d-gl { position: absolute; inset: 0; width: 100%; height: 100%; }
#ID .mf-d-sources { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }`,
    `    const css = getComputedStyle(document.documentElement);
    const state = { t: 0 };
    let draw = null;
    const render = () => {
      if (!draw && window.mfThree) {
        draw = ${fn(device3d)}(window.mfThree, piece.querySelector('.mf-d-gl'), { kind: '${kind === 'laptop3d' ? 'laptop' : 'phone'}', body: css.getPropertyValue('--mf-muted').trim(), bezel: css.getPropertyValue('--mf-ink').trim(), screens: [...piece.querySelectorAll('.mf-d-shot')], stackFps: ${STACK_FPS}, turnFrom: ${turnFrom}, turnTo: ${turnTo}, durationSec: ${ctx.durationSec} });
      }
      if (draw) draw(state.t);
    };
    tl.to(state, { t: ${ctx.durationSec}, duration: ${ctx.durationSec}, ease: 'none', onUpdate: render }, 0);
    window.addEventListener('mf-three', () => { state.t = tl.time(); render(); });
    render();`,
  );
  return piece;
}

export const laptop3d = (ctx: MoveCtx, props: DevicePlace = {}) => device3dPiece('laptop3d', ctx, props);
export const phone3d = (ctx: MoveCtx, props: DevicePlace = {}) => device3dPiece('phone3d', ctx, props);

export const DEVICES: Record<DeviceId, (ctx: MoveCtx, props?: DevicePlace) => Piece> = { phone, laptop, browser, tablet, laptop3d, phone3d };

/** Whether a device needs three.js in the build (the adapter then copies it). */
export const needsThree = (kind: DeviceId) => kind === 'laptop3d' || kind === 'phone3d';

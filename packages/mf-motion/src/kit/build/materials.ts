// Materials and grounds (component-kit.md, MFM-025): flat, radial light, dot
// grid, line grid, paper, grain, vignette, glass pane, halftone, ribbon field
// and riso texture. Each builder is a pure function of (props, ctx) returning
// markup, CSS and a timeline script; sizes are in u, colours only from tokens.
// Canvas materials inline their runtime function (src/kit/runtime/materials.ts)
// and draw from mf.rand / mf.noise2 with the context seed, so a seed always
// gives the same frame.
import { type TrustedHtml, html, trusted } from './html';
import type { MoveCtx } from './move';
import { drawPaper, drawRibbons, drawRiso, paintGrain } from '../runtime/materials';

export interface Piece {
  html: TrustedHtml;
  css: string;
  /** Statements for the move script (tl, vars, ctx and root are in scope). */
  script: string;
}

export const MATERIAL_IDS = ['flat', 'radial', 'dots', 'lines', 'paper', 'grain', 'vignette', 'glass', 'halftone', 'ribbons', 'riso'] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

/** The numbers of the Materials row. */
export const MATERIAL = {
  grainOpacity: { min: 0.035, max: 0.05, default: 0.04 },
  vignette: 0.22,
  glass: { fillTop: 0.16, fillBottom: 0.04, rim: 0.45, hairline: 0.12, blurU: 22 },
  risoFps: 12,
  grainTilePx: 128,
} as const;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;
/** A token colour with transparency, without literal colour values. */
const mix = (token: string, percent: number) => `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;
const pct = (fraction: number) => Math.round(fraction * 1000) / 10;

/** Seed of one piece: the context seed mixed with the piece id, so pieces never share noise. */
export function pieceSeed(ctx: Pick<MoveCtx, 'seed'>, id: string): number {
  let h = ctx.seed >>> 0;
  for (const char of id) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

const layer = (id: string, className: string) => html`<div class="mf-mat ${className}" id="${id}" aria-hidden="true" data-mf-bleed></div>`;
const BASE = '.mf-mat { position: absolute; inset: 0; pointer-events: none; }';

export function flat(_ctx: MoveCtx, props: { id?: string; tone?: 'ground' | 'surface' } = {}): Piece {
  const id = props.id ?? 'mat-flat';
  return { html: layer(id, 'mf-mat-flat'), css: `${BASE}\n#${id} { background: var(--mf-${props.tone ?? 'ground'}); }`, script: '' };
}

export function radial(_ctx: MoveCtx, props: { id?: string; x?: number; y?: number; reach?: number } = {}): Piece {
  const id = props.id ?? 'mat-radial';
  const at = `${pct(props.x ?? 0.5)}% ${pct(props.y ?? 0.35)}%`;
  return {
    html: layer(id, 'mf-mat-radial'),
    css: `${BASE}\n#${id} { background: radial-gradient(circle at ${at}, var(--mf-surface) 0%, var(--mf-accent-soft) ${pct((props.reach ?? 0.7) * 0.4)}%, var(--mf-ground) ${pct(props.reach ?? 0.7)}%); }`,
    script: '',
  };
}

export function dots(_ctx: MoveCtx, props: { id?: string; spacingU?: number; dotU?: number } = {}): Piece {
  const id = props.id ?? 'mat-dots';
  const spacing = props.spacingU ?? 36;
  const dot = props.dotU ?? 2.5;
  return {
    html: layer(id, 'mf-mat-dots'),
    css: `${BASE}\n#${id} { background-color: var(--mf-ground); background-image: radial-gradient(circle, var(--mf-line) ${u(dot)}, transparent calc(${u(dot)} + 1px)); background-size: ${u(spacing)} ${u(spacing)}; background-position: center; }`,
    script: '',
  };
}

export function lines(_ctx: MoveCtx, props: { id?: string; spacingU?: number } = {}): Piece {
  const id = props.id ?? 'mat-lines';
  const spacing = props.spacingU ?? 72;
  return {
    html: layer(id, 'mf-mat-lines'),
    css: `${BASE}\n#${id} { background-color: var(--mf-ground); background-image: linear-gradient(to right, var(--mf-line) 1px, transparent 1px), linear-gradient(to bottom, var(--mf-line) 1px, transparent 1px); background-size: ${u(spacing)} ${u(spacing)}; background-position: center; }`,
    script: '',
  };
}

/** Canvas size for procedural layers: half the frame, scaled up by CSS. */
const canvasSize = (ctx: MoveCtx) => ({ width: Math.round(ctx.width / 2), height: Math.round(ctx.height / 2) });

export function paper(ctx: MoveCtx, props: { id?: string } = {}): Piece {
  const id = props.id ?? 'mat-paper';
  const size = canvasSize(ctx);
  return {
    html: html`<canvas class="mf-mat mf-mat-paper" id="${id}" width="${size.width}" height="${size.height}" aria-hidden="true" data-mf-bleed></canvas>`,
    css: `${BASE}\n#${id} { width: 100%; height: 100%; }`,
    script: `{
    const css = getComputedStyle(document.documentElement);
    (${drawPaper.toString()})(root.querySelector('#${id}'), mf.noise2(${pieceSeed(ctx, id)}), mf.rand(${pieceSeed(ctx, `${id}:fibre`)}), css.getPropertyValue('--mf-ground').trim(), css.getPropertyValue('--mf-ink').trim());
  }`,
  };
}

export function grain(ctx: MoveCtx, props: { id?: string; opacity?: number } = {}): Piece {
  const id = props.id ?? 'mat-grain';
  const range = MATERIAL.grainOpacity;
  const opacity = Math.min(range.max, Math.max(range.min, props.opacity ?? range.default));
  return {
    html: layer(id, 'mf-mat-grain'),
    css: `${BASE}\n#${id} { opacity: ${opacity}; mix-blend-mode: overlay; background-repeat: repeat; background-size: ${u(MATERIAL.grainTilePx)} ${u(MATERIAL.grainTilePx)}; }`,
    script: `(${paintGrain.toString()})(root.querySelector('#${id}'), mf.rand(${pieceSeed(ctx, id)}), ${MATERIAL.grainTilePx});`,
  };
}

export function vignette(_ctx: MoveCtx, props: { id?: string } = {}): Piece {
  const id = props.id ?? 'mat-vignette';
  return {
    html: layer(id, 'mf-mat-vignette'),
    css: `${BASE}\n#${id} { background: radial-gradient(ellipse at center, transparent 52%, color-mix(in srgb, black ${pct(MATERIAL.vignette)}%, transparent) 100%); }`,
    script: '',
  };
}

/** A frosted pane inside the copy box: position and size in u from the box's top left. */
export function glass(_ctx: MoveCtx, props: { id?: string; xU?: number; yU?: number; widthU?: number; heightU?: number; radiusU?: number } = {}): Piece {
  const id = props.id ?? 'mat-glass';
  const g = MATERIAL.glass;
  return {
    html: html`<div class="mf-glass" id="${id}" aria-hidden="true"></div>`,
    css: `#${id} {
  position: absolute;
  left: calc(var(--mf-safe-l) + ${u(props.xU ?? 0)});
  top: calc(var(--mf-safe-t) + ${u(props.yU ?? 0)});
  width: ${u(props.widthU ?? 640)};
  height: ${u(props.heightU ?? 360)};
  border-radius: ${u(props.radiusU ?? 28)};
  background: linear-gradient(to bottom, color-mix(in srgb, white ${pct(g.fillTop)}%, transparent), color-mix(in srgb, white ${pct(g.fillBottom)}%, transparent));
  border: 1px solid ${mix('--mf-ink', pct(g.hairline))};
  box-shadow: inset 0 1px 0 0 color-mix(in srgb, white ${pct(g.rim)}%, transparent), 0 ${u(24)} ${u(64)} var(--mf-shadow);
  backdrop-filter: blur(${u(g.blurU)});
}`,
    script: '',
  };
}

export function halftone(_ctx: MoveCtx, props: { id?: string; spacingU?: number; angleDeg?: number } = {}): Piece {
  const id = props.id ?? 'mat-halftone';
  const spacing = props.spacingU ?? 18;
  return {
    html: layer(id, 'mf-mat-halftone'),
    css: `${BASE}\n#${id} { background-image: radial-gradient(circle, var(--mf-accent-soft) 32%, transparent 34%); background-size: ${u(spacing)} ${u(spacing)}; transform: rotate(${props.angleDeg ?? 15}deg) scale(1.5); mask-image: linear-gradient(${(props.angleDeg ?? 15) + 90}deg, black 0%, transparent 75%); -webkit-mask-image: linear-gradient(${(props.angleDeg ?? 15) + 90}deg, black 0%, transparent 75%); }`,
    script: '',
  };
}

/**
 * Ribbon field: `intensity` starts at props.intensity; the timeline drives it
 * through `#<id>.intensity` keys (seconds from 0 and a 0-1 value).
 */
export function ribbons(ctx: MoveCtx, props: { id?: string; intensity?: number; keys?: Array<{ at: number; intensity: number; duration?: number }> } = {}): Piece {
  const id = props.id ?? 'mat-ribbons';
  const size = canvasSize(ctx);
  const keys = (props.keys ?? []).map((key) => `    tl.to(state, { intensity: ${key.intensity}, duration: ${key.duration ?? 0.8}, ease: 'power2.inOut', onUpdate: draw }, ${key.at});`).join('\n');
  return {
    html: html`<canvas class="mf-mat mf-mat-ribbons" id="${id}" width="${size.width}" height="${size.height}" aria-hidden="true" data-mf-bleed></canvas>`,
    css: `${BASE}\n#${id} { width: 100%; height: 100%; }`,
    script: `{
    const canvas = root.querySelector('#${id}');
    const css = getComputedStyle(document.documentElement);
    const colors = ['--mf-surface', '--mf-accent', '--mf-accent-soft'].map((name) => css.getPropertyValue(name).trim());
    const state = { t: 0, intensity: ${props.intensity ?? 0.5} };
    const draw = () => (${drawRibbons.toString()})(canvas, mf.rand(${pieceSeed(ctx, id)}), state.t, state.intensity, colors);
    tl.to(state, { t: ctx.durationSec, duration: ctx.durationSec, ease: 'none', onUpdate: draw }, 0);
${keys}
    draw();
  }`,
  };
}

/** Whether the brand ground is dark (relative luminance under 0.18). */
function groundIsDark(ctx: MoveCtx): boolean {
  const hex = ctx.brand.colors.ground.replace('#', '');
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) < 0.18;
}

export function riso(ctx: MoveCtx, props: { id?: string } = {}): Piece {
  const id = props.id ?? 'mat-riso';
  const size = canvasSize(ctx);
  return {
    html: html`<canvas class="mf-mat mf-mat-riso" id="${id}" width="${size.width}" height="${size.height}" aria-hidden="true" data-mf-bleed></canvas>`,
    // Ink presses into a light ground and glows out of a dark one.
    css: `${BASE}\n#${id} { width: 100%; height: 100%; mix-blend-mode: ${groundIsDark(ctx) ? 'screen' : 'multiply'}; }`,
    script: `{
    const canvas = root.querySelector('#${id}');
    const color = getComputedStyle(document.documentElement).getPropertyValue('--mf-accent').trim();
    const state = { t: 0 };
    let last = -1;
    const draw = () => {
      const step = Math.floor(state.t * ${MATERIAL.risoFps} + 1e-6);
      if (step === last) return;
      last = step;
      (${drawRiso.toString()})(canvas, mf.rand(${pieceSeed(ctx, id)}), step, color);
    };
    tl.to(state, { t: ctx.durationSec, duration: ctx.durationSec, ease: 'none', onUpdate: draw }, 0);
    draw();
  }`,
  };
}

export const MATERIALS: Record<MaterialId, (ctx: MoveCtx, props?: Record<string, unknown>) => Piece> = {
  flat, radial, dots, lines, paper, grain, vignette, glass, halftone, ribbons, riso,
};

/** Several pieces as one: markup in order (later pieces on top), CSS and scripts joined. */
export function stack(pieces: Piece[]): Piece {
  return { html: trusted(pieces.map((piece) => piece.html.value).join('\n')), css: [...new Set(pieces.map((piece) => piece.css))].join('\n'), script: pieces.map((piece) => piece.script).filter(Boolean).join('\n') };
}

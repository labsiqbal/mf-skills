// Cards and UI surfaces (component-kit.md, MFM-026): card, chip, button with
// press state, notification banner, chat bubble, list row with checkbox, input
// bar with caret, toast, avatar, badge, tab bar and progress bar. Builders are
// pure functions of (props, ctx); text is static UI copy marked
// data-mf-static; sizes in u, colours only from tokens. Every surface sits in
// the copy box (offset in u from its top left), enters at `at` and may leave
// at `out`; animated states run through src/kit/runtime/surfaces.ts.
import { type TrustedHtml, html, trusted } from './html';
import type { Piece } from './materials';
import type { MoveCtx } from './move';
import { contrastRatio, parseHex } from '../oklch';
import { blink, fill, press, tick } from '../runtime/surfaces';

export const SURFACE_IDS = ['card', 'chip', 'button', 'banner', 'bubble', 'row', 'input', 'toast', 'avatar', 'badge', 'tabs', 'progress'] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

export interface Place {
  id?: string;
  /** Offset from the copy box's top left, in u. */
  xU?: number;
  yU?: number;
  /** Entrance time (s). */
  at?: number;
  /** Exit time (s), or none. */
  out?: number | null;
}

const u = (n: number) => `calc(var(--mf-u) * ${n})`;
const mix = (token: string, percent: number) => `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;
const fn = (f: (...args: never[]) => void) => `(${f.toString()})`;

/**
 * The token that reads best on the accent fill: ground, surface or ink,
 * whichever contrasts most with the accent (a CSS variable reference).
 */
export function onAccent(ctx: Pick<MoveCtx, 'brand'>): string {
  const accent = parseHex(ctx.brand.colors.accent);
  const options: Array<[string, string]> = [['--mf-ground', ctx.brand.colors.ground], ['--mf-surface', ctx.brand.colors.surface], ['--mf-ink', ctx.brand.colors.ink]];
  const best = options.map(([name, hex]) => [name, contrastRatio(accent, parseHex(hex))] as const).sort((a, b) => b[1] - a[1])[0];
  return `var(${best?.[0] ?? '--mf-ground'})`;
}

/** Shared CSS: the surface frame, static text roles and the on-accent colour. */
function baseCss(ctx: MoveCtx): string {
  return `.mf-surface { position: absolute; box-sizing: border-box; font-family: var(--mf-font-body); color: var(--mf-ink); --mf-on-accent: ${onAccent(ctx)}; }
.mf-surface [data-mf-static] { display: block; white-space: nowrap; }
.mf-s-title { font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(34)}; line-height: 1.2; }
.mf-s-body { font-size: ${u(26)}; line-height: 1.35; color: var(--mf-muted); }
.mf-s-label { font-size: ${u(24)}; font-weight: 600; line-height: 1.2; }`;
}

function place(ctx: MoveCtx, kind: SurfaceId, props: Place, inner: TrustedHtml, css: string, script = ''): Piece {
  const id = props.id ?? `s-${kind}`;
  const at = props.at ?? 0.2;
  const enter = `tl.fromTo('#${id}', { opacity: 0, y: 24 * ctx.u }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, ${at});`;
  const leave = props.out === null || props.out === undefined ? '' : `\n    tl.to('#${id}', { opacity: 0, y: -12 * ctx.u, duration: 0.35, ease: 'power2.in' }, ${props.out});`;
  return {
    html: html`<div class="mf-surface mf-s-${kind}" id="${id}" data-mf-piece="${kind}">${inner}</div>`,
    css: `${baseCss(ctx)}\n#${id} { left: calc(var(--mf-safe-l) + ${u(props.xU ?? 0)}); top: calc(var(--mf-safe-t) + ${u(props.yU ?? 0)}); }\n${css.replaceAll('#ID', `#${id}`)}`,
    script: `{\n    const piece = root.querySelector('#${id}');\n    ${enter}${leave}\n${script}\n  }`,
  };
}

const text = (className: string, value: string) => html`<span class="${className}" data-mf-static>${value}</span>`;

export function card(ctx: MoveCtx, props: Place & { title?: string; body?: string; widthU?: number } = {}): Piece {
  return place(ctx, 'card', props, html`${text('mf-s-title', props.title ?? 'Run #4821')}${text('mf-s-body', props.body ?? '14 spans, 3.2 s, $0.031')}`, `#ID { width: ${u(props.widthU ?? 560)}; padding: ${u(32)} ${u(36)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); box-shadow: 0 ${u(18)} ${u(48)} var(--mf-shadow); display: flex; flex-direction: column; gap: ${u(10)}; }`);
}

export function chip(ctx: MoveCtx, props: Place & { label?: string } = {}): Piece {
  return place(ctx, 'chip', props, html`<span class="mf-s-dot"></span>${text('mf-s-label', props.label ?? 'Passing')}`, `#ID { display: inline-flex; align-items: center; gap: ${u(12)}; padding: ${u(12)} ${u(22)}; background: var(--mf-accent-soft); border-radius: ${u(999)}; }
#ID .mf-s-dot { width: ${u(14)}; height: ${u(14)}; border-radius: 50%; background: var(--mf-accent); }`);
}

export function button(ctx: MoveCtx, props: Place & { label?: string; pressAt?: number | null } = {}): Piece {
  const pressAt = props.pressAt === undefined ? (props.at ?? 0.2) + 0.9 : props.pressAt;
  return place(
    ctx,
    'button',
    props,
    html`<span class="mf-s-press">${text('mf-s-label', props.label ?? 'Start tracing')}</span>`,
    `#ID .mf-s-press { display: inline-flex; align-items: center; justify-content: center; padding: ${u(22)} ${u(40)}; background: var(--mf-accent); color: var(--mf-on-accent); border-radius: var(--mf-radius); box-shadow: 0 ${u(10)} ${u(28)} var(--mf-shadow); }`,
    pressAt === null ? '' : `    ${fn(press)}(tl, piece.querySelector('.mf-s-press'), ${pressAt});`,
  );
}

export function banner(ctx: MoveCtx, props: Place & { app?: string; title?: string; body?: string } = {}): Piece {
  return place(
    ctx,
    'banner',
    props,
    html`<span class="mf-s-icon"></span><span class="mf-s-copy">${text('mf-s-app', props.app ?? 'Tessarine')}${text('mf-s-title', props.title ?? 'Eval suite passed')}${text('mf-s-body', props.body ?? 'refund-policy, 96.4%')}</span>`,
    `#ID { width: ${u(640)}; display: flex; gap: ${u(22)}; align-items: flex-start; padding: ${u(24)} ${u(28)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: ${u(28)}; box-shadow: 0 ${u(20)} ${u(52)} var(--mf-shadow); }
#ID .mf-s-icon { flex: none; width: ${u(64)}; height: ${u(64)}; border-radius: ${u(16)}; background: var(--mf-accent); }
#ID .mf-s-copy { display: flex; flex-direction: column; gap: ${u(4)}; }
#ID .mf-s-app { font-size: ${u(22)}; font-weight: 600; color: var(--mf-muted); letter-spacing: 0.02em; }`,
  );
}

export function bubble(ctx: MoveCtx, props: Place & { text?: string; side?: 'sent' | 'received' } = {}): Piece {
  const sent = (props.side ?? 'received') === 'sent';
  return place(
    ctx,
    'bubble',
    props,
    html`${text('mf-s-msg', props.text ?? 'Why did run 4822 fail?')}`,
    `#ID { max-width: ${u(560)}; padding: ${u(20)} ${u(28)}; font-size: ${u(28)}; line-height: 1.35; border-radius: ${u(30)}; ${sent ? `background: var(--mf-accent); color: var(--mf-on-accent); border-bottom-right-radius: ${u(8)};` : `background: var(--mf-surface); color: var(--mf-ink); border: 1px solid var(--mf-line); border-bottom-left-radius: ${u(8)};`} }
#ID .mf-s-msg { white-space: normal; }`,
  );
}

export function row(ctx: MoveCtx, props: Place & { label?: string; tickAt?: number | null } = {}): Piece {
  const tickAt = props.tickAt === undefined ? (props.at ?? 0.2) + 0.8 : props.tickAt;
  return place(
    ctx,
    'row',
    props,
    html`<span class="mf-s-box"><span class="mf-s-mark"></span></span>${text('mf-s-label', props.label ?? 'Trace 50 production runs')}`,
    `#ID { width: ${u(600)}; display: flex; align-items: center; gap: ${u(22)}; padding: ${u(22)} ${u(26)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); }
#ID .mf-s-box { flex: none; position: relative; width: ${u(40)}; height: ${u(40)}; border-radius: ${u(10)}; border: ${u(3)} solid var(--mf-accent); }
#ID .mf-s-mark { position: absolute; inset: ${u(-3)}; border-radius: ${u(10)}; background: var(--mf-accent); }
#ID .mf-s-mark::after { content: ''; position: absolute; left: 34%; top: 14%; width: 26%; height: 50%; border-right: ${u(5)} solid var(--mf-on-accent); border-bottom: ${u(5)} solid var(--mf-on-accent); transform: rotate(45deg); }`,
    tickAt === null ? '' : `    ${fn(tick)}(tl, piece.querySelector('.mf-s-box'), piece.querySelector('.mf-s-mark'), ${tickAt});`,
  );
}

export function input(ctx: MoveCtx, props: Place & { value?: string; blinkUntil?: number } = {}): Piece {
  return place(
    ctx,
    'input',
    props,
    html`${text('mf-s-value', props.value ?? 'Show runs over 5 cents')}<span class="mf-s-caret"></span>`,
    `#ID { width: ${u(640)}; display: flex; align-items: center; padding: ${u(22)} ${u(28)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: ${u(999)}; font-size: ${u(28)}; }
#ID .mf-s-caret { flex: none; width: ${u(3)}; height: ${u(34)}; margin-left: ${u(4)}; background: var(--mf-accent); }`,
    `    ${fn(blink)}(tl, piece.querySelector('.mf-s-caret'), ${props.at ?? 0.2}, ${props.blinkUntil ?? ctx.durationSec});`,
  );
}

export function toast(ctx: MoveCtx, props: Place & { text?: string } = {}): Piece {
  return place(ctx, 'toast', props, html`<span class="mf-s-tick"></span>${text('mf-s-label', props.text ?? 'Saved to eval set')}`, `#ID { display: inline-flex; align-items: center; gap: ${u(16)}; padding: ${u(18)} ${u(28)}; background: var(--mf-ink); color: var(--mf-ground); border-radius: ${u(18)}; box-shadow: 0 ${u(16)} ${u(40)} var(--mf-shadow); }
#ID .mf-s-tick { width: ${u(16)}; height: ${u(16)}; border-radius: 50%; background: var(--mf-accent2); }`);
}

export function avatar(ctx: MoveCtx, props: Place & { initials?: string; image?: string | null; sizeU?: number } = {}): Piece {
  const inner = props.image ? html`<img class="mf-s-photo" src="${props.image}" alt="">` : text('mf-s-initials', (props.initials ?? 'MR').slice(0, 2).toUpperCase());
  return place(ctx, 'avatar', props, inner, `#ID { width: ${u(props.sizeU ?? 112)}; height: ${u(props.sizeU ?? 112)}; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--mf-accent); color: var(--mf-on-accent); }
#ID .mf-s-initials { font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u((props.sizeU ?? 112) * 0.38)}; }
#ID .mf-s-photo { width: 100%; height: 100%; object-fit: cover; }`);
}

export function badge(ctx: MoveCtx, props: Place & { count?: number | string } = {}): Piece {
  return place(ctx, 'badge', props, text('mf-s-count', String(props.count ?? 3)), `#ID { min-width: ${u(48)}; height: ${u(48)}; padding: 0 ${u(14)}; border-radius: ${u(24)}; display: flex; align-items: center; justify-content: center; background: var(--mf-accent); color: var(--mf-on-accent); font-weight: 700; font-size: ${u(26)}; }`);
}

export function tabs(ctx: MoveCtx, props: Place & { labels?: string[]; active?: number } = {}): Piece {
  const labels = props.labels ?? ['Runs', 'Traces', 'Evals', 'Cost'];
  const active = props.active ?? 1;
  const items = trusted(labels.map((label, i) => html`<span class="mf-s-tab${i === active ? ' is-on' : ''}">${text('mf-s-label', label)}</span>`.value).join(''));
  return place(ctx, 'tabs', props, items, `#ID { display: flex; gap: ${u(8)}; padding: ${u(8)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: ${u(22)}; }
#ID .mf-s-tab { padding: ${u(14)} ${u(26)}; border-radius: ${u(16)}; color: var(--mf-muted); }
#ID .mf-s-tab.is-on { background: ${mix('--mf-accent', 16)}; color: var(--mf-ink); }`);
}

export function progress(ctx: MoveCtx, props: Place & { label?: string; value?: number; fillAt?: number; fillSec?: number } = {}): Piece {
  const value = props.value ?? 0.72;
  return place(
    ctx,
    'progress',
    props,
    html`${text('mf-s-label', props.label ?? 'Budget used')}<span class="mf-s-track"><span class="mf-s-fill"></span></span>`,
    `#ID { width: ${u(600)}; display: flex; flex-direction: column; gap: ${u(16)}; }
#ID .mf-s-track { display: block; height: ${u(18)}; border-radius: ${u(9)}; background: var(--mf-line); overflow: hidden; }
#ID .mf-s-fill { display: block; height: 100%; width: 100%; border-radius: ${u(9)}; background: var(--mf-accent); }`,
    `    ${fn(fill)}(tl, piece.querySelector('.mf-s-fill'), ${value}, ${props.fillAt ?? (props.at ?? 0.2) + 0.4}, ${props.fillSec ?? 1.2});`,
  );
}

export const SURFACES: Record<SurfaceId, (ctx: MoveCtx, props?: Place) => Piece> = {
  card, chip, button, banner, bubble, row, input, toast, avatar, badge, tabs, progress,
};

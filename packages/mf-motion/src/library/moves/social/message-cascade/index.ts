// message-cascade (social-01): a received message, a typing indicator, the sent
// reply, another typing indicator and the last received message, each bubble
// landing in turn. Overlays stack the thread beside the face band (a column at
// the left in 16:9 and 1:1, the strip above it in 9:16) and leave in the last
// 0.45 s; the b-roll centres a chat with a header band and a seeded drift.
import type { MoveModule, ResolvedVars } from '../../../contract';
import { type TrustedHtml, html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { avatar, bubble, onAccent } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;
const MARK = 'mc-text-slot';

/** Seconds of the cascade: each bubble lands, then a typing indicator holds before the next. */
export const TIMES = {
  first: 0.1,
  typing1: [0.75, 1.3],
  reply: 1.3,
  typing2: [2.0, 2.55],
  last: 2.55,
  /** Overlays leave this long before the end (overlay.exitWindowSec max). */
  exitBefore: 0.45,
} as const;

/** A kit bubble whose message is an mf-line (rule 3) instead of static text. */
function messageBubble(ctx: MoveCtx, id: string, side: 'sent' | 'received', at: number, out: number | null, message: TrustedHtml) {
  const piece = bubble(ctx, { id, side, at, out, text: MARK });
  const slot = `<span class="mf-s-msg" data-mf-static>${MARK}</span>`;
  if (!piece.html.value.includes(slot)) throw new Error('message-cascade: the kit bubble markup changed');
  return { ...piece, html: trusted(piece.html.value.replace(slot, message.value)) };
}

/** Three dots that bounce while someone types: in at `from`, out at `to`. */
function typing(id: string, side: 'sent' | 'received', from: number, to: number) {
  const cycle = 0.36;
  // An even number of half-cycles brings every dot back to rest.
  const repeats = Math.max(1, Math.floor((to - from - 0.3) / (cycle / 2)) - 1) | 1;
  return {
    html: html`<div class="mc-typing mc-${side}" id="${id}" aria-hidden="true"><span class="mc-dot"></span><span class="mc-dot"></span><span class="mc-dot"></span></div>`,
    script: `tl.fromTo('#${id}', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, ${from});
  tl.to('#${id} .mc-dot', { y: -7 * ctx.u, duration: ${cycle / 2}, ease: 'sine.inOut', yoyo: true, repeat: ${repeats}, stagger: 0.09 }, ${from + 0.1});
  tl.to('#${id}', { opacity: 0, scale: 0.8, duration: 0.15, ease: 'power3.in' }, ${to - 0.15});`,
  };
}

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const end = ctx.durationSec;
  const overlay = ctx.mode !== 'full';
  const out = overlay ? end - TIMES.exitBefore : null;
  const exit = out === null ? 'end' : `up@${out.toFixed(2)}`;
  const msg = (name: 'first' | 'reply' | 'last', at: number) => line({ text: String(v[name]), role: 'body', in: `rise@${at}`, out: exit, className: 'mf-s-msg', variable: name });

  const b1 = messageBubble(ctx, 'mc-first', 'received', TIMES.first, out, msg('first', TIMES.first));
  const b2 = messageBubble(ctx, 'mc-reply', 'sent', TIMES.reply, out, msg('reply', TIMES.reply));
  const b3 = messageBubble(ctx, 'mc-last', 'received', TIMES.last, out, msg('last', TIMES.last));
  const t1 = typing('mc-typing-1', 'sent', TIMES.typing1[0], TIMES.typing1[1]);
  const t2 = typing('mc-typing-2', 'received', TIMES.typing2[0], TIMES.typing2[1]);
  const head = avatar(ctx, { id: 'mc-avatar', initials: String(v.contact).trim().slice(0, 1) || 'A', sizeU: 84, at: 0, out: null });

  const slot = (side: 'sent' | 'received', piece: { html: TrustedHtml }, extra: TrustedHtml | '' = '') => html`<div class="mc-slot mc-${side}">${extra}${piece.html}</div>`;
  const chat = html`<div class="mc-chat" id="mc-chat"><div class="mc-head">${head.html}<span class="mc-name" data-mf-static>${String(v.contact)}</span></div><div class="mc-thread" id="mc-thread">${slot('received', b1)}${slot('sent', b2, t1.html)}${slot('received', b3, t2.html)}</div></div>`;
  const stage = html`<div class="mc-stage">${chat}</div>`;
  const cam = overlay ? null : camera(ctx, stage, { id: 'mc-camera', moves: [{ kind: 'drift', from: 0, to: end }] });

  const ink = onAccent(ctx);
  const css = `
.mc-stage { position: absolute; inset: 0; }
.mc-chat { position: absolute; display: flex; flex-direction: column; }
.mc-head { display: none; }
#mc-thread { display: flex; flex-direction: column; gap: ${u(8)}; }
#mc-thread .mc-slot { position: relative; display: flex; }
#mc-thread .mc-slot.mc-sent { justify-content: flex-end; }
#mc-thread .mf-s-bubble { position: relative; left: auto; top: auto; max-width: 100%; padding: ${u(12)} ${u(20)}; font-size: ${u(30)}; line-height: 1.3; overflow: hidden; }
#mc-thread .mf-s-msg { display: block; overflow-wrap: anywhere; }
.mc-typing { position: absolute; top: 0; display: flex; align-items: center; gap: ${u(9)}; height: ${u(63)}; padding: 0 ${u(22)}; box-sizing: border-box; border-radius: ${u(30)}; background: var(--mf-surface); border: 1px solid var(--mf-line); }
.mc-typing.mc-received { left: 0; border-bottom-left-radius: ${u(8)}; }
.mc-typing.mc-sent { right: 0; background: var(--mf-accent); border-color: var(--mf-accent); border-bottom-right-radius: ${u(8)}; }
.mc-dot { width: ${u(12)}; height: ${u(12)}; border-radius: 50%; background: var(--mf-muted); }
.mc-typing.mc-sent .mc-dot { background: ${ink}; }
/* Overlays: beside the face band, lifted clear of the caption band by more than a bubble's entrance travel. */
.is-landscape .mc-chat { left: 0; bottom: ${u(32)}; width: ${u(440)}; }
.is-square .mc-chat { left: 0; bottom: ${u(32)}; width: ${u(190)}; }
.is-portrait .mc-chat { left: 0; right: 0; top: 0; }
/* 9:16 has 212 px above the face band: three compact bubbles, with room for the last one's entrance travel. */
.is-portrait #mc-thread { gap: ${u(6)}; }
.is-portrait #mc-thread .mf-s-bubble { padding: ${u(8)} ${u(18)}; line-height: 1.25; }
.is-portrait .mc-typing { height: ${u(55)}; }
/* B-roll: a centred chat with a header band, larger type; it stays narrower than the copy box by more than the drift. */
#mf-root.is-full .mc-stage { display: flex; align-items: center; justify-content: center; }
#mf-root.is-full .mc-chat { position: relative; left: auto; right: auto; top: auto; bottom: auto; width: ${u(860)}; max-width: calc(100% - ${u(32)}); background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); overflow: hidden; }
#mf-root.is-full.is-square .mc-chat { width: ${u(760)}; }
#mf-root.is-full .mc-head { display: flex; align-items: center; gap: ${u(20)}; padding: ${u(22)} ${u(30)}; background: var(--mf-accent); color: ${ink}; }
#mf-root.is-full .mc-head .mf-s-avatar { position: relative; left: auto; top: auto; background: var(--mf-surface); color: var(--mf-ink); }
#mf-root.is-full .mc-name { font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(36)}; white-space: nowrap; }
#mf-root.is-full #mc-thread { gap: ${u(14)}; padding: ${u(30)}; background: var(--mf-ground); }
#mf-root.is-full #mc-thread .mf-s-bubble { padding: ${u(18)} ${u(28)}; font-size: ${u(40)}; }
#mf-root.is-full .mc-typing { height: ${u(88)}; padding: 0 ${u(30)}; gap: ${u(12)}; }
#mf-root.is-full .mc-dot { width: ${u(16)}; height: ${u(16)}; }
`;
  const pieces = [head, b1, b2, b3];
  return {
    id: meta.id,
    html: cam ? cam.html : stage,
    css: [css, ...pieces.map((piece) => piece.css), cam?.css ?? ''].join('\n'),
    script: [...pieces.map((piece) => piece.script), t1.script, t2.script, cam?.script ?? ''].join('\n  '),
    assets: [],
    needsThree: false,
    holds: meta.holds.map((hold) => ({ from: hold.from * end, to: hold.to * end })),
  };
}

export default { meta, vars, build } satisfies MoveModule;

// follower-milestone (creator-01): a creator card counts its followers up to a
// milestone; the number stamps, a ring of rays bursts around it, and a chip
// lands. Overlays sit beside the face band (left column in 16:9 and 1:1, two
// rows in the strip above it in 9:16) and leave in the last 0.45 s; the b-roll centres the
// card under an accent band and drifts.
import type { MoveModule, ResolvedVars } from '../../../contract';
import { counter } from '../../../../kit/build/charts';
import { html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { avatar, chip, onAccent } from '../../../../kit/build/surfaces';
import { ENTRANCE } from '../../../../kit/runtime/spec';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export const TIMES = {
  card: 0.1,
  count: 0.35,
  /** The count lands (and stamps) after ENTRANCE.count.countSec. */
  get stamp() {
    return this.count + ENTRANCE.count.countSec;
  },
  badge: 1.7,
  exitBefore: 0.45,
} as const;

const RAYS = 12;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const end = ctx.durationSec;
  const overlay = ctx.mode !== 'full';
  const out = overlay ? end - TIMES.exitBefore : null;
  const from = Math.min(Number(v.from), Number(v.value));

  // The kit counter's line stays to the end; an overlay's line leaves with the card.
  const count = counter(ctx, { id: 'fm-count', value: Number(v.value), from, label: String(v.label), at: TIMES.count, out: null });
  const exitCue = out === null ? 'end' : `up@${out.toFixed(2)}`;
  if (!count.html.value.includes('data-mf-out="end"')) throw new Error('follower-milestone: the kit counter markup changed');
  const countHtml = trusted(count.html.value.replace('data-mf-out="end"', `data-mf-out="${exitCue}"`));
  const badge = chip(ctx, { id: 'fm-badge', label: String(v.badge), at: TIMES.badge, out });
  const face = avatar(ctx, { id: 'fm-avatar', initials: String(v.handle).replace(/^@/, '').trim().slice(0, 1) || 'A', sizeU: 84, at: TIMES.card, out });

  const rays = Array.from({ length: RAYS }, (_, i) => html`<span class="fm-arm fm-arm-${i}"><span class="fm-ray"></span></span>`);
  const card = html`<div class="fm-card" id="fm-card"><div class="fm-band" aria-hidden="true"></div><div class="fm-who">${face.html}<span class="fm-handle" data-mf-static>${String(v.handle)}</span></div><div class="fm-hero"><div class="fm-burst" id="fm-burst" aria-hidden="true">${rays}</div>${countHtml}</div><div class="fm-badge-row">${badge.html}</div></div>`;
  const stage = html`<div class="fm-stage">${card}</div>`;
  const cam = overlay ? null : camera(ctx, stage, { id: 'fm-camera', moves: [{ kind: 'drift', from: 0, to: end }] });
  const ink = onAccent(ctx);
  // Overlay-only layouts; the b-roll rules below hold for every aspect.
  const O = ':is(.is-alpha, .is-key)';

  const css = `
${count.css}
${badge.css}
${face.css}
.fm-stage { position: absolute; inset: 0; }
.fm-card { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; gap: ${u(14)}; padding: ${u(24)} ${u(28)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); overflow: hidden; }
.fm-band { display: none; }
.fm-who { display: flex; align-items: center; gap: ${u(16)}; min-width: 0; }
#fm-card .mf-s-avatar { position: relative; left: auto; top: auto; flex: none; width: ${u(64)}; height: ${u(64)}; }
#fm-card .mf-s-avatar .mf-s-initials { font-size: ${u(30)}; }
.fm-handle { font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(32)}; line-height: 1.2; color: var(--mf-ink); min-width: 0; overflow-wrap: anywhere; }
.fm-hero { position: relative; }
#fm-card .mf-c-counter { position: relative; left: auto; top: auto; width: auto; height: auto; gap: ${u(2)}; }
#fm-card .mf-c-count { font-size: ${u(84)}; color: var(--mf-ink); }
#fm-card .mf-c-label { font-size: ${u(32)}; line-height: 1.2; color: var(--mf-muted); white-space: normal; overflow-wrap: anywhere; hyphens: auto; }
.fm-burst { position: absolute; left: 0; top: 0; width: 0; height: 0; font-size: ${u(84)}; }
${O}.is-square .fm-burst { font-size: ${u(52)}; }
${O}.is-portrait .fm-burst { font-size: ${u(64)}; }
#mf-root.is-full .fm-burst { font-size: ${u(130)}; }
.fm-arm { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.fm-ray { position: absolute; left: -0.06em; top: -0.22em; width: 0.12em; height: 0.44em; border-radius: 0.06em; background: var(--mf-accent); opacity: 0; }
.fm-badge-row { display: flex; }
#fm-card .mf-s-chip { position: relative; left: auto; top: auto; }
#fm-card .mf-s-chip .mf-s-label { font-size: ${u(32)}; white-space: normal; overflow-wrap: anywhere; }
/* Overlays: beside the face band. */
${O}.is-landscape .fm-card { left: 0; bottom: ${u(32)}; width: ${u(440)}; }
${O}.is-square .fm-card { left: 0; bottom: ${u(32)}; width: ${u(190)}; padding: ${u(16)} ${u(12)}; gap: ${u(10)}; }
${O}.is-square #fm-card .mf-c-count { font-size: ${u(38)}; }
${O}.is-square #fm-card .mf-s-avatar { width: ${u(56)}; height: ${u(56)}; }
${O}.is-square .fm-handle { display: none; }
/* The 190u column keeps the number and its label; the chip would wrap into a block. */
${O}.is-square .fm-badge-row { display: none; }
${O}.is-square #fm-card .mf-c-label { font-size: ${u(30)}; }
/* 9:16: two compact rows in the 212 px above the face band (number with its label, then the chip). */
${O}.is-portrait .fm-card { left: 0; right: 0; top: 0; gap: ${u(10)}; padding: ${u(16)} ${u(24)}; }
${O}.is-portrait .fm-who { display: none; }
${O}.is-portrait #fm-card .mf-c-counter { flex-direction: row; align-items: baseline; gap: ${u(16)}; }
${O}.is-portrait #fm-card .mf-c-count { font-size: ${u(64)}; }
/* B-roll: a centred card under an accent band, larger type. */
#mf-root.is-full .fm-stage { display: flex; align-items: center; justify-content: center; }
#mf-root.is-full .fm-card { position: relative; left: auto; right: auto; top: auto; bottom: auto; width: ${u(760)}; max-width: calc(100% - ${u(32)}); flex-direction: column; align-items: stretch; padding: 0 ${u(40)} ${u(40)}; gap: ${u(22)}; }
#mf-root.is-full .fm-band { display: block; height: ${u(110)}; margin: 0 ${u(-40)} ${u(-60)}; background: var(--mf-accent); }
#mf-root.is-full #fm-card .mf-s-avatar { width: ${u(112)}; height: ${u(112)}; border: ${u(6)} solid var(--mf-surface); background: var(--mf-accent); color: ${ink}; }
#mf-root.is-full #fm-card .mf-s-avatar .mf-s-initials { font-size: ${u(46)}; }
#mf-root.is-full .fm-who { flex-direction: row; align-items: flex-end; }
#mf-root.is-full .fm-handle { display: block; font-size: ${u(36)}; padding-bottom: ${u(10)}; }
#mf-root.is-full #fm-card .mf-c-count { font-size: ${u(150)}; }
#mf-root.is-full #fm-card .mf-c-label { font-size: ${u(40)}; }
#mf-root.is-full #fm-card .mf-s-chip .mf-s-label { font-size: ${u(34)}; }
`;
  const stamp = TIMES.stamp;
  const script = [
    // Overlays fade the card in; the b-roll card is on screen from frame 0 (frame-0 ink).
    overlay ? `tl.fromTo('#fm-card', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, ${TIMES.card});` : '',
    out === null ? '' : `tl.to('#fm-card', { opacity: 0, duration: 0.35, ease: 'power3.in' }, ${out});`,
    // The rays ring the number: an ellipse a little outside its box, each ray pointing outward.
    `{
    const hero = root.querySelector('.fm-hero');
    const box = root.querySelector('#fm-count .mf-c-count').getBoundingClientRect();
    const frame = hero.getBoundingClientRect();
    const burst = root.querySelector('#fm-burst');
    const pad = parseFloat(getComputedStyle(burst).fontSize) * 0.35;
    burst.style.left = (box.left - frame.left + box.width / 2) + 'px';
    burst.style.top = (box.top - frame.top + box.height / 2) + 'px';
    const rx = box.width / 2 + pad;
    const ry = box.height / 2 + pad;
    root.querySelectorAll('#fm-burst .fm-arm').forEach((arm, i, all) => {
      const angle = (i / all.length) * Math.PI * 2;
      gsap.set(arm, { x: rx * Math.cos(angle), y: ry * Math.sin(angle), rotation: (angle * 180) / Math.PI + 90 });
    });
  }`,
    `tl.fromTo('#fm-burst .fm-ray', { opacity: 0, y: 0, scaleY: 0.3 }, { opacity: 1, y: -14 * ctx.u, scaleY: 1, duration: 0.25, ease: 'power4.out', stagger: 0.012 }, ${stamp});`,
    `tl.to('#fm-burst .fm-ray', { opacity: 0, y: -30 * ctx.u, scaleY: 0.4, duration: 0.3, ease: 'power3.in', stagger: 0.012 }, ${stamp + 0.25});`,
    count.script,
    badge.script,
    face.script,
    cam?.script ?? '',
  ].join('\n  ');
  return {
    id: meta.id,
    html: cam ? cam.html : stage,
    css: [css, cam?.css ?? ''].join('\n'),
    script,
    assets: [],
    needsThree: false,
    holds: meta.holds.map((hold) => ({ from: hold.from * end, to: hold.to * end })),
  };
}

export default { meta, vars, build } satisfies MoveModule;

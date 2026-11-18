// task-checkoff (productivity-01): a checklist whose three items tick off in
// turn; each tick draws a strike-through across its words and steps a progress
// bar a third further. Overlays sit beside the face band (a column at the left
// in 16:9, three compact rows in the strip above it in 9:16; no 1:1 overlay,
// its columns are too narrow for a readable task line) and leave in the last
// 0.45 s; the b-roll centres the list under an accent header and drifts.
import type { MoveModule, ResolvedVars } from '../../../contract';
import { html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { onAccent, progress, row } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;
const MARK = 'tc-text-slot';
const ITEMS = ['first', 'second', 'third'] as const;

/** Seconds of the checklist. */
const TIMES = {
  card: 0.05,
  title: 0.1,
  /** Rows arrive 80 ms apart (motion.stagger.itemsMs); their words 50 ms after the row. */
  rows: [0.2, 0.28, 0.36],
  progress: 0.45,
  /** Seconds before the end for the last tick, leaving time to read the result. */
  lastTickBefore: 2.05,
  strikeAfter: 0.1,
  strikeSec: 0.3,
  stepSec: 0.35,
  /** Overlays leave this long before the end (overlay.exitWindowSec max). */
  exitBefore: 0.45,
} as const;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const end = ctx.durationSec;
  const overlay = ctx.mode !== 'full';
  const out = overlay ? end - TIMES.exitBefore : null;
  const exit = out === null ? 'end' : `up@${out.toFixed(2)}`;
  const ticks = [1.1, 1.8, end - TIMES.lastTickBefore] as const;
  const [firstTick, secondTick, lastTick] = ticks;

  const title = line({ text: String(v.title), role: 'title', in: `rise@${TIMES.title}`, out: exit, className: 'tc-title', variable: 'title', id: 'tc-title' });
  const rows = ITEMS.map((name, i) => {
    const at = TIMES.rows[i] as number;
    const piece = row(ctx, { id: `tc-row-${i}`, label: MARK, at, tickAt: ticks[i] as number });
    const slot = `<span class="mf-s-label" data-mf-static>${MARK}</span>`;
    if (!piece.html.value.includes(slot)) throw new Error('task-checkoff: the kit row markup changed');
    const words = line({ text: String(v[name]), role: 'body', in: `rise@${(at + 0.05).toFixed(2)}`, out: exit, className: 'tc-text', variable: name, id: `tc-text-${i}`, tag: 'span' });
    return { ...piece, html: trusted(piece.html.value.replace(slot, html`<span class="tc-complete" aria-hidden="true"></span><span class="tc-item">${words}</span>`.value)) };
  });
  const bar = progress(ctx, { id: 'tc-progress', label: '', value: 1 / 3, at: TIMES.progress, fillAt: firstTick + TIMES.strikeAfter, fillSec: TIMES.stepSec });

  const list = trusted(rows.map((piece) => piece.html.value).join(''));
  const card = html`<div class="tc-card" id="tc-card"><div class="tc-head">${title}</div><div class="tc-list" id="tc-list">${list}</div>${bar.html}</div>`;
  const stage = html`<div class="tc-stage">${card}</div>`;
  const cam = overlay ? null : camera(ctx, stage, { id: 'tc-camera', moves: [{ kind: 'drift', from: 0, to: end }] });
  const ink = onAccent(ctx);
  // Overlay-only layouts; the b-roll rules below hold for every aspect.
  const O = ':is(.is-alpha, .is-key)';

  const css = `
${[...rows, bar].map((piece) => piece.css).join('\n')}
.tc-stage { position: absolute; inset: 0; }
.tc-card { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; gap: ${u(14)}; padding: ${u(22)} ${u(24)}; background: var(--mf-surface); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); }
.tc-head { display: block; }
.tc-title { font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(36)}; line-height: 1.2; color: var(--mf-ink); overflow-wrap: anywhere; }
.tc-list { display: flex; flex-direction: column; gap: ${u(10)}; }
#tc-list .mf-s-row { position: relative; left: auto; top: auto; width: auto; gap: ${u(16)}; padding: ${u(12)} ${u(16)}; --tc-row-base: var(--mf-ground); background: var(--tc-row-base); isolation: isolate; }
.tc-complete { position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: color-mix(in srgb, var(--mf-accent) 30%, var(--tc-row-base)); clip-path: inset(0 100% 0 0); }
#tc-list .mf-s-box { width: ${u(34)}; height: ${u(34)}; }
.tc-item { position: relative; display: block; min-width: 0; }
.tc-text { display: block; font-size: ${u(30)}; font-weight: 600; line-height: 1.25; color: var(--mf-ink); overflow-wrap: anywhere; }
.tc-text .mf-body { position: relative; }
.tc-strike { position: absolute; height: ${u(4)}; border-radius: ${u(2)}; background: var(--mf-accent); transform: scaleX(0); transform-origin: 0% 50%; pointer-events: none; }
#tc-card .mf-s-progress { position: relative; left: auto; top: auto; width: auto; gap: 0; }
#tc-card .mf-s-progress .mf-s-label { display: none; }
#tc-card .mf-s-track { height: ${u(18)}; border-radius: ${u(9)}; }
/* Overlays: beside the face band, lifted clear of the caption band. */
${O}.is-landscape .tc-card { left: 0; bottom: ${u(32)}; width: ${u(440)}; }
/* 9:16: three compact rows and the bar in the 212 px above the face band, no heading. */
${O}.is-portrait .tc-card { left: 0; right: 0; top: 0; gap: ${u(8)}; padding: ${u(10)} ${u(18)}; }
${O}.is-portrait .tc-head { display: none; }
${O}.is-portrait .tc-list { gap: ${u(4)}; }
/* Unfilled rows: the line masks reach below a compact row, so the card is their container. */
${O}.is-portrait #tc-list .mf-s-row { padding: ${u(4)} ${u(6)}; gap: ${u(12)}; --tc-row-base: var(--mf-surface); background: none; border: none; }
${O}.is-portrait #tc-list .mf-s-box { width: ${u(28)}; height: ${u(28)}; }
${O}.is-portrait .tc-text { font-size: ${u(29)}; line-height: 1.2; }
${O}.is-portrait #tc-card .mf-s-track { height: ${u(14)}; }
/* B-roll: a centred list under an accent header, larger type. */
#mf-root.is-full .tc-stage { display: flex; align-items: center; justify-content: center; }
#mf-root.is-full .tc-card { position: relative; width: ${u(800)}; max-width: calc(100% - ${u(32)}); padding: 0 ${u(36)} ${u(36)}; gap: ${u(22)}; overflow: hidden; }
#mf-root.is-full .tc-head { margin: 0 ${u(-36)}; padding: ${u(26)} ${u(36)}; background: var(--mf-accent); }
#mf-root.is-full .tc-title { font-size: ${u(46)}; color: ${ink}; }
#mf-root.is-full .tc-list { gap: ${u(14)}; }
#mf-root.is-full #tc-list .mf-s-row { padding: ${u(20)} ${u(24)}; gap: ${u(22)}; }
#mf-root.is-full #tc-list .mf-s-box { width: ${u(44)}; height: ${u(44)}; }
#mf-root.is-full .tc-text { font-size: ${u(40)}; }
#mf-root.is-full .tc-strike { height: ${u(5)}; }
#mf-root.is-full #tc-card .mf-s-track { height: ${u(20)}; border-radius: ${u(10)}; }
`;
  const script = [
    // Overlays fade the card in; the b-roll card is on screen from frame 0 (frame-0 ink).
    overlay ? `tl.fromTo('#tc-card', { opacity: 0 }, { opacity: 1, duration: 0.55, ease: 'power4.out' }, ${TIMES.card});` : '',
    out === null ? '' : `tl.to('#tc-card', { opacity: 0, duration: 0.25, ease: 'power3.in' }, ${out + 0.1});`,
    ...rows.map((piece) => piece.script),
    bar.script,
    // The bar steps a third further on the second and third tick.
    `tl.to('#tc-progress .mf-s-fill', { scaleX: 2 / 3, duration: ${TIMES.stepSec}, ease: 'power2.inOut' }, ${secondTick + TIMES.strikeAfter});`,
    `tl.to('#tc-progress .mf-s-fill', { scaleX: 1, duration: ${TIMES.stepSec}, ease: 'power2.inOut' }, ${lastTick + TIMES.strikeAfter});`,
    // Measure each visual line after the kit wraps it and the brand fonts load.
    // Strikes live inside the animated text body so they leave with the words.
    `{
    const ticks = ${JSON.stringify(ticks)};
    root.querySelectorAll('#tc-list .tc-complete').forEach((complete, i) => {
      tl.to(complete, { clipPath: 'inset(0 0% 0 0)', duration: 0.3, ease: 'power2.inOut' }, ticks[i]);
    });
    mf.ready(() => {
      root.querySelectorAll('#tc-list .tc-text .mf-body').forEach((body, i) => {
        const frame = body.getBoundingClientRect();
        const scale = frame.width / parseFloat(getComputedStyle(body).width) || 1;
        const rtl = getComputedStyle(body).direction === 'rtl';
        const range = document.createRange();
        range.selectNodeContents(body);
        const lines = [];
        for (const rect of range.getClientRects()) {
          if (rect.width < 1 || rect.height < 1) continue;
          const last = lines[lines.length - 1];
          if (last && Math.abs(rect.top - last.top) <= 2) {
            last.left = Math.min(last.left, rect.left);
            last.right = Math.max(last.right, rect.right);
            last.bottom = Math.max(last.bottom, rect.bottom);
          } else {
            lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
          }
        }
        const strikes = lines.map((box) => {
          const strike = document.createElement('span');
          strike.className = 'tc-strike';
          strike.setAttribute('aria-hidden', 'true');
          if (rtl) strike.style.transformOrigin = '100% 50%';
          body.appendChild(strike);
          strike.style.left = ((box.left - frame.left) / scale) + 'px';
          strike.style.width = ((box.right - box.left) / scale) + 'px';
          strike.style.top = (((box.top + box.bottom) / 2 - frame.top) / scale - strike.offsetHeight / 2) + 'px';
          return strike;
        });
        if (strikes.length > 0) {
          tl.fromTo(strikes, { scaleX: 0 }, { scaleX: 1, duration: ${TIMES.strikeSec}, ease: 'power2.inOut', stagger: 0.12 }, ticks[i] + ${TIMES.strikeAfter});
        }
      });
    });
  }`,
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

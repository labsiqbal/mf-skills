// prompt-to-result (ai-01): an app window is on screen from frame 0; a prompt
// types into its input bar, the cursor travels to the send button and clicks,
// and the answer card unfolds below with its heading and text. B-roll only,
// with the kit camera's seeded drift.
import type { MoveModule, ResolvedVars } from '../../../contract';
import { type TrustedHtml, html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera, cursor } from '../../../../kit/build/rig';
import { button, card, input, onAccent } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { ENTRANCE } from '../../../../kit/runtime/spec';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

/** Replace a kit piece's static text span with an mf-line (rule 3), guarded against kit markup changes. */
function withLine(piece: { html: TrustedHtml }, className: string, value: string, lineHtml: TrustedHtml): TrustedHtml {
  const slot = `<span class="${className}" data-mf-static>${value}</span>`;
  if (!piece.html.value.includes(slot)) throw new Error(`prompt-to-result: the kit ${className} markup changed`);
  return trusted(piece.html.value.replace(slot, lineHtml.value));
}

/** Seconds: the prompt types from `type`; the cursor arrives and clicks; the card unfolds. */
export function timesFor(prompt: string) {
  const type = 0.45;
  const typed = type + [...prompt].length / ENTRANCE.type.charsPerSec;
  const click = Math.max(2.2, typed + 0.55);
  return { panel: 0.1, type, typed, click, card: click + 0.25, title: click + 0.35, body: click + 0.5 };
}

const MARK = { prompt: 'mp-prompt-slot', title: 'mp-title-slot', body: 'mp-body-slot' } as const;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const prompt = String(v.prompt);
  const t = timesFor(prompt);
  const bar = input(ctx, { id: 'mp-input', value: MARK.prompt, at: t.panel, out: null, blinkUntil: 0 });
  const send = button(ctx, { id: 'mp-send', label: String(v.send), at: t.panel, out: null, pressAt: t.click });
  const answer = card(ctx, { id: 'mp-answer', title: MARK.title, body: MARK.body, at: t.card, out: null });
  const pointer = cursor(ctx, {
    id: 'mp-cursor',
    path: [
      // From below-left of the send button (inside the panel) onto it.
      { at: 0, xU: -240, yU: 220 },
      { at: t.typed, xU: -200, yU: 180 },
      { at: t.click - 0.05, xU: 60, yU: 34 },
    ],
    clicks: [t.click],
    sizeU: 44,
  });

  const promptLine = line({ text: prompt, role: 'body', in: `type@${t.type.toFixed(2)}`, out: 'end', className: 'mp-prompt', variable: 'prompt' });
  const titleLine = line({ text: String(v.title), role: 'title', in: `rise@${t.title.toFixed(2)}`, out: 'end', className: 'mp-title', variable: 'title' });
  const bodyLine = line({ text: String(v.body), role: 'body', in: `rise@${t.body.toFixed(2)}`, out: 'end', className: 'mp-text', variable: 'body' });
  const barHtml = withLine(bar, 'mf-s-value', MARK.prompt, promptLine);
  const answerHtml = withLine({ html: withLine(answer, 'mf-s-title', MARK.title, titleLine) }, 'mf-s-body', MARK.body, bodyLine);

  const panel = html`<div class="mp-panel" id="mp-panel"><div class="mp-bar"><span class="mp-dot"></span><span class="mp-dot"></span><span class="mp-dot"></span><span class="mp-app" data-mf-static>${String(v.app)}</span></div><div class="mp-body"><div class="mp-ask">${barHtml}<div class="mp-sendwrap">${send.html}${pointer.html}</div></div>${answerHtml}</div></div>`;
  const stage = html`<div class="mp-stage">${panel}</div>`;
  const cam = camera(ctx, stage, { id: 'mp-camera', moves: [{ kind: 'drift', from: 0, to: ctx.durationSec }] });
  const ink = onAccent(ctx);

  const css = `
${bar.css}
${send.css}
${answer.css}
${pointer.css}
.mp-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.mp-panel { position: relative; box-sizing: border-box; width: ${u(1180)}; max-width: calc(100% - ${u(32)}); background: var(--mf-ground); border: 1px solid var(--mf-line); border-radius: var(--mf-radius); overflow: hidden; }
.mp-bar { display: flex; align-items: center; gap: ${u(12)}; padding: ${u(20)} ${u(28)}; background: var(--mf-accent); color: ${ink}; }
.mp-dot { width: ${u(16)}; height: ${u(16)}; border-radius: 50%; background: ${ink}; opacity: 0.55; }
.mp-app { margin-left: ${u(12)}; min-width: 0; font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(34)}; line-height: 1.2; overflow-wrap: anywhere; }
.mp-body { display: flex; flex-direction: column; gap: ${u(28)}; padding: ${u(36)}; }
.mp-ask { display: flex; align-items: center; gap: ${u(18)}; }
#mp-panel .mf-s-input { position: relative; left: auto; top: auto; flex: 1; min-width: 0; width: auto; font-size: ${u(34)}; line-height: 1.3; padding: ${u(20)} ${u(30)}; border-radius: ${u(36)}; }
#mp-panel .mf-s-caret { display: none; }
#mp-panel .mp-prompt { display: block; min-width: 0; color: var(--mf-ink); overflow-wrap: anywhere; }
/* Words wrap whole; a word longer than the line wraps between its typed characters. */
#mp-panel .mp-prompt .mf-word { max-width: 100%; white-space: normal; }
.mp-sendwrap { position: relative; flex: none; }
#mp-panel .mf-s-button { position: relative; left: auto; top: auto; }
#mp-panel .mf-s-button .mf-s-label { font-size: ${u(34)}; }
#mp-panel #mp-cursor { left: 0; top: 0; }
#mp-panel .mf-s-card { position: relative; left: auto; top: auto; width: auto; padding: ${u(32)} ${u(36)}; gap: ${u(12)}; transform-origin: 50% 0%; }
#mp-panel .mp-title { display: block; font-family: var(--mf-font-heading); font-weight: 700; font-size: ${u(44)}; line-height: 1.2; color: var(--mf-ink); overflow-wrap: anywhere; }
#mp-panel .mp-text { display: block; font-size: ${u(34)}; line-height: 1.35; color: var(--mf-muted); overflow-wrap: anywhere; }
.is-portrait .mp-panel { width: 100%; }
.is-portrait .mp-ask { flex-direction: column; align-items: stretch; }
.is-portrait .mp-sendwrap { align-self: flex-end; }
.is-square .mp-panel { width: ${u(880)}; }
`;
  const script = [
    bar.script,
    send.script,
    answer.script,
    // The answer card unfolds from its top edge as it arrives.
    `tl.fromTo('#mp-answer', { scaleY: 0.3 }, { scaleY: 1, duration: 0.55, ease: 'expo.out' }, ${t.card});`,
    pointer.script,
    cam.script,
  ].join('\n  ');
  return { id: meta.id, html: cam.html, css: [css, cam.css].join('\n'), script, assets: [], needsThree: false, holds: [] };
}

export default { meta, vars, build } satisfies MoveModule;

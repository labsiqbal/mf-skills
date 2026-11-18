// terminal-run (dev-01): a laptop (a tablet in 9:16) on an accent floor shows a terminal; the
// command types after the prompt, the output lines stream in one by one, and
// a pass chip stamps. B-roll only: the floor gives ink from frame 0, the
// laptop turns a few degrees and the camera drifts.
import type { MoveModule, ResolvedVars } from '../../../contract';
import { laptop, tablet } from '../../../../kit/build/devices';
import { html, trusted } from '../../../../kit/build/html';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { chip } from '../../../../kit/build/surfaces';
import { line } from '../../../../kit/build/type';
import { ENTRANCE } from '../../../../kit/runtime/spec';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

/** The device per aspect: a laptop where the frame is wide, a tablet in 9:16; width in u and height over width. */
const DEVICE = {
  '16:9': { kind: 'laptop', widthU: 1250, ratio: 11 / 16, baseShare: 0.9 },
  '1:1': { kind: 'laptop', widthU: 900, ratio: 11 / 16, baseShare: 0.9 },
  '9:16': { kind: 'tablet', widthU: 780, ratio: 4 / 3, baseShare: 0.97 },
} as const;

export function timesFor(command: string, lines: number) {
  const type = 0.6;
  const typed = type + [...command].length / ENTRANCE.type.charsPerSec;
  const first = typed + 0.25;
  const output = Array.from({ length: lines }, (_, i) => first + i * 0.3);
  const mark = (output.at(-1) ?? first) + 0.5;
  return { device: 0, type, typed, output, mark };
}

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const command = String(v.command);
  const outputs = (Array.isArray(v.output) ? v.output : []).map(String);
  const t = timesFor(command, outputs.length);

  const commandLine = line({ text: command, role: 'body', in: `type@${t.type.toFixed(2)}`, out: 'end', className: 'tr-cmd', variable: 'command' });
  const outputLines = outputs.map((text, i) => line({ text, role: 'body', in: `rise@${(t.output[i] ?? 0).toFixed(2)}`, out: 'end', className: 'tr-out', variable: 'output' }));
  const mark = chip(ctx, { id: 'tr-mark', label: String(v.result), at: t.mark, out: null });
  const screen = html`<div class="tr-term"><div class="tr-row"><span class="tr-prompt" aria-hidden="true" data-mf-static>$</span>${commandLine}</div>${outputLines}<div class="tr-mark-row">${mark.html}</div></div>`;
  const spec = DEVICE[ctx.aspect];
  const make = spec.kind === 'laptop' ? laptop : tablet;
  const device = make(ctx, { id: 'tr-device', widthU: spec.widthU, at: t.device, out: null, turnFromDeg: -5, turnToDeg: 4, screen: { kind: 'tree', html: screen } });
  // The floor's top edge meets the device's base: the device is centred, so its base sits at 50% plus (base share - 0.5) of its height.
  const floorTopU = Math.round((spec.baseShare - 0.5) * spec.widthU * spec.ratio);
  const floor = trusted('<div class="tr-floor" aria-hidden="true"></div>');
  const stage = html`<div class="tr-stage">${floor}${device.html}</div>`;
  const cam = camera(ctx, stage, { id: 'tr-camera', moves: [{ kind: 'drift', from: 0, to: ctx.durationSec }] });

  const css = `
/* The floor reaches past the copy box to the frame edges; the camera does not clip it. */
#mf-root #tr-camera { overflow: visible; }
.tr-floor { position: absolute; left: ${u(-2400)}; right: ${u(-2400)}; top: calc(50% + ${u(floorTopU)}); height: ${u(2400)}; background: var(--mf-accent); }
.tr-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
#tr-device.mf-device { position: relative; left: auto; top: auto; flex: none; }
.tr-term { position: absolute; inset: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: ${u(6)}; padding: ${u(28)} ${u(32)}; background: var(--mf-surface); font-family: var(--mf-font-mono); font-size: ${u(40)}; line-height: 1.35; color: var(--mf-ink); }
.tr-row { display: flex; gap: ${u(18)}; }
.tr-prompt { flex: none; color: var(--mf-accent); font-weight: 700; }
.tr-cmd { min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
.tr-cmd .mf-word { max-width: 100%; white-space: normal; }
.tr-out { color: var(--mf-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.tr-mark-row { display: flex; margin-top: ${u(10)}; }
#tr-device .mf-s-chip { position: relative; left: auto; top: auto; background: var(--mf-accent); }
#tr-device .mf-s-chip .mf-s-dot { background: var(--mf-on-accent); }
#tr-device .mf-s-chip .mf-s-label { font-family: var(--mf-font-body); font-size: ${u(38)}; color: var(--mf-on-accent); white-space: normal; overflow-wrap: anywhere; }
.is-portrait .tr-term { font-size: ${u(40)}; padding: ${u(30)} ${u(28)}; }
.is-square .tr-term { font-size: ${u(36)}; }
.is-portrait #tr-device .mf-s-chip .mf-s-label, .is-square #tr-device .mf-s-chip .mf-s-label { font-size: ${u(34)}; }
${device.css}
${mark.css}
`;
  const script = [
    device.script,
    mark.script,
    // The pass mark stamps: a quick overshoot as it lands.
    `tl.fromTo('#tr-mark', { scale: 1.25 }, { scale: 1, duration: 0.35, ease: 'back.out(1.8)' }, ${t.mark});`,
    cam.script,
  ].join('\n  ');
  return { id: meta.id, html: cam.html, css: [css, cam.css].join('\n'), script, assets: [], needsThree: false, holds: [] };
}

export default { meta, vars, build } satisfies MoveModule;

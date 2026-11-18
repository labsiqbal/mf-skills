import type { MoveModule, ResolvedVars } from '../../../contract';
import { html } from '../../../../kit/build/html';
import { flat } from '../../../../kit/build/materials';
import type { Composition, MoveCtx } from '../../../../kit/build/move';
import { camera } from '../../../../kit/build/rig';
import { line } from '../../../../kit/build/type';
import { meta } from './meta';

export { meta };
export const vars = meta.vars;

const u = (n: number) => `calc(var(--mf-u) * ${n})`;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const full = ctx.mode === 'full';
  const end = ctx.durationSec;
  const out = full ? 'end' : `wipe@${(end - 0.42).toFixed(2)}`;
  const surface = flat(ctx, { id: 'tl-surface', tone: 'surface' });
  const title = line({ text: String(v.headline), role: 'title', in: 'mask@0.16', out, id: 'tl-headline', variable: 'headline' });
  const mark = ctx.brandMark;
  const art = mark
    ? html`<img id="tl-mark" src="${mark.file}" width="${mark.width}" height="${mark.height}" alt="${ctx.brandName ?? ''}" class="${mark.kind === 'logo' ? 'tl-logo' : ''}">`
    : line({ text: ctx.brandName ?? 'Brand', role: 'label', in: 'mask@0.08', out, id: 'tl-wordmark' });
  const panel = html`<div id="tl-panel">
    ${surface.html}
    <div class="tl-band" aria-hidden="true"></div>
    <div class="tl-lockup ${mark ? '' : 'tl-fallback'}">
      <div class="tl-identity">${art}</div>
      ${title}
    </div>
  </div>`;
  const stage = html`<div class="tl-stage">${panel}</div>`;
  const cam = full ? camera(ctx, stage, { id: 'tl-camera', moves: [{ kind: 'drift', from: 0, to: end }] }) : null;

  return {
    id: meta.id,
    html: cam?.html ?? stage,
    css: `
${surface.css}
.tl-stage { position: absolute; inset: 0; }
#tl-panel { position: absolute; box-sizing: border-box; width: min(${u(440)}, 100%); overflow: hidden; border-radius: var(--mf-radius); border: 1px solid var(--mf-line); }
.tl-band { position: absolute; inset: 0 0 auto; height: ${u(7)}; background: var(--mf-accent); }
.tl-lockup { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: ${u(16)}; padding: ${u(27)} ${u(22)} ${u(21)}; }
.tl-identity { min-width: 0; display: flex; align-items: center; }
#tl-mark { display: block; width: ${u(62)}; height: ${u(62)}; object-fit: contain; }
#tl-mark.tl-logo { width: ${u(120)}; }
#tl-headline, #tl-wordmark { font-family: var(--mf-font-heading); font-weight: 700; line-height: 1.12; overflow-wrap: anywhere; color: var(--mf-ink); }
#tl-headline { font-size: ${u(37)}; }
#tl-wordmark { font-size: ${u(30)}; max-width: ${u(160)}; }
.tl-fallback { grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
.is-landscape #tl-panel { left: 0; bottom: ${u(124)}; }
.is-portrait #tl-panel { left: 0; top: ${u(62)}; width: min(${u(620)}, 100%); }
.is-square #tl-panel { left: 0; top: 0; width: min(${u(710)}, 100%); }
.is-square .tl-lockup { gap: ${u(16)}; padding: ${u(8)} ${u(16)}; }
.is-square .tl-band { inset: 0 auto 0 0; width: ${u(3)}; height: auto; }
.is-square #tl-mark { height: ${u(36)}; width: ${u(36)}; }
.is-square #tl-mark.tl-logo { width: ${u(110)}; }
.is-square #tl-headline, .is-square #tl-wordmark { font-size: ${u(30)}; }
.is-square #tl-headline > .mf-clip, .is-square #tl-wordmark > .mf-clip { padding-block: 0; margin-block: 0; }
.is-square:not(.is-full) #tl-panel:has(.tl-fallback) { width: min(${u(900)}, 100%); }
.is-square:not(.is-full) .tl-fallback { grid-template-columns: minmax(0, .34fr) minmax(0, .66fr); }
.is-square #tl-wordmark { white-space: nowrap; max-width: none; overflow: hidden; text-overflow: ellipsis; }
.is-full .tl-stage { display: flex; align-items: center; justify-content: center; }
.is-full #tl-panel { position: relative; inset: auto; width: min(${u(1080)}, calc(100% - ${u(76)})); }
.is-full .tl-lockup { gap: ${u(44)}; padding: ${u(140)} ${u(48)} ${u(50)}; }
.is-full .tl-band { inset: 0 0 auto; width: auto; height: ${u(84)}; }
.is-full #tl-mark { width: ${u(116)}; height: ${u(116)}; }
.is-full #tl-mark.tl-logo { width: ${u(190)}; }
.is-full #tl-wordmark { font-size: ${u(46)}; max-width: none; white-space: normal; overflow: visible; }
.is-full #tl-headline { font-size: ${u(68)}; }
${cam?.css ?? ''}
`,
    script: `
${full ? '' : `tl.fromTo('#tl-panel', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.58, ease: 'power4.out' }, 0.04);
tl.to('#tl-panel', { clipPath: 'inset(0 0 0 100%)', duration: 0.26, ease: 'power3.in' }, ${end - 0.34});`}
${mark ? "tl.fromTo('#tl-mark', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.54, ease: 'power4.out' }, 0.14);" : ''}
${cam?.script ?? ''}
`,
    assets: [],
    needsThree: false,
    holds: meta.holds.map(({ from, to }) => ({ from: from * end, to: to * end })),
  };
}

export default { meta, vars, build } satisfies MoveModule;

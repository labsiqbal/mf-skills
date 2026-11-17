// Text builders: the type ramp from the type.* numbers, its CSS, and line(),
// which emits an mf-line whose entrance and exit the runtime builds.
import { type AspectKey, NUMBERS, aspectSize } from '../numbers';
import { ENTRANCE_KINDS, EXIT_KINDS, LINE_CSS, isRtlText, parseEntrance, parseExit } from '../runtime/spec';
import { type TrustedHtml, html, trusted } from './html';

export const TYPE_ROLES = ['hero', 'title', 'subtitle', 'body', 'label'] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];

/** Role sizes in u at 16:9 (u = short side / 1080); 9:16 titles and heroes take type.verticalTitleScale. */
export const RAMP_U: Record<TypeRole, number> = { hero: 130, title: 70, subtitle: 48, body: 38, label: 28 };
const FONT_ROLE: Record<TypeRole, string> = { hero: 'display', title: 'heading', subtitle: 'heading', body: 'body', label: 'body' };
const WEIGHT_VAR: Record<TypeRole, string> = { hero: '800', title: '700', subtitle: '600', body: '400', label: '600' };
const LINE_HEIGHT: Record<TypeRole, number> = { hero: 1.0, title: 1.08, subtitle: 1.15, body: 1.35, label: 1.2 };

export interface TypeRamp {
  aspect: AspectKey;
  width: number;
  height: number;
  /** Font sizes in px. */
  sizes: Record<TypeRole, number>;
  /** type.minReadablePx at this frame. */
  minPx: number;
}

/** Font sizes per role for a frame, inside the type.* ranges. */
export function typeRamp(aspect: AspectKey, frame: { width?: number } = {}): TypeRamp {
  const base = aspectSize(aspect);
  const width = frame.width ?? base.width;
  const height = Math.round((base.height * width) / base.width);
  const u = Math.min(width, height) / NUMBERS['unit.u'].base;
  const vertical = aspect === '9:16' ? NUMBERS['type.verticalTitleScale'] : 1;
  const minPx = NUMBERS['type.minReadablePx'].shortSideShare * Math.min(width, height);
  const sizes = Object.fromEntries(
    TYPE_ROLES.map((role) => {
      const scale = role === 'hero' || role === 'title' ? vertical : 1;
      return [role, Math.max(minPx, Math.round(RAMP_U[role] * u * scale * 100) / 100)];
    }),
  ) as Record<TypeRole, number>;
  return { aspect, width, height, sizes, minPx: Math.round(minPx * 100) / 100 };
}

/** CSS for the line structure and the role classes (.mf-role-<role>), using the brand font tokens. */
export function typeCss(ramp: TypeRamp): string {
  const roles = TYPE_ROLES.map(
    (role) =>
      `.mf-role-${role} { font-family: var(--mf-font-${FONT_ROLE[role]}); font-size: ${ramp.sizes[role]}px; font-weight: ${WEIGHT_VAR[role]}; line-height: ${LINE_HEIGHT[role]}; }`,
  );
  return `${LINE_CSS}\n${roles.join('\n')}\n`;
}

export interface LineProps {
  text: string;
  role: TypeRole;
  /** Entrance cue, "kind@time", for example "words@bar2+0.5b". */
  in: string;
  /** Exit cue, "kind@time", or "end". */
  out: string;
  /** Accent line (read.accentWordMinSec applies). */
  accent?: boolean;
  id?: string;
  /** Name of the variable the text came from (named in fit errors). */
  variable?: string;
  tag?: 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'span';
  /** Text direction; right-to-left text without one gets dir="rtl". */
  dir?: 'ltr' | 'rtl' | 'auto';
  lang?: string;
  /** slot: the options rolled through before the final word. */
  options?: string[];
  /** count: the starting number. */
  from?: number;
  className?: string;
}

/** An mf-line element; cues are validated here so a bad cue fails the build, not the render. */
export function line(props: LineProps): TrustedHtml {
  if (!(props.role && (TYPE_ROLES as readonly string[]).includes(props.role))) throw new Error(`line role "${props.role}" is not one of ${TYPE_ROLES.join(', ')}`);
  parseEntrance(props.in);
  parseExit(props.out);
  const tag = props.tag ?? 'div';
  const dir = props.dir ?? (isRtlText(props.text) ? 'rtl' : undefined);
  const classes = ['mf-line', `mf-role-${props.role}`, ...(props.className ? [props.className] : [])].join(' ');
  return html`<${trustedTag(tag)} class="${classes}"${attr('id', props.id)} data-mf-in="${props.in}" data-mf-out="${props.out}"${props.accent ? html` data-mf-accent` : ''}${attr('data-mf-var', props.variable)}${attr('dir', dir)}${attr('lang', props.lang)}${attr('data-mf-options', props.options?.join('|'))}${attr('data-mf-from', props.from)}>${props.text}</${trustedTag(tag)}>`;
}

const TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'span']);

/** A tag name from the allow-list, inserted raw. */
function trustedTag(tag: string): TrustedHtml {
  if (!TAGS.has(tag)) throw new Error(`line tag "${tag}" is not allowed`);
  return trusted(tag);
}

/** ` name="value"` with the value escaped; nothing when the value is absent. Names are kit constants. */
function attr(name: string, value: string | number | undefined): TrustedHtml | string {
  return value === undefined || value === '' ? '' : html` ${trusted(name)}="${value}"`;
}

export { ENTRANCE_KINDS, EXIT_KINDS };

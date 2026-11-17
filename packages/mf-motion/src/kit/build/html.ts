// The one escaper for composition markup: `html` escapes every interpolated
// value; only kit-generated markup wrapped in trusted() is inserted raw.

const TRUSTED = Symbol('mf-trusted-html');

export interface TrustedHtml {
  readonly [TRUSTED]: true;
  readonly value: string;
  toString(): string;
}

/** Mark kit-generated markup as safe to insert unescaped. Never pass user or agent text here. */
export function trusted(value: string): TrustedHtml {
  return { [TRUSTED]: true, value, toString: () => value };
}

export function isTrusted(value: unknown): value is TrustedHtml {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[TRUSTED] === true;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escape text for element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (char) => ESCAPES[char] ?? char);
}

function insert(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (isTrusted(value)) return value.value;
  if (Array.isArray(value)) return value.map(insert).join('');
  return escapeHtml(value);
}

/** Tagged template: html`<p class="x">${text}</p>` escapes `text`; nested html`` and trusted() stay raw. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): TrustedHtml {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += insert(value) + (strings[i + 1] ?? '');
  });
  return trusted(out);
}

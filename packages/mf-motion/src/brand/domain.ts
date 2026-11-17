// Brand ids: the registrable domain of a captured URL (dots kept), or a slug.

/** Two-label public suffixes common enough to matter; anything else uses the last two labels. */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'com.mx',
  'co.in', 'co.id', 'co.za', 'com.sg', 'com.tr', 'com.cn', 'com.hk', 'com.tw', 'co.kr', 'com.ar', 'com.my', 'com.ph', 'co.il', 'com.ua',
]);

export const BRAND_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

/** The registrable domain of a URL's host: www.tessarine.example -> tessarine.example. */
export function registrableDomain(url: string): string {
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return host.replace(/[:.]/g, '-');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** Kebab slug for --name brands. */
export function brandSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/[-.]{2,}/g, '-')
    .slice(0, 96);
}

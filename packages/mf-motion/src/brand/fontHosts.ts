// Hosts that serve fonts under subscription web-font licences. A font file
// fetched from one of these (or a page that loads from one) is marked
// `commercial-webfont`: licensed for websites, usually not for video.
// Data, not logic: extend the list when a service is missing.

export const COMMERCIAL_FONT_HOSTS: ReadonlyArray<{ host: string; service: string }> = [
  { host: 'use.typekit.net', service: 'Adobe Fonts' },
  { host: 'p.typekit.net', service: 'Adobe Fonts' },
  { host: 'typekit.net', service: 'Adobe Fonts' },
  { host: 'fast.fonts.net', service: 'Monotype Fonts' },
  { host: 'fonts.net', service: 'Monotype Fonts' },
  { host: 'fonts.monotype.com', service: 'Monotype Fonts' },
  { host: 'cloud.typography.com', service: 'Hoefler&Co Cloud.typography' },
  { host: 'cloud.webtype.com', service: 'Webtype' },
  { host: 'webfonts.fontstand.com', service: 'Fontstand' },
  { host: 'fonts.typotheque.com', service: 'Typotheque' },
  { host: 'fonts.typenetwork.com', service: 'Type Network' },
  { host: 'hello.myfonts.net', service: 'MyFonts' },
  { host: 'myfonts.net', service: 'MyFonts' },
  { host: 'f.fontdeck.com', service: 'Fontdeck' },
  { host: 'fnt.webink.com', service: 'WebINK' },
];

/** The commercial service behind a URL's host, or null. */
export function commercialHost(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url, 'https://local.invalid/').hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = COMMERCIAL_FONT_HOSTS.find((entry) => host === entry.host || host.endsWith(`.${entry.host}`));
  return match ? match.service : null;
}

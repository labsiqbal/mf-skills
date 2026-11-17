// The font registry: bundled OFL families (inside the package) plus CJK and
// emoji families fetched into the cache, which scripts each covers, the
// @font-face CSS for a build, and the nearest OFL substitute for a brand font.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { packageRoot } from '../engine/pins';
import { cache as cacheDir } from '../paths/index';
import { type FontInfo, readFont } from './opentype';

export type Script = 'Latin' | 'Cyrillic' | 'Greek' | 'Arabic' | 'Devanagari' | 'Han' | 'Hiragana' | 'Katakana' | 'Hangul' | 'Bopomofo' | 'Emoji';

export type Classification = 'sans' | 'serif' | 'mono' | 'emoji';

interface FamilySpec {
  id: string;
  name: string;
  files: string[];
  scripts: Script[];
  classification: Classification;
  source: 'bundled' | 'fetched';
  /** Fetch group for `doctor --fix --fonts`. */
  group?: 'cjk' | 'emoji';
}

/** Bundled families (assets/fonts/<id>/) and fetchable families (<cache>/fonts/<id>/). */
export const FAMILY_SPECS: readonly FamilySpec[] = [
  { id: 'inter', name: 'Inter', files: ['Inter[opsz,wght].ttf', 'Inter-Italic[opsz,wght].ttf'], scripts: ['Latin', 'Cyrillic', 'Greek'], classification: 'sans', source: 'bundled' },
  { id: 'noto-sans', name: 'Noto Sans', files: ['NotoSans[wdth,wght].ttf'], scripts: ['Latin', 'Cyrillic', 'Greek'], classification: 'sans', source: 'bundled' },
  { id: 'noto-serif', name: 'Noto Serif', files: ['NotoSerif[wdth,wght].ttf'], scripts: ['Latin', 'Cyrillic', 'Greek'], classification: 'serif', source: 'bundled' },
  { id: 'noto-sans-mono', name: 'Noto Sans Mono', files: ['NotoSansMono[wdth,wght].ttf'], scripts: ['Latin', 'Cyrillic', 'Greek'], classification: 'mono', source: 'bundled' },
  { id: 'noto-sans-arabic', name: 'Noto Sans Arabic', files: ['NotoSansArabic[wdth,wght].ttf'], scripts: ['Arabic'], classification: 'sans', source: 'bundled' },
  { id: 'noto-naskh-arabic', name: 'Noto Naskh Arabic', files: ['NotoNaskhArabic[wght].ttf'], scripts: ['Arabic'], classification: 'serif', source: 'bundled' },
  { id: 'noto-sans-devanagari', name: 'Noto Sans Devanagari', files: ['NotoSansDevanagari[wdth,wght].ttf'], scripts: ['Devanagari'], classification: 'sans', source: 'bundled' },
  { id: 'noto-sans-sc', name: 'Noto Sans SC', files: ['NotoSansSC[wght].ttf'], scripts: ['Han', 'Bopomofo'], classification: 'sans', source: 'fetched', group: 'cjk' },
  { id: 'noto-sans-tc', name: 'Noto Sans TC', files: ['NotoSansTC[wght].ttf'], scripts: ['Han', 'Bopomofo'], classification: 'sans', source: 'fetched', group: 'cjk' },
  { id: 'noto-sans-jp', name: 'Noto Sans JP', files: ['NotoSansJP[wght].ttf'], scripts: ['Han', 'Hiragana', 'Katakana'], classification: 'sans', source: 'fetched', group: 'cjk' },
  { id: 'noto-sans-kr', name: 'Noto Sans KR', files: ['NotoSansKR[wght].ttf'], scripts: ['Han', 'Hangul'], classification: 'sans', source: 'fetched', group: 'cjk' },
  { id: 'noto-color-emoji', name: 'Noto Color Emoji', files: ['NotoColorEmoji-Regular.ttf'], scripts: ['Emoji'], classification: 'emoji', source: 'fetched', group: 'emoji' },
];

export interface Family extends FamilySpec {
  /** Absolute paths of the installed files. */
  paths: string[];
  installed: boolean;
}

export interface RegistryOptions {
  /** mf-motion cache root (fetched fonts live in <cache>/fonts). */
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function bundledFontsDir(): string {
  return path.join(packageRoot(), 'assets', 'fonts');
}

export function fetchedFontsDir(options: RegistryOptions = {}): string {
  return path.join(options.cacheDir ?? cacheDir({ env: options.env ?? process.env }), 'fonts');
}

/** Every known family with its install state. Fetched files count only when their size matches the manifest. */
export function families(options: RegistryOptions = {}): Family[] {
  const bundled = bundledFontsDir();
  const fetched = fetchedFontsDir(options);
  const sizes = new Map(fetchManifest().map((entry) => [entry.id, entry.bytes]));
  return FAMILY_SPECS.map((spec) => {
    const dir = path.join(spec.source === 'bundled' ? bundled : fetched, spec.id);
    const paths = spec.files.map((file) => path.join(dir, file));
    const installed = paths.every((file) => {
      if (!existsSync(file)) return false;
      if (spec.source === 'bundled') return true;
      return statSync(file).size === sizes.get(spec.id);
    });
    return { ...spec, paths, installed };
  });
}

export interface ManifestEntry {
  id: string;
  url: string;
  sha256: string;
  bytes: number;
}

export function fetchManifest(): ManifestEntry[] {
  return JSON.parse(readFileSync(path.join(bundledFontsDir(), 'fetch-manifest.json'), 'utf8')) as ManifestEntry[];
}

/** The script of one character, or null for characters every font has (spaces, digits, punctuation, marks). */
export function scriptOf(char: string): Script | null {
  if (/\p{Extended_Pictographic}/u.test(char) && !/[0-9#*]/.test(char)) return 'Emoji';
  if (/\p{Script=Latin}/u.test(char)) return 'Latin';
  if (/\p{Script=Cyrillic}/u.test(char)) return 'Cyrillic';
  if (/\p{Script=Greek}/u.test(char)) return 'Greek';
  if (/\p{Script=Arabic}/u.test(char)) return 'Arabic';
  if (/\p{Script=Devanagari}/u.test(char)) return 'Devanagari';
  if (/\p{Script=Han}/u.test(char)) return 'Han';
  if (/\p{Script=Hiragana}/u.test(char)) return 'Hiragana';
  if (/\p{Script=Katakana}/u.test(char)) return 'Katakana';
  if (/\p{Script=Hangul}/u.test(char)) return 'Hangul';
  if (/\p{Script=Bopomofo}/u.test(char)) return 'Bopomofo';
  if (/[\p{Script=Common}\p{Script=Inherited}]/u.test(char)) return null;
  // Scripts no mf-motion font covers are reported by name.
  for (const [name, pattern] of OTHER_SCRIPTS) if (pattern.test(char)) return name as Script;
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}` as Script;
}

const OTHER_SCRIPTS: Array<[string, RegExp]> = [
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Tamil', /\p{Script=Tamil}/u],
  ['Telugu', /\p{Script=Telugu}/u],
  ['Gujarati', /\p{Script=Gujarati}/u],
  ['Gurmukhi', /\p{Script=Gurmukhi}/u],
  ['Kannada', /\p{Script=Kannada}/u],
  ['Malayalam', /\p{Script=Malayalam}/u],
  ['Sinhala', /\p{Script=Sinhala}/u],
  ['Khmer', /\p{Script=Khmer}/u],
  ['Lao', /\p{Script=Lao}/u],
  ['Myanmar', /\p{Script=Myanmar}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
  ['Tibetan', /\p{Script=Tibetan}/u],
];

/** Han text by language: Japanese and Korean faces before Chinese ones when the text says so. */
function hanPreference(language: string | undefined, scripts: Set<string>): string[] {
  if (scripts.has('Hiragana') || scripts.has('Katakana') || language?.startsWith('ja')) return ['noto-sans-jp', 'noto-sans-sc', 'noto-sans-tc', 'noto-sans-kr'];
  if (scripts.has('Hangul') || language?.startsWith('ko')) return ['noto-sans-kr', 'noto-sans-sc', 'noto-sans-tc', 'noto-sans-jp'];
  if (scripts.has('Bopomofo') || /^zh-(Hant|TW|HK|MO)/i.test(language ?? '')) return ['noto-sans-tc', 'noto-sans-sc', 'noto-sans-jp', 'noto-sans-kr'];
  return ['noto-sans-sc', 'noto-sans-tc', 'noto-sans-jp', 'noto-sans-kr'];
}

export interface Coverage {
  /** Scripts found in the text, in first-seen order. */
  scripts: string[];
  /** Installed family ids that together cover the text, in fallback order. */
  stack: string[];
  /** Scripts no installed family covers. */
  missing: string[];
  /** The `doctor --fix --fonts` groups that would add the missing scripts. */
  fetch: Array<'cjk' | 'emoji'>;
}

/** The family stack that covers every character of `text` with installed fonts. */
export function coverFor(text: string, options: RegistryOptions & { primary?: string; language?: string } = {}): Coverage {
  const all = families(options);
  const installed = all.filter((family) => family.installed);
  const scripts: string[] = [];
  for (const char of text) {
    const script = scriptOf(char);
    if (script && !scripts.includes(script)) scripts.push(script);
  }
  const set = new Set(scripts);
  const primary = options.primary ?? 'inter';
  const stack: string[] = [];
  const missing: string[] = [];
  const fetch = new Set<'cjk' | 'emoji'>();
  const add = (id: string) => {
    if (!stack.includes(id)) stack.push(id);
  };
  add(primary);
  for (const script of scripts) {
    const order =
      script === 'Han' || script === 'Hiragana' || script === 'Katakana' || script === 'Hangul' || script === 'Bopomofo'
        ? hanPreference(options.language, set)
        : all.filter((family) => family.scripts.includes(script as Script)).map((family) => family.id);
    const primaryCovers = all.find((family) => family.id === primary)?.scripts.includes(script as Script) ?? false;
    if (primaryCovers) continue;
    const found = order.find((id) => installed.some((family) => family.id === id && family.scripts.includes(script as Script)));
    if (found) {
      add(found);
      continue;
    }
    missing.push(script);
    const group = all.find((family) => family.scripts.includes(script as Script))?.group;
    if (group) fetch.add(group);
  }
  return { scripts, stack, missing, fetch: [...fetch] };
}

/** Throw FONT_SCRIPT_MISSING when some script of `text` has no installed font. */
export function assertCover(text: string, options: RegistryOptions & { primary?: string; language?: string } = {}): Coverage {
  const coverage = coverFor(text, options);
  if (coverage.missing.length > 0) {
    const groups = coverage.fetch.length > 0 ? coverage.fetch.join(',') : 'cjk';
    throw new MfmError('FONT_SCRIPT_MISSING', { missing: coverage.missing, fetch: coverage.fetch }, {
      message: `No installed font covers ${coverage.missing.join(', ')} in this copy.`,
      hint: `Run \`mf-motion doctor --fix --fonts ${groups}\` to add the fallback fonts.`,
      next: [`mf-motion doctor --fix --fonts ${groups} --json`],
    });
  }
  return coverage;
}

const GENERIC: Record<Classification, string> = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', emoji: 'sans-serif' };

/** The brand's font for one role, as brand.json stores it (files relative to the brand folder). */
export interface BrandFontRole {
  family: string;
  weight: number;
  files: Array<{ path: string; weight: string; style: 'normal' | 'italic'; axes: string | null }>;
  fallback: string;
}

export interface FaceCss {
  /** @font-face rules. */
  css: string;
  /** CSS font-family value: the role face, then the fallback chain. */
  fontFamily: string;
  /** build-relative paths of the copied files. */
  files: string[];
}

function cssString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function descriptors(info: FontInfo, declared: { weight?: string; style?: string }): string[] {
  const lines: string[] = [];
  const wght = info.axes.find((axis) => axis.tag === 'wght');
  const wdth = info.axes.find((axis) => axis.tag === 'wdth');
  const slnt = info.axes.find((axis) => axis.tag === 'slnt');
  lines.push(`font-weight: ${wght ? `${wght.min} ${wght.max}` : (declared.weight ?? String(info.weightClass))};`);
  if (wdth) lines.push(`font-stretch: ${wdth.min}% ${wdth.max}%;`);
  const italic = declared.style === 'italic' || info.italic;
  lines.push(`font-style: ${italic ? 'italic' : slnt ? `oblique ${-slnt.max}deg ${-slnt.min}deg` : 'normal'};`);
  return lines;
}

/**
 * Copy the faces of one role into `<build>/assets/fonts/` and return
 * @font-face rules (font-display: block, axis ranges from fvar) plus the
 * fallback chain covering `options.text`.
 */
export function faceCss(
  role: 'display' | 'heading' | 'body' | 'mono',
  brandFont: BrandFontRole | null,
  buildDir: string,
  options: RegistryOptions & { brandDir?: string; text?: string; language?: string } = {},
): FaceCss {
  const all = families(options);
  const fontsDir = path.join(buildDir, 'assets', 'fonts');
  mkdirSync(fontsDir, { recursive: true });
  const rules: string[] = [];
  const copied: string[] = [];
  const emit = (cssFamily: string, file: string, declared: { weight?: string; style?: string }, name: string) => {
    const info = readFont(readFileSync(file));
    copyFileSync(file, path.join(fontsDir, name));
    copied.push(`assets/fonts/${name}`);
    rules.push(
      [`@font-face {`, `  font-family: ${cssString(cssFamily)};`, `  src: url('assets/fonts/${encodeURI(name)}');`, ...descriptors(info, declared).map((line) => `  ${line}`), `  font-display: block;`, `}`].join('\n'),
    );
  };
  const roleFamily = `mf-${role}`;
  let primary = role === 'mono' ? 'noto-sans-mono' : 'inter';
  if (brandFont && brandFont.files.length > 0) {
    if (!options.brandDir) throw new Error('faceCss needs brandDir to copy brand font files');
    brandFont.files.forEach((file, i) => {
      const source = path.resolve(options.brandDir ?? '', file.path);
      emit(roleFamily, source, { weight: file.weight, style: file.style }, `${role}-${i}${path.extname(file.path)}`);
    });
    primary = brandFont.fallback;
  }
  const coverage = coverFor(options.text ?? '', { ...options, primary });
  const chain: string[] = brandFont && brandFont.files.length > 0 ? [roleFamily] : [];
  for (const id of coverage.stack) {
    const family = all.find((candidate) => candidate.id === id);
    if (!family || !family.installed) continue;
    const cssFamily = `mf-${family.id}`;
    family.paths.forEach((file, i) => emit(cssFamily, file, {}, `${family.id}-${i}${path.extname(file)}`));
    chain.push(cssFamily);
  }
  const generic = GENERIC[all.find((family) => family.id === primary)?.classification ?? (role === 'mono' ? 'mono' : 'sans')];
  return { css: `${rules.join('\n')}\n`, fontFamily: [...chain.map(cssString), generic].join(', '), files: copied };
}

export interface OflChoice {
  id: 'inter' | 'noto-sans' | 'noto-serif' | 'noto-sans-mono';
  inputs: { family: string; monospace: boolean; serif: boolean; xHeightRatio: number | null; widthClass: number; panose: number[] };
}

const SERIF_TOKENS = /serif|garamond|times|georgia|roman|caslon|baskerville|bodoni|didot|palatino|antiqua|merriweather|playfair|lora|slab|book/i;
const MONO_TOKENS = /mono|code|courier|consol|terminal|typewriter/i;

/** The nearest bundled OFL family for a font file: serif, monospace, then sans by x-height. */
export function nearestOfl(fontFile: string): OflChoice {
  const info = readFont(readFileSync(fontFile));
  const name = `${info.typographicFamily} ${info.fullName}`;
  const latinPanose = info.panose[0] === 2;
  const monospace = info.isFixedPitch || (latinPanose && info.panose[3] === 9) || MONO_TOKENS.test(name);
  const serifStyle = info.panose[1] ?? 0;
  const panoseSays = latinPanose && serifStyle >= 2 && serifStyle <= 15 ? (serifStyle <= 10 ? 'serif' : 'sans') : null;
  const serif = !monospace && (panoseSays === 'serif' || (panoseSays === null && SERIF_TOKENS.test(name) && !/sans/i.test(name)));
  const inputs = { family: info.typographicFamily, monospace, serif, xHeightRatio: info.xHeightRatio, widthClass: info.widthClass, panose: info.panose };
  if (monospace) return { id: 'noto-sans-mono', inputs };
  if (serif) return { id: 'noto-serif', inputs };
  return { id: (info.xHeightRatio ?? 0) >= 0.52 ? 'inter' : 'noto-sans', inputs };
}

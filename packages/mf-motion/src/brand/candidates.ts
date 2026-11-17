// Logo and shot candidates from a capture, numbered l1... and s1..., copied
// into brands/<id>/candidates/, and drawn on two sheets for the agent to pick from.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeOuter } from 'parse5';
import type { Engine } from '../engine/index';
import { type Element, ancestors, attr, elements, parseHtml } from '../lint/dom';
import { type Frame, frameAt } from '../media/pixels';
import { probe } from '../media/probe';
import { renderSheet } from '../media/sheet';
import { confine } from '../paths/index';
import { run } from '../proc/run';

/** brand.candidateMinPx (safe-zones-and-numbers.md). */
export const CANDIDATE_MIN = { width: 800, height: 400 } as const;
export const LOGO_ASPECT = { min: 0.5, max: 4.0 } as const;
export const LOGO_MAX_COLOURS = 6;
export const HASH_DUPLICATE_BITS = 6;
export const TRIM_PAD_PX = 8;

const RASTER = /\.(png|jpe?g|webp|gif)$/i;

export interface CandidateRequest {
  brandDir: string;
  captureDir: string;
  /** Brand ground colour, for the logo sheet. */
  ground: string;
  /** Local captures: the original page and the folder it may read. */
  local?: { file: string; root: string };
  engine?: Engine;
  browserPath?: string;
  onWarn?: (message: string) => void;
}

export interface Candidates {
  logos: string[];
  shots: string[];
  sheet: string | null;
  logoSheet: string | null;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** 64-bit average hash from a 16x16 grid (as 256 bits), or null when the file cannot be decoded. */
export async function averageHash(file: string): Promise<boolean[] | null> {
  let frame: Frame;
  try {
    frame = await frameAt(file, 0, { width: 64, format: 'gray' });
  } catch {
    return null;
  }
  const cells: number[] = [];
  for (let gy = 0; gy < 16; gy += 1) {
    for (let gx = 0; gx < 16; gx += 1) {
      let sum = 0;
      let count = 0;
      const x0 = Math.floor((gx * frame.width) / 16);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * frame.width) / 16));
      const y0 = Math.floor((gy * frame.height) / 16);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * frame.height) / 16));
      for (let y = y0; y < Math.min(y1, frame.height); y += 1) {
        for (let x = x0; x < Math.min(x1, frame.width); x += 1) {
          sum += frame.data[y * frame.width + x] ?? 0;
          count += 1;
        }
      }
      cells.push(count ? sum / count : 0);
    }
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  return cells.map((value) => value > mean);
}

export function hashDistance(a: boolean[], b: boolean[]): number {
  let distance = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

/** Remove near-duplicates (16x16 average-hash distance under 6); SVGs dedupe by content. */
export async function dedupe(files: string[]): Promise<string[]> {
  const kept: Array<{ file: string; hash: boolean[] | null; content: string | null }> = [];
  for (const file of files) {
    const svg = /\.svg$/i.test(file);
    const content = svg ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
    const hash = svg ? null : await averageHash(file);
    const duplicate = kept.some((other) => (content && other.content === content) || (hash && other.hash && hashDistance(hash, other.hash) < HASH_DUPLICATE_BITS));
    if (!duplicate) kept.push({ file, hash, content });
  }
  return kept.map((entry) => entry.file);
}

/** A logo-shaped image: aspect 0.5-4.0 and at most 6 colours covering visible area. */
export async function isLogoShaped(file: string): Promise<boolean> {
  try {
    const info = await probe(file);
    if (!info.video) return false;
    const aspect = info.video.width / info.video.height;
    if (aspect < LOGO_ASPECT.min || aspect > LOGO_ASPECT.max) return false;
    const frame = await frameAt(file, 0, { width: Math.min(256, info.video.width), format: 'rgba' });
    const counts = new Map<number, number>();
    let opaque = 0;
    for (let i = 0; i < frame.data.length; i += 4) {
      if ((frame.data[i + 3] ?? 0) <= 8) continue;
      opaque += 1;
      const key = ((frame.data[i] ?? 0) << 16) | ((frame.data[i + 1] ?? 0) << 8) | (frame.data[i + 2] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Colours needed to cover 95% of the visible area, merging anti-aliasing blends (RGB distance 28).
    const groups: Array<{ rgb: number[]; weight: number }> = [];
    for (const [key, weight] of [...counts].sort((a, b) => b[1] - a[1])) {
      const rgb = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
      const near = groups.find((group) => Math.hypot((group.rgb[0] ?? 0) - (rgb[0] ?? 0), (group.rgb[1] ?? 0) - (rgb[1] ?? 0), (group.rgb[2] ?? 0) - (rgb[2] ?? 0)) < 28);
      if (near) near.weight += weight;
      else if (groups.length <= LOGO_MAX_COLOURS * 4) groups.push({ rgb, weight });
      else return false;
    }
    groups.sort((a, b) => b.weight - a.weight);
    let covered = 0;
    let needed = 0;
    for (const group of groups) {
      if (covered >= 0.95 * opaque) break;
      covered += group.weight;
      needed += 1;
    }
    return opaque > 0 && covered >= 0.95 * opaque && needed <= LOGO_MAX_COLOURS;
  } catch {
    return false;
  }
}

/** Crop a raster logo to its ink box plus 8 px (alpha when present, else difference from the corner colour). */
async function trimRaster(source: string, target: string): Promise<void> {
  const info = await probe(source);
  const width = info.video?.width ?? 0;
  const height = info.video?.height ?? 0;
  if (!width || !height) {
    copyFileSync(source, target);
    return;
  }
  const frame = await frameAt(source, 0, { width: Math.min(width, 1024), format: 'rgba' });
  const scale = width / frame.width;
  const corner = [0, 1, 2, 3].map((c) => frame.data[c] ?? 0);
  const transparent = (corner[3] ?? 255) < 250;
  let x0 = frame.width;
  let y0 = frame.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const i = (y * frame.width + x) * 4;
      const ink = transparent
        ? (frame.data[i + 3] ?? 0) > 8
        : [0, 1, 2].some((c) => Math.abs((frame.data[i + c] ?? 0) - (corner[c] ?? 0)) > 24);
      if (!ink) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) {
    copyFileSync(source, target);
    return;
  }
  const left = Math.max(0, Math.floor(x0 * scale) - TRIM_PAD_PX);
  const top = Math.max(0, Math.floor(y0 * scale) - TRIM_PAD_PX);
  const right = Math.min(width, Math.ceil((x1 + 1) * scale) + TRIM_PAD_PX);
  const bottom = Math.min(height, Math.ceil((y1 + 1) * scale) + TRIM_PAD_PX);
  const result = await run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vf', `crop=${right - left}:${bottom - top}:${left}:${top}`, '-frames:v', '1', target], { timeoutMs: 120_000 });
  if (result.code !== 0) copyFileSync(source, target);
}

function inChrome(element: Element): boolean {
  const chain = [element, ...ancestors(element)];
  return chain.some((node) => ['header', 'footer', 'nav'].includes(node.tagName) || (node.tagName === 'a' && ['/', './', 'index.html', '#'].includes(attr(node, 'href') ?? '')));
}

/** File for an image URL: the original inside a local root, else the captured asset named after its alt text. */
function resolveImage(src: string, alt: string, request: CandidateRequest, captured: string[]): string | null {
  if (request.local) {
    try {
      const local = src.startsWith('file:') ? fileURLToPath(src) : path.resolve(path.dirname(request.local.file), src);
      const inside = confine(request.local.root, local);
      if (existsSync(inside)) return inside;
    } catch {
      // Outside the local root, or not a local path.
    }
  }
  const want = slug(alt || path.basename(src.split(/[?#]/)[0] ?? '').replace(/\.[a-z0-9]+$/i, ''));
  return captured.find((file) => slug(path.basename(file).replace(/\.[a-z0-9]+$/i, '')) === want) ?? null;
}

/** Collect, trim, de-duplicate and number the candidates, then draw both sheets. */
export async function buildCandidates(request: CandidateRequest): Promise<Candidates> {
  const outDir = path.join(request.brandDir, 'candidates');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const captured = walk(path.join(request.captureDir, 'assets')).filter((file) => !/contact-sheet/i.test(file));
  const pageFile = path.join(request.captureDir, 'extracted', 'page.html');
  const page = existsSync(pageFile) ? parseHtml(readFileSync(pageFile, 'utf8')) : null;
  const work = path.join(outDir, '.work');
  mkdirSync(work, { recursive: true });

  // Logos: inline SVGs and images in header, footer and nav; engine-flagged logo SVGs; icons; a logo-shaped og:image.
  const logoSources: string[] = [];
  if (page) {
    let n = 0;
    for (const element of elements(page)) {
      if (!inChrome(element)) continue;
      if (element.tagName === 'svg' && !ancestors(element).some((parent) => parent.tagName === 'svg')) {
        n += 1;
        let markup = serializeOuter(element as never);
        if (!/xmlns=/.test(markup.slice(0, 200))) markup = markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        const file = path.join(work, `inline-${n}.svg`);
        writeFileSync(file, markup);
        logoSources.push(file);
      }
      if (element.tagName === 'img') {
        const file = resolveImage(attr(element, 'src') ?? '', attr(element, 'alt') ?? '', request, captured);
        if (file) logoSources.push(file);
      }
    }
  }
  logoSources.push(...captured.filter((file) => /(^|\/)logo-[^/]*\.svg$/i.test(file.split(path.sep).join('/'))));
  const icons = JSON.parse(existsSync(path.join(request.captureDir, 'extracted', 'icons-manifest.json')) ? readFileSync(path.join(request.captureDir, 'extracted', 'icons-manifest.json'), 'utf8') : '{}') as {
    icons?: Array<{ file?: string }>;
  };
  for (const icon of icons.icons ?? []) {
    const file = icon.file ? path.join(request.captureDir, icon.file) : null;
    if (file && existsSync(file)) logoSources.push(file);
  }
  if (request.local) {
    const original = parseHtml(readFileSync(request.local.file, 'utf8'));
    for (const meta of elements(original).filter((element) => element.tagName === 'meta')) {
      if ((attr(meta, 'property') ?? attr(meta, 'name')) !== 'og:image') continue;
      const file = resolveImage(attr(meta, 'content') ?? '', '', request, []);
      if (file && (await isLogoShaped(file))) logoSources.push(file);
    }
  }
  const logos: string[] = [];
  for (const [i, source] of (await dedupe([...new Set(logoSources)])).entries()) {
    const ext = path.extname(source).toLowerCase() || '.png';
    const target = path.join(outDir, `l${i + 1}${RASTER.test(ext) ? '.png' : ext}`);
    if (RASTER.test(ext)) await trimRaster(source, target);
    else copyFileSync(source, target);
    logos.push(target);
  }

  // Shots: captured images at least 800x400, viewport screenshots, product video frames.
  const shotSources: string[] = [];
  const iconFiles = new Set((icons.icons ?? []).map((icon) => (icon.file ? path.join(request.captureDir, icon.file) : '')));
  for (const file of captured.filter((candidate) => RASTER.test(candidate) && !iconFiles.has(candidate) && !logoSources.includes(candidate))) {
    try {
      const info = await probe(file);
      if ((info.video?.width ?? 0) >= CANDIDATE_MIN.width && (info.video?.height ?? 0) >= CANDIDATE_MIN.height) shotSources.push(file);
    } catch {
      request.onWarn?.(`Skipped unreadable image ${path.basename(file)}`);
    }
  }
  shotSources.push(...walk(path.join(request.captureDir, 'screenshots')).filter((file) => /scroll-\d+\.png$/i.test(file)).sort());
  shotSources.push(...walk(path.join(request.captureDir, 'frames')).filter((file) => /\.png$/i.test(file)).sort());
  const shots: string[] = [];
  for (const [i, source] of (await dedupe(shotSources)).entries()) {
    const target = path.join(outDir, `s${i + 1}${path.extname(source).toLowerCase()}`);
    copyFileSync(source, target);
    shots.push(target);
  }
  rmSync(work, { recursive: true, force: true });

  const sheetOptions = { ...(request.engine ? { engine: request.engine } : {}), ...(request.browserPath ? { browserPath: request.browserPath } : {}) };
  const rel = (file: string) => path.relative(request.brandDir, file).split(path.sep).join('/');
  let sheet: string | null = null;
  let logoSheet: string | null = null;
  if (shots.length > 0) {
    sheet = path.join(request.brandDir, 'candidates-sheet.png');
    await renderSheet('candidates', shots.map((file, i) => ({ image: file, label: `s${i + 1}` })), sheet, { title: 'Shot candidates', ...sheetOptions });
  }
  if (logos.length > 0) {
    logoSheet = path.join(request.brandDir, 'logo-sheet.png');
    await renderSheet(
      'plates',
      logos.flatMap((file, i) => [
        { image: file, label: `l${i + 1}`, sublabel: 'on ground', plate: { color: request.ground } },
        { image: file, label: `l${i + 1}`, sublabel: 'on white', plate: { color: '#FFFFFF' } },
      ]),
      logoSheet,
      { title: 'Logo candidates', aspect: 2, columns: 4, cellWidth: 320, ...sheetOptions },
    );
  }
  return { logos: logos.map(rel), shots: shots.map(rel), sheet: sheet ? rel(sheet) : null, logoSheet: logoSheet ? rel(logoSheet) : null };
}

/// <reference lib="dom" />
// Contact sheets drawn by Chrome: a self-contained HTML grid (local images,
// labels in the bundled Inter when present, a system sans before that),
// screenshot as sRGB PNG with the long edge at most 4096 px; more cells start
// a new numbered sheet. No FFmpeg drawtext, which some builds lack.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Engine } from '../engine/index';
import { packageRoot } from '../engine/index';
import { screenshot, withPage } from './chrome';

export const SHEET_KINDS = ['candidates', 'dense', 'phone', 'plates', 'strip', 'board', 'brand-card'] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

export const SHEET_MAX_PX = 4096;

export interface SheetItem {
  /** Image file (PNG, JPEG, SVG). */
  image?: string;
  label?: string;
  sublabel?: string;
  /** brand-card swatch colour (#RRGGBB). */
  color?: string;
  /** plates: what the overlay frame is composited over. */
  plate?: { color?: string; image?: string };
  /** brand-card type specimen text. */
  text?: string;
  /** brand-card: which part of the card the item fills. */
  role?: 'logo' | 'swatch' | 'specimen';
}

export interface SheetOptions {
  title?: string;
  /** Width / height of each picture cell; default by kind. */
  aspect?: number;
  columns?: number;
  /** Picture width of a cell in px; default by kind. */
  cellWidth?: number;
  engine?: Engine;
  browserPath?: string;
}

export interface SheetResult {
  files: string[];
  cells: Array<{ sheet: string; label: string | null }>;
}

interface Layout {
  columns: number;
  cellWidth: number;
  aspect: number;
}

const LAYOUTS: Record<Exclude<SheetKind, 'brand-card'>, Layout> = {
  candidates: { columns: 4, cellWidth: 320, aspect: 16 / 10 },
  dense: { columns: 4, cellWidth: 320, aspect: 16 / 9 },
  phone: { columns: 6, cellWidth: 360, aspect: 9 / 16 },
  plates: { columns: 3, cellWidth: 400, aspect: 16 / 9 },
  strip: { columns: 8, cellWidth: 200, aspect: 16 / 9 },
  board: { columns: 3, cellWidth: 480, aspect: 16 / 9 },
};

const GAP = 12;
const PAD = 24;
const LABEL = 28;
const TITLE = 44;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeColor = (value: string | undefined) => (value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#808080');

/** The bundled Inter file, when the fonts are installed (a variable TTF or WOFF2 named Inter[...]). */
export function bundledInter(root = packageRoot()): string | null {
  const fonts = path.join(root, 'assets', 'fonts');
  if (!existsSync(fonts)) return null;
  const stack = [fonts];
  while (stack.length > 0) {
    const dir = stack.pop() ?? '';
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (/^Inter\[[^\]]*\]\.(ttf|woff2)$/.test(name)) return full;
    }
  }
  return null;
}

function fontCss(workDir: string): string {
  const inter = bundledInter();
  const fallback = "system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  if (!inter) return `--sheet-font: ${fallback};`;
  const file = `inter${path.extname(inter)}`;
  copyFileSync(inter, path.join(workDir, file));
  return `--sheet-font: 'SheetInter', ${fallback};
}
@font-face { font-family: 'SheetInter'; src: url('${file}'); font-weight: 100 900; font-display: block;`;
}

/** Copy an item's image into the page folder (pages may only load their own folder). */
function localImage(workDir: string, file: string | undefined, index: number, tag: string): string | null {
  if (!file) return null;
  const name = `${tag}-${index}${path.extname(file).toLowerCase() || '.png'}`;
  copyFileSync(file, path.join(workDir, name));
  return name;
}

function gridPage(kind: Exclude<SheetKind, 'brand-card'>, items: SheetItem[], start: number, layout: Layout, workDir: string, title: string | undefined) {
  const picW = layout.cellWidth;
  const picH = Math.round(picW / layout.aspect);
  const columns = Math.min(layout.columns, Math.max(1, items.length));
  const rows = Math.ceil(items.length / columns);
  const width = PAD * 2 + columns * picW + (columns - 1) * GAP;
  const height = PAD * 2 + (title ? TITLE : 0) + rows * (picH + LABEL) + (rows - 1) * GAP;
  const cells = items
    .map((item, i) => {
      const index = start + i;
      const image = localImage(workDir, item.image, index, 'img');
      let picture = image ? `<img src="${escapeHtml(image)}" alt="">` : '<div class="empty"></div>';
      if (kind === 'plates') {
        const plateImage = localImage(workDir, item.plate?.image, index, 'plate');
        const plate = plateImage
          ? `<img class="plate" src="${escapeHtml(plateImage)}" alt="">`
          : `<div class="plate" style="background:${safeColor(item.plate?.color)}"></div>`;
        picture = `${plate}${picture}`;
      }
      const label = item.label ?? (kind === 'candidates' ? String(index + 1) : '');
      const sub = item.sublabel ? `<span class="sub">${escapeHtml(item.sublabel)}</span>` : '';
      return `<figure><div class="pic">${picture}</div><figcaption><span class="label">${escapeHtml(label)}</span>${sub}</figcaption></figure>`;
    })
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${fontCss(workDir)} }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; background: #141414; color: #F2F2F2; font-family: var(--sheet-font); }
body { padding: ${PAD}px; }
h1 { height: ${TITLE}px; font-size: 20px; font-weight: 600; line-height: ${TITLE - 12}px; }
main { display: grid; grid-template-columns: repeat(${columns}, ${picW}px); gap: ${GAP}px; }
figure { width: ${picW}px; }
.pic { position: relative; width: ${picW}px; height: ${picH}px; background: ${kind === 'candidates' ? 'repeating-conic-gradient(#2A2A2A 0 25%, #1E1E1E 0 50%) 0 0 / 16px 16px' : '#000'}; overflow: hidden; }
.pic img, .pic .plate { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.pic .plate { object-fit: cover; }
figcaption { height: ${LABEL}px; display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 1; white-space: nowrap; overflow: hidden; }
.label { font-weight: 600; font-variant-numeric: tabular-nums; }
.sub { color: #A8A8A8; }
</style></head><body>${title ? `<h1>${escapeHtml(title)}</h1>` : ''}<main>
${cells}
</main></body></html>`;
  return { html, width, height };
}

function brandCardPage(items: SheetItem[], workDir: string, title: string | undefined) {
  const width = 1200;
  const logos = items.filter((item) => item.role === 'logo');
  const swatches = items.filter((item) => item.role === 'swatch');
  const specimens = items.filter((item) => item.role === 'specimen');
  const logoHtml = logos
    .map((item, i) => {
      const image = localImage(workDir, item.image, i, 'logo');
      return image ? `<div class="logo"><img src="${escapeHtml(image)}" alt=""><span>${escapeHtml(item.label ?? '')}</span></div>` : '';
    })
    .join('');
  const swatchHtml = swatches
    .map(
      (item) =>
        `<div class="swatch"><div class="chip" style="background:${safeColor(item.color)}"></div><span class="label">${escapeHtml(item.label ?? '')}</span><span class="sub">${escapeHtml(safeColor(item.color).toUpperCase())}</span></div>`,
    )
    .join('');
  const specimenHtml = specimens
    .map(
      (item) =>
        `<div class="specimen"><span class="sub">${escapeHtml(item.sublabel ?? '')}</span><p style="font-family:${escapeHtml(JSON.stringify(item.sublabel ?? ''))}, var(--sheet-font)">${escapeHtml(item.text ?? '')}</p></div>`,
    )
    .join('');
  const rows = Math.ceil(swatches.length / 6);
  const height = PAD * 2 + (title ? TITLE : 0) + (logos.length ? 200 : 0) + rows * 150 + specimens.length * 110 + 40;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${fontCss(workDir)} }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; background: #141414; color: #F2F2F2; font-family: var(--sheet-font); }
body { padding: ${PAD}px; display: flex; flex-direction: column; gap: 20px; }
h1 { font-size: 20px; font-weight: 600; }
.logos { display: flex; gap: 24px; height: 180px; }
.logo { flex: 1; background: repeating-conic-gradient(#2A2A2A 0 25%, #1E1E1E 0 50%) 0 0 / 16px 16px; position: relative; }
.logo img { position: absolute; inset: 16px 16px 32px; width: calc(100% - 32px); height: calc(100% - 48px); object-fit: contain; }
.logo span { position: absolute; left: 12px; bottom: 8px; font-size: 13px; color: #A8A8A8; }
.swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; }
.swatch { display: flex; flex-direction: column; gap: 6px; }
.chip { height: 88px; border-radius: 6px; border: 1px solid #3A3A3A; }
.label { font-size: 14px; font-weight: 600; }
.sub { font-size: 13px; color: #A8A8A8; font-variant-numeric: tabular-nums; }
.specimen p { font-size: 44px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
${logos.length ? `<div class="logos">${logoHtml}</div>` : ''}
<div class="swatches">${swatchHtml}</div>
${specimenHtml}
</body></html>`;
  return { html, width, height: Math.min(height, SHEET_MAX_PX) };
}

/** The file for sheet `n` (1-based): out, then out-2, out-3, ... */
export function numberedSheet(out: string, n: number): string {
  if (n === 1) return out;
  const ext = path.extname(out);
  return `${out.slice(0, out.length - ext.length)}-${n}${ext || '.png'}`;
}

/** How many cells fit on one sheet within the size limit. */
export function cellsPerSheet(layout: Layout, title: boolean): number {
  const picH = Math.round(layout.cellWidth / layout.aspect);
  const rows = Math.max(1, Math.floor((SHEET_MAX_PX - PAD * 2 - (title ? TITLE : 0) + GAP) / (picH + LABEL + GAP)));
  return rows * layout.columns;
}

/** Render a sheet of `kind` to `out` (PNG); overflow goes to numbered sheets. */
export async function renderSheet(kind: SheetKind, items: SheetItem[], out: string, options: SheetOptions = {}): Promise<SheetResult> {
  const workDir = mkdtempSync(path.join(tmpdir(), 'mfm-sheet-'));
  const result: SheetResult = { files: [], cells: [] };
  try {
    const pages: Array<{ html: string; width: number; height: number; labels: Array<string | null> }> = [];
    if (kind === 'brand-card') {
      pages.push({ ...brandCardPage(items, workDir, options.title), labels: items.map((item) => item.label ?? null) });
    } else {
      const base = LAYOUTS[kind];
      const layout: Layout = {
        columns: options.columns ?? base.columns,
        aspect: options.aspect ?? base.aspect,
        cellWidth: options.cellWidth ?? base.cellWidth,
      };
      // Keep the long edge within the limit: shrink cells when a row is too wide.
      const rowWidth = PAD * 2 + layout.columns * layout.cellWidth + (layout.columns - 1) * GAP;
      if (rowWidth > SHEET_MAX_PX) layout.cellWidth = Math.floor((SHEET_MAX_PX - PAD * 2 - (layout.columns - 1) * GAP) / layout.columns);
      const perSheet = cellsPerSheet(layout, Boolean(options.title));
      for (let start = 0; start < Math.max(1, items.length); start += perSheet) {
        const slice = items.slice(start, start + perSheet);
        pages.push({
          ...gridPage(kind, slice, start, layout, workDir, options.title),
          labels: slice.map((item, i) => item.label ?? (kind === 'candidates' ? String(start + i + 1) : null)),
        });
      }
    }
    for (const [i, page] of pages.entries()) {
      const entry = `sheet-${i + 1}.html`;
      writeFileSync(path.join(workDir, entry), page.html);
      const file = numberedSheet(out, i + 1);
      const png = await withPage(
        {
          dir: workDir,
          entry,
          width: page.width,
          height: page.height,
          composition: false,
          ...(options.engine ? { engine: options.engine } : {}),
          ...(options.browserPath ? { browserPath: options.browserPath } : {}),
        },
        async (driver) => {
          await driver.evaluate(async () => {
            await Promise.all(
              Array.from(document.images).map((image) =>
                image.complete
                  ? Promise.resolve()
                  : new Promise<void>((resolve) => {
                      image.addEventListener('load', () => resolve(), { once: true });
                      image.addEventListener('error', () => resolve(), { once: true });
                    }),
              ),
            );
          });
          // Fit the viewport to the content (the brand card's height depends on its parts).
          const contentHeight = await driver.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
          const height = Math.min(SHEET_MAX_PX, Math.max(1, contentHeight));
          if (height !== page.height) await driver.setViewport({ width: page.width, height, deviceScaleFactor: 1 });
          return screenshot(driver);
        },
      );
      writeFileSync(file, png);
      result.files.push(file);
      for (const label of page.labels) result.cells.push({ sheet: file, label });
    }
    return result;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

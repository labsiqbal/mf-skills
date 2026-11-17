// brand pick: turn the chosen candidates into stable files (logo, mark,
// shots/shot-<n>) and mark the brand picked.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { attr, elements, parseHtml } from '../lint/dom';
import { probe } from '../media/probe';
import { appendEvent, confine, homeLayout, lockFile, withLock } from '../paths/index';
import { run } from '../proc/run';
import { readDoc, writeDoc } from '../schemas/index';

/** brand.shots (safe-zones-and-numbers.md). */
export const PICK_SHOTS = { min: 3, max: 6 } as const;

export interface Asset {
  path: string;
  kind: 'svg' | 'png' | 'jpg' | 'mp4';
  w: number;
  h: number;
}

export interface PickRequest {
  home: string;
  id: string;
  logo: string;
  shots: string[];
  mark?: string;
  /** Open project, for the brand.picked event. */
  project?: string | null;
  onWarn?: (message: string) => void;
}

function svgSize(file: string): { w: number; h: number } {
  const svg = elements(parseHtml(readFileSync(file, 'utf8'))).find((element) => element.tagName === 'svg');
  const number = (value: string | undefined) => {
    const n = Number.parseFloat(value ?? '');
    return Number.isFinite(n) && n > 0 && !/%$/.test(value ?? '') ? n : null;
  };
  const box = (svg ? attr(svg, 'viewbox') ?? attr(svg, 'viewBox') : undefined)?.split(/[\s,]+/).map(Number);
  const w = number(svg ? attr(svg, 'width') : undefined) ?? (box && box.length === 4 ? (box[2] ?? 0) : 0);
  const h = number(svg ? attr(svg, 'height') : undefined) ?? (box && box.length === 4 ? (box[3] ?? 0) : 0);
  return { w: Math.max(1, Math.round(w || 100)), h: Math.max(1, Math.round(h || 100)) };
}

/** Copy one candidate to a stable name (rasters other than PNG/JPEG become PNG) and describe it. */
async function settle(source: string, targetBase: string): Promise<Asset> {
  const ext = path.extname(source).toLowerCase();
  mkdirSync(path.dirname(targetBase), { recursive: true });
  if (ext === '.svg') {
    copyFileSync(source, `${targetBase}.svg`);
    return { path: `${targetBase}.svg`, kind: 'svg', ...svgSize(source) };
  }
  let target: string;
  let kind: Asset['kind'];
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    kind = ext === '.png' ? 'png' : 'jpg';
    target = `${targetBase}.${kind}`;
    copyFileSync(source, target);
  } else if (ext === '.mp4') {
    kind = 'mp4';
    target = `${targetBase}.mp4`;
    copyFileSync(source, target);
  } else {
    kind = 'png';
    target = `${targetBase}.png`;
    const converted = await run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-frames:v', '1', target], { timeoutMs: 120_000 });
    if (converted.code !== 0) throw new MfmError('TOOL_FAILED', { file: source }, { message: `Could not convert ${path.basename(source)} to PNG.` });
  }
  const info = await probe(target);
  return { path: target, kind, w: info.video?.width ?? 1, h: info.video?.height ?? 1 };
}

function candidateFile(ids: string[], token: string, prefix: 'l' | 's', flag: string): string {
  const match = token.trim().match(new RegExp(`^${prefix}(\\d+)$`));
  const index = match ? Number(match[1]) - 1 : -1;
  const file = ids[index];
  if (!match || file === undefined) {
    throw new MfmError('USAGE', { flag, value: token, available: ids.length }, {
      message: `${flag} ${token} is not a candidate; this brand has ${prefix}1 to ${prefix}${ids.length}.`,
      hint: `Pick from the numbers on the ${prefix === 'l' ? 'logo' : 'candidates'} sheet.`,
    });
  }
  return file;
}

/** Pick a logo, optional mark and 3-6 shots for a captured brand. */
export async function pickBrand(request: PickRequest) {
  if (request.shots.length < PICK_SHOTS.min || request.shots.length > PICK_SHOTS.max) {
    throw new MfmError('USAGE', { flag: '--shots', count: request.shots.length }, {
      message: `Pick ${PICK_SHOTS.min} to ${PICK_SHOTS.max} shots; got ${request.shots.length}.`,
      hint: 'Pass --shots with 3 to 6 numbers from the candidates sheet, for example --shots s1,s3,s4.',
    });
  }
  const dir = confine(homeLayout(request.home).brands, request.id);
  const file = path.join(dir, 'brand.json');
  if (!existsSync(file)) throw new MfmError('BRAND_NOT_FOUND', { brand: request.id }, { next: ['mf-motion brand list --json'] });
  return withLock(
    lockFile(dir),
    async () => {
      const { doc } = readDoc('brand', file);
      const logoSource = confine(dir, candidateFile(doc.candidates.logos, request.logo, 'l', '--logo'));
      const markSource = request.mark ? confine(dir, candidateFile(doc.candidates.logos, request.mark, 'l', '--mark')) : null;
      const shotSources = request.shots.map((token) => ({ token, file: confine(dir, candidateFile(doc.candidates.shots, token, 's', '--shots')) }));
      for (const old of ['logo', 'mark']) for (const ext of ['svg', 'png', 'jpg', 'mp4']) rmSync(path.join(dir, `${old}.${ext}`), { force: true });
      rmSync(path.join(dir, 'shots'), { recursive: true, force: true });
      const rel = (asset: Asset): Asset => ({ ...asset, path: path.relative(dir, asset.path).split(path.sep).join('/') });
      const logo = rel(await settle(logoSource, path.join(dir, 'logo')));
      const mark = markSource ? rel(await settle(markSource, path.join(dir, 'mark'))) : null;
      const shots = [];
      for (const [i, shot] of shotSources.entries()) {
        const asset = rel(await settle(shot.file, path.join(dir, 'shots', `shot-${i + 1}`)));
        shots.push({ ...asset, from: path.relative(dir, shot.file).split(path.sep).join('/'), note: null });
      }
      writeDoc('brand', file, { ...doc, status: 'picked', logo, mark, shots });
      if (request.project) {
        appendEvent(request.project, {
          type: 'brand.picked',
          actor: 'cli',
          data: { brand: request.id, logo: request.logo, mark: request.mark ?? null, shots: request.shots },
        });
      }
      return { brand: { id: request.id, status: 'picked' as const, logo, mark, shots } };
    },
    { command: 'brand pick', ...(request.onWarn ? { onStale: request.onWarn } : {}) },
  );
}

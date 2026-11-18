import { copyFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import type { Warning } from '../cli/output';
import { readProfile } from '../cloud/consent';
import { ensureBrowser, ensureEngine, readOk } from '../engine/index';
import { appendEvent, confine, planHash, shellArg } from '../paths/index';
import type { ProjectDoc } from '../schemas/project';
import { outputName, placementBase, type Format, type Output } from './encode';
import { approvedPlacementHash, itemMode, overlayExportFor, placementFile, readPlacement, validatePlacement } from './placement';
import { renderMove } from './render';

interface RenderOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  cli: string;
  only: string[];
  gate: boolean;
  onProgress: (message: string) => void;
}

interface PlacedResult {
  id: string;
  move: string;
  outputs: Output[];
  verdict: string | null;
}

export async function renderPlaced(root: string, project: ProjectDoc, options: RenderOptions) {
  const approvedHash = approvedPlacementHash(root);
  const file = placementFile(root);
  const placement = readPlacement(file);
  const format = overlayExportFor(options.home);
  const problems = await validatePlacement(root, project, placement, format);
  if (!existsSync(file) || planHash(file) !== approvedHash) throw new MfmError('APPROVAL_STALE', { file }, { message: 'The plan changed while preparing the approved render.' });
  if (problems.length > 0) throw new MfmError('PLACEMENT_INVALID', { problems });

  const selected = new Set(options.only);
  const unknown = [...selected].filter((id) => !placement.items.some((item) => item.id === id));
  if (unknown.length > 0) throw new MfmError('USAGE', { ids: unknown }, { message: `Unknown placement ids: ${unknown.join(', ')}.` });
  const requested = selected.size > 0 ? placement.items.filter((item) => selected.has(item.id)) : placement.items;
  const brand = project.brand ?? readProfile(options.home).brand;
  if (!brand) throw new MfmError('BRAND_NOT_PICKED', { project: root }, { message: 'Pick a brand before rendering the placement.' });

  const engine = await ensureEngine(undefined, { env: options.env, onProgress: options.onProgress });
  const browserPath = readOk(engine.dir)?.browserPath ?? await ensureBrowser(engine, (chunk) => options.onProgress(chunk.trim()));
  if (!existsSync(file) || planHash(file) !== approvedHash) throw new MfmError('APPROVAL_STALE', { file }, { message: 'The plan changed while preparing the approved render.' });

  const items: PlacedResult[] = [];
  const warnings: Warning[] = [];
  const next: string[] = [];
  const started = Date.now();
  appendEvent(root, { type: 'render.started', actor: 'cli', data: { subject: 'placement', planHash: approvedHash, ids: requested.map((item) => item.id) } });
  for (const item of requested) {
    const mode = itemMode(placement, item);
    const formats: Format[] = mode === 'full' ? ['mp4'] : [format, 'mp4'];
    const out = confine(root, path.join('moves', item.id));
    const result = await renderMove({
      id: item.move, aspect: project.aspect, fps: project.fps, mode, brand, vars: item.vars, durationSec: item.durSec,
      engine, browserPath, out, home: options.home, formats, gate: options.gate, cli: options.cli, onProgress: options.onProgress,
    });
    const base = placementBase(item.at, placement.source.fps, item.move, mode);
    const outputs = result.outputs.map((output) => {
      if (output.format === 'png') throw new MfmError('INTERNAL', { item: item.id }, { message: 'A placed render returned an unexpected PNG master.' });
      const name = output.format === 'mp4' && mode !== 'full' ? `${base}-preview.mp4` : outputName(output.format, base, mode);
      const target = path.join(out, name);
      renameSync(output.path, target);
      return { ...output, path: target };
    });
    if (mode === 'full') {
      const primary = outputs[0];
      if (!primary) throw new MfmError('INTERNAL', { item: item.id }, { message: 'A placed b-roll render returned no MP4.' });
      const preview = path.join(out, `${base}-preview.mp4`);
      copyFileSync(primary.path, preview);
      outputs.push({ ...primary, path: preview });
    }
    for (const output of outputs) {
      if (output.keyPurity && !output.keyPurity.pass) {
        warnings.push({ code: 'HARD_FAILURES', message: `${path.basename(output.path)}: ${output.keyPurity.impurePixels} background pixels are off the key colour.`, details: { id: item.id } });
      }
    }
    if (result.gate && result.gate.level === null) {
      next.push(`Judge the packet in ${result.gate.packet.dir}, write ${path.join(result.gate.round, 'scores.json')}, then run mf-motion moves render --project ${shellArg(root)} --only ${item.id} --gate --json.`);
    }
    items.push({ id: item.id, move: item.move, outputs, verdict: result.verdict });
  }
  appendEvent(root, {
    type: 'render.finished', actor: 'cli', durationMs: Date.now() - started,
    data: { subject: 'placement', planHash: approvedHash, ids: items.map((item) => item.id) },
  });
  const exitCode: 0 | 1 = warnings.length > 0 || items.some((item) => item.verdict === 'FAIL') ? 1 : 0;
  return { items, warnings, next, exitCode };
}

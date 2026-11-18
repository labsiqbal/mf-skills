import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import whisperManifest from '../../assets/models/manifest.json';
import { isMfmError, MfmError } from '../cli/errors';
import { assertPrivateCache, transcribe as engineTranscribe, type Engine } from '../engine/index';
import { confine } from '../paths/index';
import { parseDoc, readDoc } from '../schemas/index';

type Transcript = ReturnType<typeof readDoc<'transcript'>>['doc'];
type Word = Transcript['words'][number];
type Line = Transcript['lines'][number];
const models: Record<string, { bytes: number; sha256: string }> = whisperManifest.models;

export const WHISPER_FIX = 'mf-motion doctor --fix --transcribe';
export const WHISPER_DEFAULTS = ['small', 'base.en'] as const;

export function whisperModel(language: string | undefined, requested?: string): string {
  const selected = requested ?? (language === 'en' ? 'base.en' : 'small');
  // Whisper switches English-only models to their multilingual counterpart for non-English input.
  const model = language && language !== 'en' ? selected.replace(/\.en$/, '') : selected;
  if (!Object.hasOwn(models, model) || !Object.hasOwn(models, selected)) {
    throw new MfmError('USAGE', { model: selected, supported: Object.keys(models) }, { message: 'Choose a Whisper model pinned in the model manifest.' });
  }
  return model;
}

/** Return the model path when present and verified. A bad copy is removed before returning the error. */
export async function verifiedWhisperModel(engine: Engine, id: string): Promise<string | null> {
  if (!Object.hasOwn(models, id) || engine.version !== whisperManifest.hyperframes) {
    throw new MfmError('USAGE', { model: id, engine: engine.version }, { message: 'This Whisper model is not pinned for the installed engine.' });
  }
  assertPrivateCache(engine.dir);
  const pin = models[id]!;
  const modelsDir = confine(engine.dir, path.join('hf-cache', 'whisper', 'models'));
  const file = path.join(modelsDir, `ggml-${id}.bin`);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  let digest: string | null = null;
  if (stat.isFile() && stat.size === pin.bytes) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    digest = hash.digest('hex');
  }
  if (digest !== pin.sha256) {
    rmSync(file, { force: true });
    throw new MfmError('MODEL_HASH_MISMATCH', { model: id, file, expected: pin.sha256, actual: digest }, { next: [WHISPER_FIX] });
  }
  return file;
}

function missingWhisper(model: string, part: 'model' | 'runtime') {
  return new MfmError('ENGINE_MISSING', { model, component: part }, {
    message: `Whisper ${part} is missing${part === 'model' ? ` for ${model}` : ''}.`,
    hint: `Run ${WHISPER_FIX}.`,
    next: [WHISPER_FIX],
  });
}

export async function callWhisper(
  engine: Engine,
  file: string,
  options: { model: string; language?: string; cwd: string; parent: NodeJS.ProcessEnv; runtimeInstall?: boolean },
): Promise<unknown> {
  const before = await verifiedWhisperModel(engine, options.model);
  // The pinned engine disables runtime installation separately from model downloads.
  if (!before && !options.runtimeInstall) throw missingWhisper(options.model, 'model');
  let result: unknown;
  try {
    result = await engineTranscribe(engine, file, { ...options, engine: 'whisper' });
  } catch (error) {
    if (isMfmError(error) && error.details.engineCode === 'whisper_unavailable') {
      throw missingWhisper(options.model, 'runtime');
    }
    if (isMfmError(error) && String(error.details.engineMessage).includes('did not match its pinned size and sha256')) {
      throw new MfmError('MODEL_HASH_MISMATCH', { model: options.model, engineMessage: error.details.engineMessage }, { next: [WHISPER_FIX] });
    }
    throw error;
  }
  if (!before && !(await verifiedWhisperModel(engine, options.model))) throw missingWhisper(options.model, 'model');
  return result;
}

const endOfSentence = /[.!?。！？][”’"'»）)]*$/u;

export function transcriptLines(words: readonly Word[]): Line[] {
  const lines: Line[] = [];
  let current: Line | undefined;
  for (const word of words) {
    const parts = Array.from(word.w);
    for (let offset = 0; offset < parts.length; offset += 42) {
      const text = parts.slice(offset, offset + 42).join('');
      const length = Array.from(current?.text ?? '').length;
      if (!current || length + 1 + Array.from(text).length > 42 || word.start - current.end > 0.6 || endOfSentence.test(current.text)) {
        current = { text, start: word.start, end: word.end };
        lines.push(current);
      } else {
        current.text += ` ${text}`;
        current.end = Math.max(current.end, word.end);
      }
    }
  }
  return lines;
}

const CUE_TIME = /^(?:(\d+):)?([0-5]\d):([0-5]\d)[,.](\d{3})$/;
function timestamp(raw: string): number {
  const match = CUE_TIME.exec(raw);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : NaN;
}

function captionWords(file: string): Word[] {
  const blocks = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/);
  const words: Word[] = [];
  for (const block of blocks) {
    const rows = block.split('\n');
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(rows[0] ?? '')) continue;
    const timing = rows.findIndex((line) => line.includes('-->'));
    if (timing === -1) throw new MfmError('SCHEMA_INVALID', { file }, { message: 'A subtitle cue has no timestamp.' });
    const times = rows[timing]!.trim().match(/^(\S+)\s+-->\s+(\S+)/);
    const start = timestamp(times?.[1] ?? '');
    const end = timestamp(times?.[2] ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new MfmError('SCHEMA_INVALID', { file }, { message: 'A subtitle cue has invalid timestamps.' });
    }
    const text = rows.slice(timing + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    const parts = text.match(/\S+/gu) ?? [];
    const lengths = parts.map((word) => Array.from(word).length);
    const total = lengths.reduce((sum, size) => sum + size, 0);
    let used = 0;
    for (const [index, w] of parts.entries()) {
      const at = start + (end - start) * used / total;
      used += lengths[index]!;
      words.push({ w, start: at, end: start + (end - start) * used / total, conf: 1 });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

function document(words: Word[], language: string, engine: string, model: string, file: string): Transcript {
  return parseDoc('transcript', { schemaVersion: 1, kind: 'transcript', language, engine, model, words, lines: transcriptLines(words) }, file).doc;
}

export function importTranscript(file: string, language: string): Transcript {
  const format = path.extname(file).toLowerCase();
  if (format === '.json') {
    const { doc } = readDoc('transcript', file);
    return { ...doc, lines: transcriptLines(doc.words) };
  }
  if (format !== '.srt' && format !== '.vtt') throw new MfmError('USAGE', { file }, { message: 'Choose an SRT, VTT or JSON transcript.' });
  return document(captionWords(file), language, 'user', format.slice(1), file);
}

export async function transcribeFootage(
  engine: Engine,
  file: string,
  cwd: string,
  language: string,
  model: string | undefined,
  parent: NodeJS.ProcessEnv,
): Promise<Transcript> {
  const base = new Intl.Locale(language).language;
  const selected = whisperModel(base === 'und' ? undefined : base, model);
  const result = await callWhisper(engine, file, { model: selected, ...(base === 'und' ? {} : { language: base }), cwd, parent });
  const meta = result as { transcriptPath?: string; detectedLanguage?: string } | null;
  if (typeof meta?.transcriptPath !== 'string') throw new MfmError('ENGINE_OUTPUT_UNPARSEABLE', { command: 'transcribe' });
  const transcript = confine(cwd, meta.transcriptPath);
  const raw: unknown = JSON.parse(readFileSync(transcript, 'utf8'));
  if (!Array.isArray(raw)) throw new MfmError('ENGINE_OUTPUT_UNPARSEABLE', { command: 'transcribe', file: transcript });
  const words = (raw as Array<{ text: string; start: number; end: number; confidence?: number }>).map((part) => ({
    w: part.text, start: part.start, end: part.end, conf: part.confidence ?? 0,
  }));
  return document(words, meta.detectedLanguage ?? language, 'whisper', selected, transcript);
}

import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { cache, confine, findProjectRoot, lockFile, projectFile, readEvents, readProject, withLock, writeJsonAtomic } from '../../paths/index';
import { engineDirFor, enginePins, engineReady } from '../../engine/index';
import { normaliseFootage } from '../../moves/footage';
import { importTranscript, transcribeFootage, WHISPER_FIX } from '../../moves/transcribe';
import { MfmError } from '../errors';
import { CLI_VERSION, defineCommand } from '../registry';

function localFile(cwd: string, input: string, flag: string): string {
  const file = path.resolve(cwd, input);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new MfmError('USAGE', { flag, file }, { message: `File not found: ${file}.` });
  }
  return file;
}

function languageTag(value: string): string {
  try {
    return new Intl.Locale(value).toString();
  } catch {
    throw new MfmError('USAGE', { flag: '--language', value }, { message: 'Use a BCP 47 language tag such as en, pt-BR or und.' });
  }
}

export const transcribeCommand = defineCommand({
  name: 'transcribe',
  summary: 'Normalize moves footage to constant frame rate and write a word-timed transcript.',
  flags: {
    footage: { type: 'string', value: '<file>', description: 'talking-head video file' },
    transcript: { type: 'string', value: '<srt|vtt|json>', description: 'import this transcript without running speech recognition' },
    language: { type: 'string', value: '<bcp47>', description: 'spoken language, or und to detect it' },
    model: { type: 'string', value: '<id>', description: 'override the installed Whisper model' },
  },
  dataSchema: {
    type: 'object',
    required: ['footage', 'transcript', 'words', 'lines'],
    properties: {
      footage: {
        type: 'object', required: ['path', 'fps', 'vfrFixed'],
        properties: { path: { type: 'string' }, fps: { type: 'string' }, vfrFixed: { type: 'boolean' } },
      },
      transcript: { type: 'string' },
      words: { type: 'integer' },
      lines: { type: 'integer' },
    },
  },
  async handler({ flags, cwd, env, global, log }) {
    const root = findProjectRoot(cwd, global.project);
    return withLock(confine(root, lockFile(root)), async () => {
      const project = readProject(root, CLI_VERSION);
      if (project.type !== 'moves') throw new MfmError('USAGE', { project: root }, { message: 'Transcription is for moves projects.' });
      const language = languageTag(flags.language ?? 'und');
      const media = confine(root, 'media');
      const probePath = path.join(media, 'probe.json');
      const transcriptPath = path.join(media, 'transcript.json');
      const projectPath = confine(root, projectFile(root));
      const fromEvent = readEvents(root).find(event => event.type === 'project.created')?.data.footage;
      let prior: { output?: string; vfrFixed?: boolean } = {};
      if (lstatSync(probePath, { throwIfNoEntry: false })?.isFile()) {
        prior = JSON.parse(readFileSync(probePath, 'utf8')) as typeof prior;
      }
      const previous = typeof prior?.output === 'string' && /^footage-cfr(?:\.[a-z0-9]+)?$/.test(prior.output)
        ? path.join(media, prior.output) : undefined;
      const previousFile = previous && lstatSync(previous, { throwIfNoEntry: false })?.isFile() ? previous : undefined;
      const reuse = flags.footage === undefined && previousFile !== undefined;
      const original = flags.footage ?? (typeof fromEvent === 'string' ? fromEvent : undefined);
      if (!reuse && original === undefined) throw new MfmError('USAGE', { flag: '--footage' }, { message: 'Pass --footage with the moves project video.' });
      const imported = flags.transcript === undefined ? undefined : importTranscript(
        localFile(cwd, flags.transcript, '--transcript'), flags.language === undefined ? project.language : language,
      );
      const version = enginePins().hyperframes;
      const engine = { dir: engineDirFor(cache({ cwd, env }), version), version };
      if (!imported && !engineReady(engine.dir)) {
        throw new MfmError('ENGINE_MISSING', {}, { hint: `Run ${WHISPER_FIX}.`, next: [WHISPER_FIX] });
      }

      mkdirSync(media, { recursive: true });
      const staging = mkdtempSync(path.join(media, '.transcribe-'));
      try {
        const { path: file, fps, vfrFixed } = reuse
          ? { path: previousFile, fps: project.fps, vfrFixed: prior.vfrFixed === true }
          : await normaliseFootage(localFile(cwd, original!, '--footage'), staging);
        const document = imported ?? await transcribeFootage(engine, file, staging, language, flags.model, env);
        const footageName = path.basename(file);
        const stagedTranscript = path.join(staging, 'mf-motion-transcript.json');
        writeJsonAtomic(stagedTranscript, document);
        const footagePath = path.join(media, footageName);
        if (!reuse) {
          renameSync(file, footagePath);
          renameSync(path.join(staging, 'probe.json'), probePath);
        }
        renameSync(stagedTranscript, transcriptPath);
        if (project.fps !== fps) writeJsonAtomic(projectPath, { ...project, fps });
        if (!reuse && previousFile !== undefined && previousFile !== footagePath) rmSync(previousFile, { force: true });
        return { data: {
          footage: { path: `media/${footageName}`, fps, vfrFixed }, transcript: 'media/transcript.json',
          words: document.words.length, lines: document.lines.length,
        } };
      } finally {
        rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
      }
    }, { command: 'transcribe', onStale: (message) => log.warn(message) });
  },
});

// Fetch CJK and emoji fonts into <cache>/fonts/<id>/ on request
// (`doctor --fix --fonts cjk,emoji`), each verified by sha256 against the
// shipped manifest. A file that does not match is deleted.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MfmError } from '../cli/errors';
import { FAMILY_SPECS, type ManifestEntry, type RegistryOptions, fetchManifest, fetchedFontsDir } from './registry';

export type FontGroup = 'cjk' | 'emoji';

export interface FetchOptions extends RegistryOptions {
  /** Override for tests; defaults to the shipped manifest. */
  manifest?: ManifestEntry[];
  /** Override for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  onProgress?: (message: string) => void;
}

export interface FetchedFont {
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  downloaded: boolean;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function fileName(entry: ManifestEntry): string {
  return decodeURIComponent(new URL(entry.url).pathname.split('/').pop() ?? `${entry.id}.ttf`);
}

function mismatch(entry: ManifestEntry, file: string, actual: string): MfmError {
  return new MfmError('MODEL_HASH_MISMATCH', { id: entry.id, file, expected: entry.sha256, actual }, {
    message: `${path.basename(file)} for ${entry.id} does not match its expected sha256; the file was deleted.`,
  });
}

/** Re-hash fetched fonts already in the cache; tampered files are deleted and reported. */
export async function verifyFetched(options: FetchOptions = {}): Promise<void> {
  const dir = fetchedFontsDir(options);
  for (const entry of options.manifest ?? fetchManifest()) {
    const file = path.join(dir, entry.id, fileName(entry));
    if (!existsSync(file)) continue;
    const actual = await sha256File(file);
    if (actual !== entry.sha256) {
      rmSync(file, { force: true });
      throw mismatch(entry, file, actual);
    }
  }
}

/** Download the families of the given groups (skipping verified files already present). */
export async function fetchFonts(groups: FontGroup[], options: FetchOptions = {}): Promise<FetchedFont[]> {
  const ids = new Set(FAMILY_SPECS.filter((spec) => spec.group && groups.includes(spec.group)).map((spec) => spec.id));
  const entries = (options.manifest ?? fetchManifest()).filter((entry) => ids.has(entry.id));
  const dir = fetchedFontsDir(options);
  const doFetch = options.fetchImpl ?? fetch;
  const results: FetchedFont[] = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.id, fileName(entry));
    mkdirSync(path.dirname(target), { recursive: true });
    if (existsSync(target)) {
      const actual = await sha256File(target);
      if (actual === entry.sha256) {
        results.push({ id: entry.id, path: target, bytes: entry.bytes, sha256: actual, downloaded: false });
        continue;
      }
      // A changed file in the cache is never trusted; fetch it again.
      rmSync(target, { force: true });
    }
    options.onProgress?.(`Downloading ${entry.id} (${(entry.bytes / 1e6).toFixed(1)} MB)`);
    let response: Response;
    try {
      response = await doFetch(entry.url);
    } catch (error) {
      throw new MfmError('NETWORK_REQUIRED', { id: entry.id, url: entry.url, cause: String(error) }, {
        message: `Downloading ${entry.id} needs the network.`,
      });
    }
    if (!response.ok || !response.body) {
      throw new MfmError('TOOL_FAILED', { id: entry.id, url: entry.url, status: response.status }, {
        message: `Downloading ${entry.id} failed with HTTP ${response.status}.`,
      });
    }
    const partial = `${target}.partial-${process.pid}`;
    const hash = createHash('sha256');
    const body = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
    body.on('data', (chunk: Buffer) => hash.update(chunk));
    try {
      await pipeline(body, createWriteStream(partial));
    } catch (error) {
      rmSync(partial, { force: true });
      throw new MfmError('NETWORK_REQUIRED', { id: entry.id, url: entry.url, cause: String(error) }, {
        message: `The download of ${entry.id} was interrupted.`,
      });
    }
    const actual = hash.digest('hex');
    if (actual !== entry.sha256) {
      rmSync(partial, { force: true });
      throw mismatch(entry, target, actual);
    }
    renameSync(partial, target);
    results.push({ id: entry.id, path: target, bytes: entry.bytes, sha256: actual, downloaded: true });
  }
  return results;
}

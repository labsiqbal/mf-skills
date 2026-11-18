import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempVariables = ['TMPDIR', 'TMP', 'TEMP'] as const;

export default async function setup(): Promise<() => Promise<void>> {
  const runDir = await mkdtemp(path.join(tmpdir(), `mfm-run-${process.pid}-`));
  const previous = tempVariables.map((name) => process.env[name]);
  for (const name of tempVariables) process.env[name] = runDir;

  const keep = process.env.MFM_KEEP_TMP === '1';
  if (keep) console.log(`Keeping mf-motion test temporary folder: ${runDir}`);

  return async () => {
    for (const [index, name] of tempVariables.entries()) {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (!keep) await rm(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
}

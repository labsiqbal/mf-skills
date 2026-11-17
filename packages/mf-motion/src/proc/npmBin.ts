// npm-installed tools run as `node <entry.js>`, never through a bin shim:
// Windows bins are .cmd files, which Node refuses to spawn without a shell.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';

/** `[process.execPath, <entry>]` for bin `name` of package `pkg` installed under `root/node_modules`. */
export function npmBin(pkg: string, name: string, root: string): [string, string] {
  const pkgDir = path.join(root, 'node_modules', ...pkg.split('/'));
  const manifestPath = path.join(pkgDir, 'package.json');
  let manifest: { bin?: string | Record<string, string>; name?: string };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
  } catch {
    throw new MfmError('TOOL_FAILED', { pkg, root }, { message: `${pkg} is not installed in ${root}.` });
  }
  const bin = typeof manifest.bin === 'string' ? (name === pkg.split('/').pop() ? manifest.bin : undefined) : manifest.bin?.[name];
  if (!bin) throw new MfmError('TOOL_FAILED', { pkg, name }, { message: `${pkg} has no bin named ${name}.` });
  const entry = path.resolve(pkgDir, bin);
  if (!existsSync(entry)) throw new MfmError('TOOL_FAILED', { pkg, entry }, { message: `The ${name} entry ${entry} is missing.` });
  return [process.execPath, entry];
}

/** npm's own JavaScript entry, to run npm through `node` on every OS. */
export function npmCli(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new MfmError('TOOL_FAILED', { candidates }, {
      message: 'npm was not found next to this Node.js.',
      hint: 'Install Node.js with its bundled npm (22 or newer), then run the command again.',
    });
  }
  return found;
}

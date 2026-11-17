// A stand-in engine folder: node_modules/hyperframes with a bin script whose
// behaviour each test chooses through FAKE_MODE. Lives under the OS temp folder.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Engine } from '../../../src/engine/index';
import { writeOk } from '../../../src/engine/index';

const SCRIPT = `
// The engine environment is an allow-list, so the mode is read from a file beside the fake install.
const root = require('node:path').join(__dirname, '..', '..', '..');
const mode = require('node:fs').readFileSync(require('node:path').join(root, 'mode.txt'), 'utf8').trim();
const args = process.argv.slice(2);
require('node:fs').writeFileSync(require('node:path').join(root, 'last-args.json'), JSON.stringify(args));
const out = args.indexOf('--output');
if (out >= 0 && mode === 'ok') require('node:fs').writeFileSync(args[out + 1], 'fake output');
if (mode === 'env') { console.log('progress line'); console.log(JSON.stringify({ ok: true, env: process.env, args })); }
else if (mode === 'fail') { console.log(JSON.stringify({ ok: false, error: { code: 'runtime_error', message: 'No composition found', hint: 'add index.html' } })); process.exit(1); }
else if (mode === 'garbage') { console.log('not json at all'); }
else if (mode === 'sleep') {
  const { spawn } = require('node:child_process');
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  require('node:fs').writeFileSync(require('node:path').join(root, 'pids.json'), JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
  setInterval(() => {}, 1000);
}
else { console.log(JSON.stringify({ ok: true, args })); }
`;

export interface FakeEngine extends Engine {
  modeFile: string;
  pidsFile: string;
  lastArgs(): string[];
  setMode(mode: 'ok' | 'env' | 'fail' | 'garbage' | 'sleep'): void;
}

export function fakeEngine(): FakeEngine {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-fake-engine-'));
  const pkg = path.join(dir, 'node_modules', 'hyperframes');
  mkdirSync(path.join(pkg, 'bin'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'hyperframes', version: '0.0.0-fake', bin: { hyperframes: 'bin/hyperframes.cjs' } }));
  writeFileSync(path.join(pkg, 'bin', 'hyperframes.cjs'), SCRIPT);
  mkdirSync(path.join(dir, 'hf-cache'), { mode: 0o700 });
  writeOk(dir, { installedAt: new Date().toISOString(), nodeVersion: process.versions.node, lockSha256: 'fake' });
  const modeFile = path.join(dir, 'mode.txt');
  writeFileSync(modeFile, 'ok');
  return {
    dir,
    version: '0.0.0-fake',
    modeFile,
    pidsFile: path.join(dir, 'pids.json'),
    setMode: (mode) => writeFileSync(modeFile, mode),
    lastArgs: () => JSON.parse(readFileSync(path.join(dir, 'last-args.json'), 'utf8')) as string[],
  };
}

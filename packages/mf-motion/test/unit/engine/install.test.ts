import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import {
  assertPrivateCache,
  copyVendor,
  engineDirFor,
  engineReady,
  enginePinFiles,
  enginePins,
  lockSha256,
  readOk,
  unsafeCacheAncestor,
  writeOk,
} from '../../../src/engine/index';
import { PROJECT_ENGINE } from '../../../src/paths/index';
import { npmBin } from '../../../src/proc/npmBin';

const posix = process.platform !== 'win32';

describe('pins', () => {
  it('come from engine/package.json and match what new projects record', () => {
    expect(enginePins()).toEqual({ hyperframes: '0.9.61', gsap: '3.15.0', three: '0.187.0' });
    expect(PROJECT_ENGINE).toEqual(enginePins());
    const lock = JSON.parse(readFileSync(enginePinFiles().lock, 'utf8')) as { packages: Record<string, { version?: string; integrity?: string }> };
    expect(lock.packages['node_modules/hyperframes']).toMatchObject({ version: '0.9.61', integrity: expect.stringMatching(/^sha512-/) });
    expect(lock.packages['node_modules/gsap']?.version).toBe('3.15.0');
    expect(lock.packages['node_modules/three']?.version).toBe('0.187.0');
    expect(lockSha256()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('.ok marker', () => {
  it('a missing or corrupted .ok means not installed', () => {
    const dir = engineDirFor(mkdtempSync(path.join(tmpdir(), 'mfm-cache-')), '0.9.61');
    mkdirSync(path.join(dir, 'node_modules', 'hyperframes'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'hyperframes', 'package.json'), '{}');
    expect(readOk(dir)).toBeNull();
    writeOk(dir, { installedAt: new Date().toISOString(), nodeVersion: process.versions.node, lockSha256: lockSha256() });
    expect(engineReady(dir)).toBe(true);
    writeFileSync(path.join(dir, '.ok'), '{"installedAt": tru');
    expect(readOk(dir)).toBeNull();
    expect(engineReady(dir)).toBe(false);
    writeOk(dir, { installedAt: new Date().toISOString(), nodeVersion: process.versions.node, lockSha256: 'other-lock' });
    expect(engineReady(dir)).toBe(false);
  });
});

describe('private cache guard', () => {
  it.runIf(posix)('finds a folder other accounts can write and refuses it', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'mfm-private-'));
    const engine = path.join(base, 'engine', 'hf-0.9.61');
    mkdirSync(path.join(engine, 'hf-cache'), { recursive: true, mode: 0o700 });
    chmodSync(path.join(base, 'engine'), 0o700);
    chmodSync(engine, 0o700);
    expect(unsafeCacheAncestor(path.join(engine, 'hf-cache'))).toBeNull();
    expect(() => assertPrivateCache(engine)).not.toThrow();
    chmodSync(path.join(base, 'engine'), 0o775);
    expect(unsafeCacheAncestor(path.join(engine, 'hf-cache'))).toBe(path.join(base, 'engine'));
    const error = (() => {
      try {
        assertPrivateCache(engine);
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(MfmError);
    expect(error).toMatchObject({ code: 'ENGINE_MISSING', details: { writableByOthers: path.join(base, 'engine') } });
  });
});

describe('npmBin', () => {
  it('resolves object and string bins to [node, entry] and refuses a missing one', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mfm-bin-'));
    const one = path.join(root, 'node_modules', 'tool');
    mkdirSync(path.join(one, 'bin'), { recursive: true });
    writeFileSync(path.join(one, 'package.json'), JSON.stringify({ name: 'tool', bin: { tool: 'bin/tool.mjs' } }));
    writeFileSync(path.join(one, 'bin', 'tool.mjs'), '');
    expect(npmBin('tool', 'tool', root)).toEqual([process.execPath, path.join(one, 'bin', 'tool.mjs')]);
    const scoped = path.join(root, 'node_modules', '@scope', 'single');
    mkdirSync(scoped, { recursive: true });
    writeFileSync(path.join(scoped, 'package.json'), JSON.stringify({ name: '@scope/single', bin: 'cli.js' }));
    writeFileSync(path.join(scoped, 'cli.js'), '');
    expect(npmBin('@scope/single', 'single', root)).toEqual([process.execPath, path.join(scoped, 'cli.js')]);
    expect(() => npmBin('tool', 'other', root)).toThrow(MfmError);
    expect(() => npmBin('absent', 'absent', root)).toThrow(MfmError);
  });
});

describe('copyVendor', () => {
  function engineWithVendor() {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-vendor-engine-'));
    const gsap = path.join(dir, 'node_modules', 'gsap', 'dist');
    const three = path.join(dir, 'node_modules', 'three', 'build');
    mkdirSync(gsap, { recursive: true });
    mkdirSync(three, { recursive: true });
    for (const file of ['gsap.min.js', 'CustomEase.min.js', 'SplitText.min.js']) writeFileSync(path.join(gsap, file), `/*! ${file} header */`);
    for (const file of ['three.module.js', 'three.core.js']) writeFileSync(path.join(three, file), `/** @license ${file} */`);
    return dir;
  }

  it('copies GSAP with its headers and notice, and three only when asked', () => {
    const engineDir = engineWithVendor();
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    expect(copyVendor(build, { engineDir, plugins: ['CustomEase'] })).toEqual([
      'vendor/gsap/gsap.min.js',
      'vendor/gsap/CustomEase.min.js',
      'vendor/GSAP-NOTICE.txt',
    ]);
    expect(readFileSync(path.join(build, 'vendor', 'gsap', 'gsap.min.js'), 'utf8')).toBe('/*! gsap.min.js header */');
    expect(readFileSync(path.join(build, 'vendor', 'GSAP-NOTICE.txt'), 'utf8')).toContain('gsap.com/standard-license');
    const withThree = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    expect(copyVendor(withThree, { engineDir, needsThree: true })).toContain('vendor/three/three.core.js');
  });

  it('refuses a plugin the engine install lacks', () => {
    const build = mkdtempSync(path.join(tmpdir(), 'mfm-build-'));
    expect(() => copyVendor(build, { engineDir: engineWithVendor(), plugins: ['MorphSVGPlugin'] })).toThrow(MfmError);
  });
});

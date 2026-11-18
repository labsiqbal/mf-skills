import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFixOs, fixLine, fixTableSpec } from '../../../src/doctor/fixes';
import { aptPackage, chromeAptLine, missingLibraries, parseEncoders, parseFilters, runDoctor } from '../../../src/doctor/index';

const ENCODERS = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 VFS... prores_ks            Apple ProRes (iCodec Pro) (codec prores)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
`;
const FILTERS = `Filters:
  T.. = Timeline support
  | = Source or sink filter
 ... ebur128           A->N       EBU R128 scanner.
 ... loudnorm          A->A       EBU R128 loudness normalization
 T.. alphamerge        VV->V      Copy the luma value of the second input into the alpha channel of the first input.
 TSC overlay           VV->V      Overlay a video source on top of the input.
 ... color             |->V       Provide an uniformly colored input.
`;

describe('ffmpeg capability parsing', () => {
  it('reads encoder and filter names', () => {
    expect([...parseEncoders(ENCODERS)]).toEqual(['libx264', 'prores_ks', 'libvpx-vp9', 'aac']);
    expect([...parseFilters(FILTERS)]).toEqual(['ebur128', 'loudnorm', 'alphamerge', 'overlay', 'color']);
  });

  it('names the shared libraries a Chrome launch could not load', () => {
    const stderr = [
      'chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory',
      'chrome-headless-shell: error while loading shared libraries: libgbm.so.1: cannot open shared object file',
      'chrome-headless-shell: error while loading shared libraries: libweird.so.7: cannot open shared object file',
    ].join('\n');
    expect(missingLibraries(stderr)).toEqual(['libnss3', 'libgbm1', 'libweird.so.7']);
  });

  it('names the libraries ldd reports as not found', () => {
    const ldd = [
      '\tlinux-vdso.so.1 (0x00007ffd)',
      '\tlibnss3.so => not found',
      '\tlibasound.so.2 => not found',
      '\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f)',
    ].join('\n');
    expect(missingLibraries(ldd)).toEqual(['libnss3', 'libasound2']);
  });

  it('maps unresolved libraries to Debian packages and extends the apt line with them', () => {
    expect(['libXcomposite.so.1', 'libXdamage.so.1', 'libX11.so.6', 'libpango-1.0.so.0', 'libdbus-1.so.3', 'libgobject-2.0.so.0', 'libatk-1.0.so.0', 'libnspr4.so', 'libgbm1'].map(aptPackage)).toEqual([
      'libxcomposite1', 'libxdamage1', 'libx11-6', 'libpango-1.0-0', 'libdbus-1-3', 'libglib2.0-0', 'libatk1.0-0', 'libnspr4', 'libgbm1',
    ]);
    const base = 'sudo apt-get install -y libnss3 libgbm1 libasound2t64 libatk-bridge2.0-0 libxkbcommon0 libdrm2';
    expect(chromeAptLine(base, ['libnss3', 'libasound2', 'libXcomposite.so.1', 'libXdamage.so.1'])).toBe(`${base} libxcomposite1 libxdamage1`);
    expect(chromeAptLine(base, [])).toBe(base);
  });
});

describe('fix lines', () => {
  it('match the table of setup-and-doctor.md', () => {
    expect(fixTableSpec().map((row) => row.Need)).toEqual(['Node 24', 'FFmpeg', 'yt-dlp', 'Chrome libs']);
  });

  it('pick the column for the OS and the ALSA name for older Debian and Ubuntu', () => {
    expect(detectFixOs('darwin')).toBe('macos');
    expect(detectFixOs('win32')).toBe('windows');
    expect(detectFixOs('linux', { id: 'fedora', idLike: [], versionId: '41' })).toBe('fedora');
    expect(detectFixOs('linux', { id: 'linuxmint', idLike: ['ubuntu', 'debian'], versionId: '22' })).toBe('debian');
    expect(fixLine('ffmpeg', 'windows')).toBe('winget install Gyan.FFmpeg');
    expect(fixLine('ffmpeg', 'fedora')).toBe('sudo dnf install ffmpeg  # RPM Fusion');
    expect(fixLine('chrome-libs', 'macos')).toBeNull();
    const bookworm = fixLine('chrome-libs', 'debian', { id: 'debian', idLike: [], versionId: '12' });
    expect(bookworm).toBe('sudo apt-get install -y libnss3 libgbm1 libasound2 libatk-bridge2.0-0 libxkbcommon0 libdrm2');
    expect(fixLine('chrome-libs', 'debian', { id: 'ubuntu', idLike: ['debian'], versionId: '24.04' })).toContain('libasound2t64');
  });
});

const posix = process.platform !== 'win32';

function pathWith(scripts: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mfm-path-'));
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

function baseEnv(pathDir: string): NodeJS.ProcessEnv {
  const cache = mkdtempSync(path.join(tmpdir(), 'mfm-doctor-cache-'));
  return {
    PATH: pathDir,
    MF_MOTION_CACHE: cache,
    MF_MOTION_HOME: mkdtempSync(path.join(tmpdir(), 'mfm-doctor-home-')),
    ...(process.env.npm_execpath ? { npm_execpath: process.env.npm_execpath } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
}

describe('doctor rows', () => {
  it('reports FFmpeg and FFprobe missing on a PATH without them, with the fix line for this OS', async () => {
    const data = await runDoctor({ env: baseEnv(mkdtempSync(path.join(tmpdir(), 'mfm-empty-path-'))) });
    const row = (id: string) => data.checks.find((check) => check.id === id);
    expect(data.ok).toBe(false);
    expect(row('ffmpeg')).toMatchObject({ status: 'missing', found: null, fix: fixLine('ffmpeg', detectFixOs()) });
    expect(row('ffprobe')?.status).toBe('missing');
    expect(row('ffmpeg-encoder:libvpx-vp9')?.status).toBe('missing');
    expect(row('cli')).toMatchObject({ status: 'missing', fix: 'mf-motion doctor --fix --json' });
    expect(row('engine')?.status).toBe('missing');
    expect(row('fonts')?.status).toBe('ok');
    expect(row('fonts-cjk')?.status).toBe('optional');
    expect(data.launcher).toEqual(['npx', '--prefer-offline', '-y', 'mf-motion@1.0.0']);
    expect(data.checks.map((check) => check.id).slice(0, 4)).toEqual(['node', 'npm', 'ffmpeg', 'ffprobe']);
  });

  it.runIf(posix)('reports exactly the encoder an FFmpeg stub lacks', async () => {
    const encoders = ENCODERS.split('\n').filter((line) => !line.includes('libvpx-vp9')).join('\n');
    const filters = FILTERS.replace('... color', '... fps               V->V       Force constant framerate.\n ..C scale             V->V       Scale.\n ... color');
    const dir = pathWith({
      // Builtins only: the stub PATH holds nothing else.
      ffmpeg: `case "$*" in *-encoders*) printf '%s\\n' '${encoders}';; *-filters*) printf '%s\\n' '${filters}';; *) echo "ffmpeg version 9.9-stub";; esac`,
      ffprobe: 'echo "ffprobe version 9.9-stub"',
    });
    const data = await runDoctor({ env: baseEnv(dir) });
    const status = Object.fromEntries(data.checks.map((check) => [check.id, check.status]));
    expect(status.ffmpeg).toBe('ok');
    expect(status['ffmpeg-encoder:libvpx-vp9']).toBe('missing');
    expect(status['ffmpeg-encoder:libx264']).toBe('ok');
    expect(status['ffmpeg-encoder:prores_ks']).toBe('ok');
    for (const filter of ['loudnorm', 'ebur128', 'overlay', 'scale', 'fps', 'alphamerge']) expect(status[`ffmpeg-filter:${filter}`], filter).toBe('ok');
  });

  it('warns about cloud keys without failing', async () => {
    const env = { ...baseEnv(mkdtempSync(path.join(tmpdir(), 'mfm-empty-path-'))), OPENAI_API_KEY: 'sentinel' };
    const data = await runDoctor({ env });
    expect(data.checks.find((check) => check.id === 'cloud-keys')).toMatchObject({ status: 'warn', found: expect.stringContaining('OPENAI_API_KEY') });
    expect(JSON.stringify(data)).not.toContain('sentinel');
  });

  it('refuses --fix with --offline', async () => {
    await expect(runDoctor({ fix: true, offline: true, env: baseEnv(mkdtempSync(path.join(tmpdir(), 'mfm-empty-path-'))) })).rejects.toMatchObject({ code: 'USAGE' });
  });
});

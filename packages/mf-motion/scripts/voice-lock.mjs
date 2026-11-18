// npm run voice:lock [-- --python <exe>]
//
// Builds assets/voice/requirements.lock and assets/voice/lock.json, the pinned
// Python set of the local voice runtime (doctor --fix --voice):
//   1. for every target of TARGETS, `pip install --dry-run --report` resolves
//      the top-level pins for that interpreter version and platform, wheels
//      only, without installing anything;
//   2. the reports merge into one requirement per package version, with an
//      environment marker naming the targets that use it;
//   3. every wheel hash of that version comes from the PyPI JSON API.
// A target with no wheel for some package is recorded as unsupported.
// Needs the network; run it when the top-level pins change.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'voice');

/** The packages the engine's tts imports, at the newest releases that cover the matrix. */
export const TOP_LEVEL = { 'kokoro-onnx': '0.6.1', soundfile: '0.14.0' };

const PLATFORMS = [
  { id: 'linux-x86_64', sysPlatform: 'linux', machine: 'x86_64', tags: ['manylinux_2_28_x86_64', 'manylinux_2_27_x86_64', 'manylinux_2_17_x86_64', 'manylinux2014_x86_64'] },
  { id: 'linux-aarch64', sysPlatform: 'linux', machine: 'aarch64', tags: ['manylinux_2_28_aarch64', 'manylinux_2_27_aarch64', 'manylinux_2_17_aarch64', 'manylinux2014_aarch64'] },
  { id: 'macos-arm64', sysPlatform: 'darwin', machine: 'arm64', tags: ['macosx_14_0_arm64', 'macosx_13_0_arm64', 'macosx_12_0_arm64', 'macosx_11_0_arm64'] },
  { id: 'macos-x86_64', sysPlatform: 'darwin', machine: 'x86_64', tags: ['macosx_14_0_x86_64', 'macosx_13_0_x86_64', 'macosx_12_0_x86_64', 'macosx_11_0_x86_64', 'macosx_10_15_x86_64', 'macosx_10_12_x86_64', 'macosx_10_9_x86_64'] },
  { id: 'windows-amd64', sysPlatform: 'win32', machine: 'AMD64', tags: ['win_amd64'] },
];
export const PYTHONS = ['3.11', '3.12', '3.13'];
export const TARGETS = PYTHONS.flatMap((python) => PLATFORMS.map((platform) => ({ ...platform, id: `cp${python.replace('.', '')}-${platform.id}`, python })));

/** PEP 503 name. */
export const normalise = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

export function targetMarker(target) {
  return `python_version == "${target.python}" and sys_platform == "${target.sysPlatform}" and platform_machine == "${target.machine}"`;
}

/** One marker for a set of targets: none when every supported target uses it. */
export function markerFor(targets, supported) {
  if (targets.length === supported.length) return null;
  return targets.map((target) => `(${targetMarker(target)})`).join(' or ');
}

function resolveTarget(python, target, work) {
  const report = path.join(work, `${target.id}.json`);
  const args = [
    '-I', '-m', 'pip', 'install', '--dry-run', '--quiet', '--disable-pip-version-check', '--no-input',
    '--report', report, '--only-binary=:all:', '--python-version', target.python, '--implementation', 'cp',
    ...target.tags.flatMap((tag) => ['--platform', tag]),
    '--target', path.join(work, 't'), '--index-url', 'https://pypi.org/simple',
    ...Object.entries(TOP_LEVEL).map(([name, version]) => `${name}==${version}`),
  ];
  const result = spawnSync(python, args, { cwd: work, encoding: 'utf8', env: { ...process.env, PIP_CONFIG_FILE: path.join(work, 'none.conf') } });
  if (result.status !== 0) return { unsupported: (result.stderr.trim().split('\n').pop() ?? 'pip failed').slice(0, 300) };
  const { install } = JSON.parse(readFileSync(report, 'utf8'));
  return { packages: Object.fromEntries(install.map((item) => [normalise(item.metadata.name), item.metadata.version]).sort(([a], [b]) => a.localeCompare(b))) };
}

async function pypi(name, version) {
  const response = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
  if (!response.ok) throw new Error(`PyPI ${name} ${version}: HTTP ${response.status}`);
  const doc = await response.json();
  const wheels = doc.urls.filter((file) => file.packagetype === 'bdist_wheel' && !file.yanked);
  if (wheels.length === 0) throw new Error(`PyPI ${name} ${version} has no wheels.`);
  const licence = doc.info.license_expression || (doc.info.license && doc.info.license.length < 60 ? doc.info.license : null)
    || (doc.info.classifiers ?? []).filter((c) => c.startsWith('License ::')).map((c) => c.split(' :: ').pop()).join(', ') || null;
  return { hashes: wheels.map((file) => file.digests.sha256).sort(), licence };
}

async function main() {
  const { values } = parseArgs({ options: { python: { type: 'string', default: process.platform === 'win32' ? 'python' : 'python3' } } });
  const work = mkdtempSync(path.join(tmpdir(), 'mfm-voice-lock-'));
  try {
    const pipVersion = spawnSync(values.python, ['-I', '-m', 'pip', '--version'], { cwd: work, encoding: 'utf8' }).stdout.trim().split(' ')[1];
    const targets = [];
    for (const target of TARGETS) {
      const resolved = resolveTarget(values.python, target, work);
      console.log(`${target.id}: ${resolved.unsupported ? `unsupported (${resolved.unsupported})` : `${Object.keys(resolved.packages).length} packages`}`);
      targets.push({ id: target.id, python: target.python, sysPlatform: target.sysPlatform, machine: target.machine, ...resolved });
    }
    const supported = targets.filter((target) => target.packages);
    const uses = new Map();
    for (const target of supported) {
      for (const [name, version] of Object.entries(target.packages)) {
        const key = `${name}==${version}`;
        if (!uses.has(key)) uses.set(key, { name, version, targets: [] });
        uses.get(key).targets.push(target);
      }
    }
    const entries = [...uses.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
    const packages = {};
    const lines = [
      '# Local voice runtime of mf-motion (doctor --fix --voice). Generated by scripts/voice-lock.mjs; do not edit.',
      `# Top level: ${Object.entries(TOP_LEVEL).map(([name, version]) => `${name}==${version}`).join(', ')}. Resolved with pip ${pipVersion}.`,
      `# Targets: ${supported.map((target) => target.id).join(', ')}.`,
    ];
    for (const entry of entries) {
      const info = await pypi(entry.name, entry.version);
      packages[entry.name] = { ...(packages[entry.name] ?? {}), [entry.version]: { licence: info.licence, hashes: info.hashes } };
      const marker = markerFor(entry.targets, supported);
      lines.push(`${entry.name}==${entry.version}${marker ? ` ; ${marker}` : ''} \\`);
      info.hashes.forEach((hash, i) => lines.push(`    --hash=sha256:${hash}${i < info.hashes.length - 1 ? ' \\' : ''}`));
    }
    const lock = `${lines.join('\n')}\n`;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'requirements.lock'), lock);
    writeFileSync(
      path.join(outDir, 'lock.json'),
      `${JSON.stringify({ generatedBy: 'scripts/voice-lock.mjs', pip: pipVersion, topLevel: TOP_LEVEL, lockSha256: createHash('sha256').update(lock).digest('hex'), targets, packages }, null, 2)}\n`,
    );
    console.log(`${entries.length} pinned package versions for ${supported.length} of ${targets.length} targets.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

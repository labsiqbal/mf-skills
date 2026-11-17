// One exact fix line per missing system piece per OS (setup-and-doctor.md).
// Doctor prints these; it never runs them.
import { readFileSync } from 'node:fs';

export type FixOs = 'macos' | 'debian' | 'fedora' | 'windows';
export type FixNeed = 'node' | 'ffmpeg' | 'yt-dlp' | 'chrome-libs';

export interface FixLine {
  command: string;
  /** Shown after the command, for example the repository it comes from. */
  note?: string;
}

/** The fix-line table as data; null where the OS needs nothing. */
export const FIXES: Record<FixNeed, { label: string } & Record<FixOs, FixLine | null>> = {
  node: {
    label: 'Node 24',
    macos: { command: 'brew install node@24' },
    debian: { command: 'curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs' },
    fedora: { command: 'sudo dnf install nodejs24' },
    windows: { command: 'winget install OpenJS.NodeJS.LTS' },
  },
  ffmpeg: {
    label: 'FFmpeg',
    macos: { command: 'brew install ffmpeg' },
    debian: { command: 'sudo apt-get install -y ffmpeg' },
    fedora: { command: 'sudo dnf install ffmpeg', note: 'RPM Fusion' },
    windows: { command: 'winget install Gyan.FFmpeg' },
  },
  'yt-dlp': {
    label: 'yt-dlp',
    macos: { command: 'brew install yt-dlp' },
    debian: { command: 'pipx install yt-dlp' },
    fedora: { command: 'pipx install yt-dlp' },
    windows: { command: 'winget install yt-dlp.yt-dlp' },
  },
  'chrome-libs': {
    label: 'Chrome libs',
    macos: null,
    debian: { command: 'sudo apt-get install -y libnss3 libgbm1 libasound2t64 libatk-bridge2.0-0 libxkbcommon0 libdrm2' },
    fedora: { command: 'sudo dnf install nss mesa-libgbm alsa-lib at-spi2-atk libxkbcommon libdrm' },
    windows: null,
  },
};

const OS_COLUMNS: Array<[FixOs, string]> = [
  ['macos', 'macOS'],
  ['debian', 'Debian/Ubuntu'],
  ['fedora', 'Fedora'],
  ['windows', 'Windows'],
];

/** The table in the shape of setup-and-doctor.md (checked against its snapshot). */
export function fixTableSpec(): Array<Record<string, string>> {
  return Object.values(FIXES).map((row) => ({
    Need: row.label,
    ...Object.fromEntries(
      OS_COLUMNS.map(([os, column]) => {
        const line = row[os];
        return [column, line ? `${line.command}${line.note ? ` (${line.note})` : ''}` : '-'];
      }),
    ),
  }));
}

export interface OsRelease {
  id: string;
  idLike: string[];
  versionId: string;
}

export function readOsRelease(file = '/etc/os-release'): OsRelease | null {
  try {
    const fields = Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.trim().match(/^([A-Z_]+)=("?)(.*)\2$/))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[3]]),
    ) as Record<string, string>;
    return { id: fields.ID ?? '', idLike: (fields.ID_LIKE ?? '').split(/\s+/).filter(Boolean), versionId: fields.VERSION_ID ?? '' };
  } catch {
    return null;
  }
}

/** The fix-line column for this machine. */
export function detectFixOs(platform: NodeJS.Platform = process.platform, release: OsRelease | null = platform === 'linux' ? readOsRelease() : null): FixOs {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  const ids = [release?.id ?? '', ...(release?.idLike ?? [])];
  if (ids.some((id) => ['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].includes(id))) return 'fedora';
  return 'debian';
}

/**
 * The line for one need on this machine. Debian before 13 and Ubuntu before
 * 24.04 name the ALSA library `libasound2`, not `libasound2t64`.
 */
export function fixLine(need: FixNeed, os: FixOs, release: OsRelease | null = null): string | null {
  const line = FIXES[need][os];
  if (!line) return null;
  let command = line.command;
  if (need === 'chrome-libs' && os === 'debian' && release) {
    const major = Number.parseFloat(release.versionId);
    const oldDebian = release.id === 'debian' && Number.isFinite(major) && major < 13;
    const oldUbuntu = release.id === 'ubuntu' && Number.isFinite(major) && major < 24.04;
    if (oldDebian || oldUbuntu) command = command.replace('libasound2t64', 'libasound2');
  }
  return line.note ? `${command}  # ${line.note}` : command;
}

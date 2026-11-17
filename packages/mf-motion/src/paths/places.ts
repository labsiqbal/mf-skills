// The three places: the read-only skill folder (never touched here), the data
// home (user work) and the cache (disposable CLI downloads). Paths are built
// with node:path and os.homedir(); nothing reads HOME or expands "~" by string.
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';

export interface PlaceOptions {
  /** `--home` for dataHome; ignored by cache. */
  flag?: string | undefined;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  cwd?: string;
}

function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function context(options: PlaceOptions) {
  const platform = options.platform ?? process.platform;
  return {
    platform,
    p: pathFor(platform),
    env: options.env ?? process.env,
    home: options.homedir ?? osHomedir(),
    cwd: options.cwd ?? process.cwd(),
  };
}

const set = (value: string | undefined): value is string => value !== undefined && value !== '';

/** Data home: `--home`, then MF_MOTION_HOME, then `<home>/mf-motion`. */
export function dataHome(options: PlaceOptions = {}): string {
  const { p, env, home, cwd } = context(options);
  if (set(options.flag)) return p.resolve(cwd, options.flag);
  if (set(env.MF_MOTION_HOME)) return p.resolve(cwd, env.MF_MOTION_HOME);
  return p.join(home, 'mf-motion');
}

/**
 * Cache: MF_MOTION_CACHE, else the OS cache folder plus mf-motion:
 * Linux `${XDG_CACHE_HOME:-<home>/.cache}/mf-motion`, macOS
 * `<home>/Library/Caches/mf-motion`, Windows `%LOCALAPPDATA%\mf-motion\Cache`.
 */
export function cache(options: PlaceOptions = {}): string {
  const { platform, p, env, home, cwd } = context(options);
  if (set(env.MF_MOTION_CACHE)) return p.resolve(cwd, env.MF_MOTION_CACHE);
  if (platform === 'darwin') return p.join(home, 'Library', 'Caches', 'mf-motion');
  if (platform === 'win32') {
    const local = set(env.LOCALAPPDATA) ? env.LOCALAPPDATA : p.join(home, 'AppData', 'Local');
    return p.join(local, 'mf-motion', 'Cache');
  }
  const xdg = env.XDG_CACHE_HOME;
  // The XDG spec says relative values are invalid and must be ignored.
  const base = set(xdg) && p.isAbsolute(xdg) ? xdg : p.join(home, '.cache');
  return p.join(base, 'mf-motion');
}

/** Folders inside the data home. */
export function homeLayout(home: string) {
  return {
    root: home,
    profile: path.join(home, 'profile.json'),
    brands: path.join(home, 'brands'),
    projects: path.join(home, 'projects'),
    library: path.join(home, 'library'),
    receipts: path.join(home, 'receipts'),
  };
}

export const paths = { dataHome, cache, homeLayout };

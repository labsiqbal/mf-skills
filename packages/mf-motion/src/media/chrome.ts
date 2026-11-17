/// <reference lib="dom" />
// Chrome page driver: the engine's pinned Chrome, driven by the engine's own
// puppeteer-core (resolved from the engine folder at runtime, never bundled),
// over a pipe (no debugging port). Every request is intercepted: files inside
// the inspected folder load; anything else is aborted and reported.
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MfmError } from '../cli/errors';
import { type Engine, ensureBrowser, ensureEngine, readOk } from '../engine/index';
import { confine } from '../paths/index';

/** The parts of a puppeteer Page this driver uses. */
export interface DriverPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>>;
  screenshot(options: { type: 'png'; omitBackground?: boolean; fullPage?: boolean; captureBeyondViewport?: boolean }): Promise<Uint8Array>;
  setViewport(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setRequestInterception(on: boolean): Promise<void>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  on(event: 'request', handler: (request: DriverRequest) => void): unknown;
  on(event: 'pageerror', handler: (error: Error) => void): unknown;
  close(): Promise<void>;
}

interface DriverRequest {
  url(): string;
  continue(): Promise<void>;
  abort(reason?: string): Promise<void>;
}

interface DriverBrowser {
  newPage(): Promise<DriverPage>;
  close(): Promise<void>;
  version(): Promise<string>;
}

interface Puppeteer {
  launch(options: Record<string, unknown>): Promise<DriverBrowser>;
}

export interface AbortedRequest {
  url: string;
  reason: 'network' | 'outside-folder' | 'unsupported';
}

export interface PageOptions {
  /** Folder whose files the page may load. */
  dir: string;
  /** Page file inside `dir`; default index.html. */
  entry?: string;
  width: number;
  height: number;
  dpr?: number;
  /** A HyperFrames composition: inject the engine runtime and wait for its timeline (default true). */
  composition?: boolean;
  /** WebGL pages get SwiftShader flags. */
  webgl?: boolean;
  /** Installed engine; default: the pinned engine in the mf-motion cache. */
  engine?: Engine;
  /** Chrome binary; default: the path recorded by ensureBrowser. */
  browserPath?: string;
  registrationTimeoutMs?: number;
}

export interface PageSession {
  /** Requests aborted because they left the folder or went to the network. */
  aborted: AbortedRequest[];
  /** Uncaught page errors. */
  errors: string[];
}

export const REGISTRATION_TIMEOUT_MS = 20_000;

export const LAUNCH_FLAGS = [
  '--headless=new',
  '--hide-scrollbars',
  '--disable-gpu',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--mute-audio',
] as const;

export const WEBGL_FLAGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] as const;

const puppeteers = new Map<string, Promise<Puppeteer>>();

/** The engine's puppeteer-core, imported from the engine folder. */
function loadPuppeteer(engineDir: string): Promise<Puppeteer> {
  let loaded = puppeteers.get(engineDir);
  if (!loaded) {
    const require = createRequire(path.join(engineDir, 'package.json'));
    const entry = require.resolve('puppeteer-core');
    loaded = import(pathToFileURL(entry).href).then((module: { default?: Puppeteer } & Puppeteer) => module.default ?? module);
    puppeteers.set(engineDir, loaded);
  }
  return loaded;
}

async function resolveEngine(options: PageOptions): Promise<{ engine: Engine; browserPath: string }> {
  const engine = options.engine ?? (await ensureEngine());
  const browserPath = options.browserPath ?? readOk(engine.dir)?.browserPath ?? (await ensureBrowser(engine));
  return { engine, browserPath };
}

function runtimeSource(engineDir: string): string {
  return readFileSync(path.join(engineDir, 'node_modules', 'hyperframes', 'dist', 'hyperframe.runtime.iife.js'), 'utf8');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open the page in a fresh headless Chrome, run `fn`, and always close the browser. */
export async function withPage<T>(options: PageOptions, fn: (page: DriverPage, session: PageSession) => Promise<T>): Promise<T> {
  const { engine, browserPath } = await resolveEngine(options);
  const puppeteer = await loadPuppeteer(engine.dir);
  const root = realpathSync.native(options.dir);
  const entry = confine(root, options.entry ?? 'index.html');
  const args: string[] = [...LAUNCH_FLAGS, ...(options.webgl ? WEBGL_FLAGS : [])];
  // Chrome's sandbox cannot start as root (containers); doctor warns about it.
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    pipe: true,
    headless: true,
    args,
    defaultViewport: null,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  const session: PageSession = { aborted: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: options.dpr ?? 1 });
    await page.setRequestInterception(true);
    page.on('pageerror', (error) => session.errors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') {
        void request.continue();
        return;
      }
      if (url.startsWith('file:')) {
        try {
          confine(root, fileURLToPath(url));
          void request.continue();
        } catch {
          session.aborted.push({ url, reason: 'outside-folder' });
          void request.abort('blockedbyclient');
        }
        return;
      }
      session.aborted.push({ url, reason: /^(https?|wss?|ftp):/.test(url) ? 'network' : 'unsupported' });
      void request.abort('blockedbyclient');
    });
    const timeout = options.registrationTimeoutMs ?? REGISTRATION_TIMEOUT_MS;
    try {
      await page.goto(pathToFileURL(entry).href, { waitUntil: 'load', timeout });
    } catch (error) {
      throw new MfmError('TIMEOUT', { page: entry, errors: session.errors, cause: String(error) }, { message: `${entry} did not load within ${timeout / 1000} s.` });
    }
    if (options.composition !== false) {
      await page.addScriptTag({ content: runtimeSource(engine.dir) });
      const deadline = Date.now() + timeout;
      for (;;) {
        const ready = await page.evaluate(() => {
          const w = window as unknown as { __hf?: { seek?: unknown }; __player?: { seek?: unknown }; __timelines?: Record<string, unknown> };
          const seekable = typeof w.__hf?.seek === 'function' || typeof w.__player?.seek === 'function';
          return seekable && Object.keys(w.__timelines ?? {}).length > 0;
        });
        if (ready) break;
        if (Date.now() > deadline) {
          throw new MfmError('TIMEOUT', { page: entry, errors: session.errors }, {
            message: `${entry} did not register its timeline within ${timeout / 1000} s${session.errors.length ? `; it threw: ${session.errors[0]}` : ''}.`,
          });
        }
        await sleep(50);
      }
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    return await fn(page, session);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Seek the composition the way the engine does (the runtime's seek), then wait
 * for pending seek work, fonts and two animation frames.
 */
export async function seek(page: DriverPage, sec: number): Promise<void> {
  await page.evaluate((t: number) => {
    const w = window as unknown as {
      __hf?: { seek?: (t: number) => unknown };
      __player?: { seek?: (t: number) => unknown; renderSeek?: (t: number) => unknown; enableRenderMode?: () => unknown };
      __mfmRenderMode?: boolean;
    };
    if (typeof w.__hf?.seek === 'function') {
      w.__hf.seek(t);
      return;
    }
    const player = w.__player;
    if (player && typeof player.renderSeek === 'function') {
      if (!w.__mfmRenderMode) {
        player.enableRenderMode?.();
        w.__mfmRenderMode = true;
      }
      player.renderSeek(t);
      return;
    }
    player?.seek?.(t);
  }, sec);
  await page.evaluate(async () => {
    const w = window as unknown as { __hfWaitForSeekCompletion?: () => Promise<void> };
    await w.__hfWaitForSeekCompletion?.();
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** PNG of the viewport; `omitBackground` keeps transparency. */
export async function screenshot(page: DriverPage, options: { omitBackground?: boolean } = {}): Promise<Buffer> {
  const data = await page.screenshot({ type: 'png', omitBackground: options.omitBackground ?? false, captureBeyondViewport: false });
  return Buffer.from(data);
}

/** Run a function in the page with one serialisable argument. */
export function evaluate<A, R>(page: DriverPage, fn: (arg: A) => R, arg: A): Promise<Awaited<R>> {
  return page.evaluate(fn, arg);
}

// The consent framework: modules off until enabled, enable refusals, dry runs
// that send nothing (network blocked), consent, retries, events, and a
// sentinel key that never appears in any output, event or error.
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { briefBrand } from '../../../src/brand/fromBrief';
import { type SendContext, callCloud, pinnedFetch } from '../../../src/cloud/call';
import { enableModule, listModules, readProfile } from '../../../src/cloud/consent';
import { PROVIDERS, type ProviderRow } from '../../../src/cloud/providers';
import { MfmError } from '../../../src/cli/errors';
import { COMMANDS } from '../../../src/cli/commands/index';
import { readEvents } from '../../../src/paths/index';
import { runIn } from '../../unit/cli/harness';

const SENTINEL = 'sk-SENTINEL-7f3a9c-do-not-print';
const KEY_VARS = [...new Set(PROVIDERS.map((row) => row.keyVar))];
const temp = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));

/** Provider rows as MFM-090/091 will fill them, for exercising the call path. */
const VERIFIED: ProviderRow[] = PROVIDERS.map((row) => ({
  ...row,
  defaultModel: `${row.provider}-test-model`,
  verifiedAt: '2026-11-18',
  priceBasis: row.module === 'images' ? { unit: 'image', usdPerUnit: 0.04, source: 'test' } : { unit: 'char', usdPerUnit: 0.00003, source: 'test' },
}));

const saved: Record<string, string | undefined> = {};
let realFetch: typeof fetch;
beforeEach(() => {
  for (const name of KEY_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  realFetch = globalThis.fetch;
});
afterEach(() => {
  for (const name of KEY_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  globalThis.fetch = realFetch;
});

async function newProject(home: string): Promise<string> {
  const dir = path.join(temp('mfm-cloud-project-'), 'p');
  const result = await runIn(['new', 'Cloud Test', '--type', 'film', '--dir', dir, '--home', home, '--json'], COMMANDS, {});
  expect(result.code, result.stdout).toBe(0);
  return dir;
}

function allText(dir: string): string {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const file = path.join(at, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (statSync(file).size < 5_000_000) out.push(readFileSync(file, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}

describe('with no keys', () => {
  it('lists every module off and keyless, and fixture flows run end to end', async () => {
    const home = temp('mfm-home-');
    const list = await runIn(['cloud', 'list', '--home', home, '--json'], COMMANDS, {});
    expect(list.code).toBe(0);
    expect(JSON.parse(list.stdout).data.modules.map((m: { id: string; enabled: boolean; keyPresent: boolean }) => [m.id, m.enabled, m.keyPresent])).toEqual([
      ['voice-cloud', false, false],
      ['images', false, false],
      ['vision', false, false],
    ]);
    // Brand intake, a project and brand use: none of them needs a key.
    await briefBrand({ home, id: 'keyless', moods: ['calm'] });
    const project = await newProject(home);
    const use = await runIn(['brand', 'use', 'keyless', '--project', project, '--home', home, '--json'], COMMANDS, {});
    expect(use.code, use.stdout).toBe(0);
    expect(readEvents(project).some((event) => event.type === 'cloud.call' || event.type === 'consent.granted')).toBe(false);
  });
});

describe('cloud enable', () => {
  it('needs the key variable, then refuses providers without a verified default', async () => {
    const home = temp('mfm-home-');
    const missing = await runIn(['cloud', 'enable', 'images', '--provider', 'openai', '--home', home, '--json'], COMMANDS, {});
    expect(missing.code).toBe(3);
    expect(JSON.parse(missing.stdout).error).toMatchObject({ code: 'KEY_MISSING', details: { keyVar: 'OPENAI_API_KEY' } });
    const unverified = await runIn(['cloud', 'enable', 'images', '--provider', 'openai', '--home', home, '--json'], COMMANDS, { OPENAI_API_KEY: 'dummy' });
    expect(unverified.code).toBe(4);
    expect(JSON.parse(unverified.stdout).error).toMatchObject({ code: 'MODULE_DISABLED', details: { reason: 'no-verified-default' } });
    const unknown = await runIn(['cloud', 'enable', 'images', '--provider', 'nobody', '--home', home, '--json'], COMMANDS, { OPENAI_API_KEY: 'dummy' });
    expect(JSON.parse(unknown.stdout).error.code).toBe('USAGE');
    expect(readProfile(home).cloud.images.enabled).toBe(false);
  });

  it('with a verified row, enables, lists and disables', async () => {
    const home = temp('mfm-home-');
    const enabled = await enableModule({ home, module: 'voice-cloud', provider: 'elevenlabs', env: { ELEVENLABS_API_KEY: 'dummy' }, providers: VERIFIED });
    expect(enabled).toMatchObject({ id: 'voice-cloud', provider: 'elevenlabs', model: 'elevenlabs-test-model', host: 'api.elevenlabs.io' });
    expect(readProfile(home).cloud['voice-cloud']).toEqual({ enabled: true, provider: 'elevenlabs', model: null });
    expect(listModules(home, { ELEVENLABS_API_KEY: 'dummy' }, VERIFIED)[0]).toMatchObject({ enabled: true, provider: 'elevenlabs', keyPresent: true });
    const off = await runIn(['cloud', 'disable', 'voice-cloud', '--home', home, '--json'], COMMANDS, {});
    expect(JSON.parse(off.stdout).data.module).toEqual({ id: 'voice-cloud', enabled: false });
    expect(readProfile(home).cloud['voice-cloud'].enabled).toBe(false);
  });
});

describe('callCloud', () => {
  async function enabledHome(): Promise<string> {
    const home = temp('mfm-home-');
    await enableModule({ home, module: 'images', provider: 'openai', env: { OPENAI_API_KEY: 'dummy' }, providers: VERIFIED });
    return home;
  }
  const items = [{ kind: 'text' as const, bytes: 214, chars: 207 }];

  it('dry-run prints host and byte counts and, with the network blocked, sends nothing', async () => {
    const home = await enabledHome();
    let attempts = 0;
    globalThis.fetch = (() => {
      attempts += 1;
      throw new Error('network blocked');
    }) as typeof fetch;
    let sendCalls = 0;
    const result = await callCloud({
      module: 'images', home, project: null, env: { OPENAI_API_KEY: 'dummy' }, dryRun: true, yes: false, command: 'mf-motion image --prompt x', items, providers: VERIFIED,
      send: async () => {
        sendCalls += 1;
      },
    });
    expect(result).toEqual({ sent: false, wouldSend: { module: 'images', provider: 'openai', model: 'openai-test-model', host: 'api.openai.com', items, estimatedCostUsd: 0.04 } });
    expect([attempts, sendCalls]).toEqual([0, 0]);
  });

  it('refuses without consent, then with --yes records consent and the call, retrying one 5xx', async () => {
    const home = await enabledHome();
    const project = await newProject(home);
    const base = { module: 'images' as const, home, project, env: { OPENAI_API_KEY: 'dummy', ELEVENLABS_API_KEY: 'other' }, dryRun: false, command: 'mf-motion image --prompt x', items, providers: VERIFIED };
    const refused = await callCloud({ ...base, yes: false, send: async () => 'never' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MfmError);
    expect(refused).toMatchObject({ code: 'CONSENT_MISSING', next: ['mf-motion image --prompt x --yes'], details: { wouldSend: { host: 'api.openai.com' } } });
    expect(readEvents(project).filter((event) => event.type === 'consent.granted')).toEqual([]);

    const statuses = [503, 200];
    const sleeps: number[] = [];
    const seen: SendContext[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      expect(url.host).toBe('api.openai.com');
      expect(init.signal).toBeDefined();
      return new Response('{"ok":true}', { status: statuses.shift() ?? 200 });
    }) as unknown as typeof fetch;
    const sent = await callCloud({
      ...base, yes: true, fetchImpl, sleep: async (ms) => void sleeps.push(ms),
      send: async (context) => {
        seen.push(context);
        return (await context.fetch('/v1/images', { method: 'POST', headers: { authorization: `Bearer ${context.key}` } })).json();
      },
    });
    expect(sent).toMatchObject({ sent: true, result: { ok: true } });
    expect(sleeps).toEqual([2000]);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['fetch', 'host', 'key', 'model']);
    expect(seen[0]?.key).toBe('dummy');
    const events = readEvents(project);
    expect(events.filter((event) => event.type === 'consent.granted').map((event) => event.data)).toEqual([{ module: 'images', scope: 'project' }]);
    expect(events.filter((event) => event.type === 'cloud.call').map((event) => event.data)).toEqual([
      { module: 'images', provider: 'openai', model: 'openai-test-model', host: 'api.openai.com', bytesUp: 214, estimatedCostUsd: 0.04 },
    ]);
    // Consent is recorded once per project and module.
    await callCloud({ ...base, yes: true, fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch, send: async (context) => (await context.fetch('/v1/images')).json() });
    expect(readEvents(project).filter((event) => event.type === 'consent.granted')).toHaveLength(1);
  });

  it('does not retry a 4xx and refuses other hosts and disabled modules', async () => {
    const home = await enabledHome();
    let calls = 0;
    const fetch400 = (async () => {
      calls += 1;
      return new Response('bad request', { status: 400 });
    }) as unknown as typeof fetch;
    const bad = await pinnedFetch('api.openai.com', 'k', { fetchImpl: fetch400 })('/v1/x').catch((error: unknown) => error);
    expect(bad).toMatchObject({ code: 'TOOL_FAILED', details: { status: 400 } });
    expect(calls).toBe(1);
    await expect(pinnedFetch('api.openai.com', 'k', { fetchImpl: fetch400 })('https://evil.example/x')).rejects.toMatchObject({ code: 'PATH_ESCAPES_ROOT' });
    await expect(callCloud({ module: 'vision', home, project: null, env: {}, dryRun: true, yes: false, command: 'x', items, providers: VERIFIED, send: async () => 0 })).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
});

describe('sentinel key', () => {
  it('never appears in any output, event, error or file', async () => {
    const env = Object.fromEntries(KEY_VARS.map((name) => [name, SENTINEL]));
    for (const name of KEY_VARS) process.env[name] = SENTINEL;
    const home = temp('mfm-home-');
    const outputs: string[] = [];
    for (const args of [
      ['cloud', 'list'],
      ['cloud', 'enable', 'images', '--provider', 'openai'],
      ['cloud', 'enable', 'voice-cloud', '--provider', 'nobody'],
      ['cloud', 'disable', 'images'],
      ['cloud', 'list', '--verbose'],
    ]) {
      const result = await runIn([...args, '--home', home, '--json'], COMMANDS, env);
      outputs.push(result.stdout, result.stderr);
    }
    await enableModule({ home, module: 'images', provider: 'openai', env, providers: VERIFIED });
    const project = await newProject(home);
    // The provider echoes the key back in an error body and in a thrown message.
    const echo = (async (url: URL) => new Response(`invalid key ${SENTINEL} for ${url} ${encodeURIComponent(SENTINEL)}`, { status: 401 })) as unknown as typeof fetch;
    const base = { module: 'images' as const, home, project, env, command: 'mf-motion image --prompt x', items: [{ kind: 'text' as const, bytes: 10, chars: 10 }], providers: VERIFIED };
    for (const attempt of [
      callCloud({ ...base, dryRun: true, yes: false, send: async () => 0 }),
      callCloud({ ...base, dryRun: false, yes: false, send: async () => 0 }),
      callCloud({ ...base, dryRun: false, yes: true, fetchImpl: echo, send: async (context) => context.fetch(`/v1/x?key=${context.key}`) }),
      callCloud({ ...base, dryRun: false, yes: true, send: async (context) => { throw new Error(`boom ${context.key}`); } }),
      callCloud({ ...base, dryRun: false, yes: true, send: async (context) => { throw new MfmError('TOOL_FAILED', { echoed: context.key }, { message: `x ${context.key}` }); } }),
    ]) {
      const outcome = await attempt.catch((error: unknown) => error);
      outputs.push(JSON.stringify(outcome), outcome instanceof Error ? `${outcome.message} ${JSON.stringify((outcome as MfmError).details)}` : '');
    }
    outputs.push(allText(home), allText(project));
    const joined = outputs.join('\n');
    expect(joined).toContain('[redacted]');
    expect(joined).not.toContain(SENTINEL);
    expect(joined).not.toContain(encodeURIComponent(SENTINEL));
  });
});

// Cloud module state in profile.json and consent in the project event log.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MfmError } from '../cli/errors';
import { appendEvent, homeLayout, readEvents, withLock } from '../paths/index';
import { readDoc, writeDoc } from '../schemas/index';
import { CLOUD_MODULES, PROFILE_VERSION, type ProfileDoc } from '../schemas/profile';
import { type CloudModule, PROVIDERS, type ProviderRow, hasVerifiedDefault, providerRow } from './providers';

export function isCloudModule(value: string): value is CloudModule {
  return (CLOUD_MODULES as readonly string[]).includes(value);
}

export function checkModule(value: string): CloudModule {
  if (!isCloudModule(value)) {
    throw new MfmError('USAGE', { module: value, modules: CLOUD_MODULES }, { message: `"${value}" is not a cloud module.`, hint: `Use one of: ${CLOUD_MODULES.join(', ')}.` });
  }
  return value;
}

/** A profile with every module off, for a data home that has not been onboarded yet. */
export function defaultProfile(now = new Date()): ProfileDoc {
  const off = { enabled: false, provider: null, model: null };
  const at = now.toISOString();
  return {
    schemaVersion: PROFILE_VERSION,
    kind: 'profile',
    brand: null,
    editor: 'none',
    aspect: '16:9',
    overlayExport: 'webm',
    language: 'en',
    rightsNoticeShownAt: null,
    cloud: { 'voice-cloud': { ...off }, images: { ...off }, vision: { ...off } },
    createdAt: at,
    updatedAt: at,
  };
}

export const profileFile = (home: string) => homeLayout(home).profile;

export function readProfile(home: string): ProfileDoc {
  const file = profileFile(home);
  return existsSync(file) ? readDoc('profile', file).doc : defaultProfile();
}

async function updateProfile(home: string, command: string, change: (doc: ProfileDoc) => ProfileDoc): Promise<ProfileDoc> {
  const file = profileFile(home);
  return withLock(path.join(path.dirname(file), '.profile.lock'), () => {
    const next = { ...change(readProfile(home)), updatedAt: new Date().toISOString() };
    writeDoc('profile', file, next);
    return next;
  }, { command });
}

export interface EnableResult {
  id: CloudModule;
  enabled: true;
  provider: string;
  model: string;
  host: string;
  sends: string;
}

/** cloud enable: key present, provider row with a verified default; writes profile.cloud[module]. */
export async function enableModule(options: {
  home: string;
  module: string;
  provider: string;
  model?: string;
  env: NodeJS.ProcessEnv;
  providers?: readonly ProviderRow[];
}): Promise<EnableResult> {
  const module = checkModule(options.module);
  const rows = options.providers ?? PROVIDERS;
  const row = providerRow(module, options.provider, rows);
  if (!row) {
    const names = rows.filter((entry) => entry.module === module).map((entry) => entry.provider);
    throw new MfmError('USAGE', { module, provider: options.provider, providers: names }, { message: `${module} has no provider "${options.provider}".`, hint: `Use one of: ${names.join(', ')}.` });
  }
  if (!options.env[row.keyVar]) {
    throw new MfmError('KEY_MISSING', { module, provider: row.provider, keyVar: row.keyVar }, { message: `${row.keyVar} is not set.` });
  }
  if (!hasVerifiedDefault(row)) {
    throw new MfmError('MODULE_DISABLED', { module, provider: row.provider, reason: 'no-verified-default' }, {
      message: `${module} with ${row.provider} has no verified default model yet, so it cannot be enabled.`,
      hint: 'This provider becomes available in a release that verifies its model list; local alternatives work meanwhile.',
    });
  }
  const model = options.model ?? null;
  await updateProfile(options.home, 'cloud enable', (doc) => ({ ...doc, cloud: { ...doc.cloud, [module]: { enabled: true, provider: row.provider, model } } }));
  return { id: module, enabled: true, provider: row.provider, model: model ?? (row.defaultModel as string), host: row.host, sends: row.sends };
}

export async function disableModule(home: string, value: string): Promise<{ id: CloudModule; enabled: false }> {
  const module = checkModule(value);
  await updateProfile(home, 'cloud disable', (doc) => ({ ...doc, cloud: { ...doc.cloud, [module]: { enabled: false, provider: null, model: null } } }));
  return { id: module, enabled: false };
}

export interface ModuleListing {
  id: CloudModule;
  enabled: boolean;
  provider: string | null;
  keyPresent: boolean;
  models: Array<{ provider: string; model: string | null; verified: boolean; host: string }>;
}

export function listModules(home: string, env: NodeJS.ProcessEnv, providers: readonly ProviderRow[] = PROVIDERS): ModuleListing[] {
  const profile = readProfile(home);
  return CLOUD_MODULES.map((id) => {
    const state = profile.cloud[id];
    const rows = providers.filter((row) => row.module === id);
    const keyed = state.provider ? rows.filter((row) => row.provider === state.provider) : rows;
    return {
      id,
      enabled: state.enabled,
      provider: state.provider,
      keyPresent: keyed.some((row) => Boolean(env[row.keyVar])),
      models: rows.map((row) => ({ provider: row.provider, model: state.provider === row.provider && state.model ? state.model : row.defaultModel, verified: hasVerifiedDefault(row), host: row.host })),
    };
  });
}

/** True when the project's event log holds consent for this module. */
export function hasConsent(project: string | null, module: CloudModule): boolean {
  if (!project) return false;
  return readEvents(project).some((event) => event.type === 'consent.granted' && (event.data as { module?: string }).module === module);
}

export function recordConsent(project: string, module: CloudModule): void {
  appendEvent(project, { type: 'consent.granted', actor: 'user', data: { module, scope: 'project' } }, { command: 'cloud consent' });
}


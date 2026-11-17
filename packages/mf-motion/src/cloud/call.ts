// Every cloud call goes through callCloud: compute wouldSend, then dry-run,
// refuse without consent, or (with --yes) record consent, send with only the
// module's own key, and record the call. Keys never appear in any output.
import { MfmError } from '../cli/errors';
import { appendEvent } from '../paths/index';
import { hasConsent, readProfile, recordConsent } from './consent';
import { type CloudModule, PROVIDERS, type ProviderRow, providerRow } from './providers';

export interface SendItem {
  kind: 'text' | 'image' | 'audio';
  bytes: number;
  chars: number;
}

export interface WouldSend {
  module: CloudModule;
  provider: string;
  model: string;
  host: string;
  items: SendItem[];
  estimatedCostUsd: number;
}

export const HTTP = { timeoutMs: 60_000, retryDelayMs: 2_000 } as const;

export interface SendContext {
  /** The module's own key; pass it only in this call's request. */
  key: string;
  model: string;
  host: string;
  /** fetch with the timeout, retry rule and host pin applied. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export interface CloudRequest<T> {
  module: CloudModule;
  home: string;
  /** Open project (consent and events live there), or null. */
  project: string | null;
  env: NodeJS.ProcessEnv;
  dryRun: boolean;
  yes: boolean;
  /** The command line to repeat with --yes. */
  command: string;
  items: SendItem[];
  send: (context: SendContext) => Promise<T>;
  providers?: readonly ProviderRow[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type CloudResult<T> = { sent: false; wouldSend: WouldSend } | { sent: true; wouldSend: WouldSend; result: T };

/** Replace every occurrence of the key (and its URL-encoded form) in a text. */
export function redact(text: string, key: string | undefined): string {
  if (!key) return text;
  return text.split(key).join('[redacted]').split(encodeURIComponent(key)).join('[redacted]');
}

function estimate(row: ProviderRow, items: SendItem[]): number {
  const basis = row.priceBasis;
  if (!basis) return 0;
  const units = basis.unit === 'char' ? items.reduce((sum, item) => sum + item.chars, 0) : basis.unit === 'image' ? items.filter((item) => item.kind === 'image').length || 1 : 1;
  return Math.round(units * basis.usdPerUnit * 10_000) / 10_000;
}

/** fetch pinned to one host: 60 s timeout, no retry on 4xx, one retry on 5xx after 2 s. */
export function pinnedFetch(host: string, key: string, options: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (pathname: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(pathname, `https://${host}`);
    if (url.host !== host || url.protocol !== 'https:') throw new MfmError('PATH_ESCAPES_ROOT', { host: url.host }, { message: `A cloud call may only reach ${host}.` });
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(url, { ...init, signal: AbortSignal.timeout(HTTP.timeoutMs) });
      } catch (error) {
        const name = (error as Error).name;
        throw new MfmError(name === 'TimeoutError' ? 'TIMEOUT' : 'TOOL_FAILED', { host }, { message: redact(`${host}: ${(error as Error).message}`, key) });
      }
      if (response.ok) return response;
      if (response.status >= 500 && attempt === 1) {
        await sleep(HTTP.retryDelayMs);
        continue;
      }
      const body = redact((await response.text().catch(() => '')).slice(0, 500), key);
      throw new MfmError('TOOL_FAILED', { host, status: response.status }, { message: `${host} answered ${response.status}: ${body}` });
    }
  };
}

/** The consent-gated path every cloud module call takes. */
export async function callCloud<T>(request: CloudRequest<T>): Promise<CloudResult<T>> {
  const state = readProfile(request.home).cloud[request.module];
  if (!state.enabled || !state.provider) {
    throw new MfmError('MODULE_DISABLED', { module: request.module }, { message: `The ${request.module} module is off.` });
  }
  const row = providerRow(request.module, state.provider, request.providers ?? PROVIDERS);
  const model = state.model ?? row?.defaultModel ?? null;
  if (!row || !model) {
    throw new MfmError('MODULE_DISABLED', { module: request.module, provider: state.provider, reason: 'no-verified-default' }, { message: `${request.module} with ${state.provider} has no verified model.` });
  }
  const wouldSend: WouldSend = { module: request.module, provider: row.provider, model, host: row.host, items: request.items, estimatedCostUsd: estimate(row, request.items) };
  if (request.dryRun) return { sent: false, wouldSend };
  const key = request.env[row.keyVar];
  if (!key) throw new MfmError('KEY_MISSING', { module: request.module, keyVar: row.keyVar }, { message: `${row.keyVar} is not set.` });
  if (!request.yes) {
    throw new MfmError('CONSENT_MISSING', { wouldSend }, {
      message: `This ${request.module} call sends ${request.items.length} item(s) to ${row.host}${hasConsent(request.project, request.module) ? '' : ' and has no consent yet'}.`,
      next: [`${request.command} --yes`],
    });
  }
  if (request.project && !hasConsent(request.project, request.module)) recordConsent(request.project, request.module);
  let result: T;
  try {
    result = await request.send({ key, model, host: row.host, fetch: pinnedFetch(row.host, key, { ...(request.fetchImpl ? { fetchImpl: request.fetchImpl } : {}), ...(request.sleep ? { sleep: request.sleep } : {}) }) });
  } catch (error) {
    if (error instanceof MfmError) throw new MfmError(error.code, JSON.parse(redact(JSON.stringify(error.details), key)), { message: redact(error.message, key), hint: error.hint });
    throw new MfmError('TOOL_FAILED', { host: row.host }, { message: redact(`${row.host}: ${(error as Error).message}`, key) });
  }
  if (request.project) {
    const bytesUp = request.items.reduce((sum, item) => sum + item.bytes, 0);
    appendEvent(request.project, { type: 'cloud.call', actor: 'cli', data: { module: request.module, provider: row.provider, model, host: row.host, bytesUp, estimatedCostUsd: wouldSend.estimatedCostUsd } }, { command: request.command });
  }
  return { sent: true, wouldSend, result };
}

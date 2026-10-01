import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ShieldLabs,
  ValidationError,
  evaluateIdentification,
  getIdentification,
} from '../src/server';
import {
  API_KEY,
  callOf,
  fakeFetch,
  historyPage,
  historyRows,
  jsonResponse,
  readJson,
  type HistoryRow,
} from './helpers';

const [ROW] = historyRows() as [HistoryRow];
const REQUEST_ID = ROW.request_id;
const empty = (): Response => historyPage([]);
const found = (): Response => historyPage([ROW]);

interface ErrorCase {
  surface: string;
  status: number;
  content_type: string | null;
  body: string;
  expected_error: string;
}

const ERROR_CLASSES: Record<string, unknown> = { AuthenticationError, NotFoundError, RateLimitError, ServerError };
const historyErrors = (readJson('error-responses.json') as { cases: ErrorCase[] }).cases.filter(
  (item) => item.surface === 'history',
);

function useEnvironment(apiKey: string | undefined, baseUrl?: string): void {
  vi.stubEnv('SHIELDLABS_API_KEY', apiKey);
  vi.stubEnv('SHIELDLABS_API_BASE_URL', baseUrl);
}

describe('getIdentification with the client from the environment', () => {
  it('reads the identification by request ID with SHIELDLABS_API_KEY', async () => {
    useEnvironment(API_KEY);
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);

    const identification = await getIdentification(REQUEST_ID, { wait: false });

    expect(identification).toMatchObject({ request_id: REQUEST_ID, risk_score: 80, source: 'history' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const { url, init } = callOf(fetchFn);
    expect(url.origin + url.pathname).toBe(`https://account.shieldlabs.ai/api/v1/history/request_id/${REQUEST_ID}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '1', offset: '0' });
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    // Never kept by the Next.js Data Cache.
    expect(init.cache).toBe('no-store');
  });

  it('waits for the History row by default', async () => {
    useEnvironment(API_KEY);
    const fetchFn = fakeFetch(empty, found);
    vi.stubGlobal('fetch', fetchFn);

    const identification = await getIdentification(REQUEST_ID, { pollInterval: 10 });

    expect(identification?.request_id).toBe(REQUEST_ID);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('resolves null when no identification appears within the timeout', async () => {
    useEnvironment(API_KEY);
    vi.stubGlobal('fetch', fakeFetch(empty));
    expect(await getIdentification(REQUEST_ID, { timeout: 0 })).toBeNull();
    expect(await getIdentification(REQUEST_ID, { wait: false })).toBeNull();
  });

  it('a missing identification is refused by evaluateIdentification', async () => {
    useEnvironment(API_KEY);
    vi.stubGlobal('fetch', fakeFetch(empty));
    const verdict = evaluateIdentification(await getIdentification(REQUEST_ID, { wait: false }));
    expect(verdict).toEqual({ ok: false, reason: 'missing', band: null });
  });

  it('sends requests to SHIELDLABS_API_BASE_URL when it is set', async () => {
    useEnvironment(API_KEY, 'https://dev.account.shieldlabs.ai/api/');
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    await getIdentification(REQUEST_ID, { wait: false });
    expect(callOf(fetchFn).url.href.startsWith('https://dev.account.shieldlabs.ai/api/v1/history/request_id/')).toBe(true);
  });

  it('trims the variables', async () => {
    useEnvironment(`  ${API_KEY}\n`, ' https://dev.account.shieldlabs.ai ');
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    await getIdentification(REQUEST_ID, { wait: false });
    const { url, init } = callOf(fetchFn);
    expect(url.origin).toBe('https://dev.account.shieldlabs.ai');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it.each([
    ['not set', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('rejects with a ValidationError when SHIELDLABS_API_KEY is %s, before any request', async (_label, value) => {
    useEnvironment(value);
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    const failure = getIdentification(REQUEST_ID);
    await expect(failure).rejects.toBeInstanceOf(ValidationError);
    await expect(failure).rejects.toThrow(/SHIELDLABS_API_KEY is not set/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never includes a key in the error message', async () => {
    useEnvironment(undefined);
    vi.stubEnv('NEXT_PUBLIC_SHIELDLABS_API_KEY', API_KEY);
    await expect(getIdentification(REQUEST_ID)).rejects.not.toThrow(API_KEY);
  });

  it('keeps one client while the variables stay the same and creates a new one when they change', async () => {
    useEnvironment(API_KEY);
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    await getIdentification(REQUEST_ID, { wait: false });
    await getIdentification(REQUEST_ID, { wait: false });
    const otherKey = 'sec_other000-other000-other000';
    useEnvironment(otherKey);
    await getIdentification(REQUEST_ID, { wait: false });
    const authorization = (index: number): string =>
      (callOf(fetchFn, index).init.headers as Record<string, string>).Authorization ?? '';
    expect([authorization(0), authorization(1), authorization(2)]).toEqual([
      `Bearer ${API_KEY}`,
      `Bearer ${API_KEY}`,
      `Bearer ${otherKey}`,
    ]);
  });

  it('accepts plain http in SHIELDLABS_API_BASE_URL only for a loopback host', async () => {
    useEnvironment(API_KEY, 'http://account.example.com');
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    const failure = getIdentification(REQUEST_ID, { wait: false });
    await expect(failure).rejects.toBeInstanceOf(ValidationError);
    await expect(failure).rejects.toThrow(/SHIELDLABS_API_BASE_URL: baseUrl must be an https URL/);
    expect(fetchFn).not.toHaveBeenCalled();

    useEnvironment(API_KEY, 'http://127.0.0.1:8787');
    await getIdentification(REQUEST_ID, { wait: false });
    expect(callOf(fetchFn).url.origin).toBe('http://127.0.0.1:8787');
  });

  it('rejects a key that cannot be sent in a header, without repeating it', async () => {
    useEnvironment(`${API_KEY}\nX-Injected: 1`);
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    const error: unknown = await getIdentification(REQUEST_ID, { wait: false }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ValidationError);
    expect(inspect(error, { depth: 5 })).not.toContain(API_KEY);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('names the variables when the client cannot be created from them', async () => {
    useEnvironment(API_KEY, 'not a url');
    const failure = getIdentification(REQUEST_ID);
    await expect(failure).rejects.toBeInstanceOf(ValidationError);
    await expect(failure).rejects.toThrow(/SHIELDLABS_API_BASE_URL: baseUrl is not a valid URL/);
    const error = (await failure.catch((reason: unknown) => reason)) as Error;
    expect(error.cause).toBeInstanceOf(ValidationError);
  });

  it('stops at once on 401 and propagates the AuthenticationError', async () => {
    useEnvironment(API_KEY);
    const fetchFn = fakeFetch(() => jsonResponse('{"error":"invalid api key"}\n', 401, 'text/plain; charset=utf-8'));
    vi.stubGlobal('fetch', fetchFn);
    await expect(getIdentification(REQUEST_ID)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a request ID that is not a UUID before any request', async () => {
    useEnvironment(API_KEY);
    const fetchFn = fakeFetch(found);
    vi.stubGlobal('fetch', fetchFn);
    await expect(getIdentification('not-a-request-id')).rejects.toBeInstanceOf(ValidationError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes the abort signal through', async () => {
    useEnvironment(API_KEY);
    vi.stubGlobal('fetch', fakeFetch(found));
    const reason = new Error('client went away');
    await expect(getIdentification(REQUEST_ID, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });
});

describe('getIdentification with a client', () => {
  it('uses the client and ignores the environment', async () => {
    useEnvironment(undefined);
    const globalFetch = fakeFetch(found);
    vi.stubGlobal('fetch', globalFetch);
    const clientFetch = fakeFetch(found);
    const client = new ShieldLabs({ apiKey: API_KEY, fetch: clientFetch });

    const identification = await getIdentification(REQUEST_ID, { client, wait: false });

    expect(identification?.request_id).toBe(REQUEST_ID);
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  for (const item of historyErrors) {
    it(`propagates ${item.expected_error} for a History ${String(item.status)} response`, async () => {
      const clientFetch = fakeFetch(() => jsonResponse(item.body, item.status, item.content_type ?? 'text/plain'));
      const client = new ShieldLabs({ apiKey: API_KEY, fetch: clientFetch, maxRetries: 0 });
      const expected = ERROR_CLASSES[item.expected_error] as abstract new (...args: never[]) => Error;
      await expect(getIdentification(REQUEST_ID, { client, wait: false })).rejects.toBeInstanceOf(expected);
    });
  }

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['a function', () => undefined],
  ])('rejects %s as client', async (_label, client) => {
    await expect(getIdentification(REQUEST_ID, { client: client as never })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects options that are not an object', async () => {
    await expect(getIdentification(REQUEST_ID, null as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(getIdentification(REQUEST_ID, 'wait' as never)).rejects.toBeInstanceOf(ValidationError);
  });
});

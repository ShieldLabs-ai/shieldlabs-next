import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

const DATA = new URL('./data/', import.meta.url);

/** The secret of the ping and of the scored vectors in the shared fixtures. */
export const SECRET = 'whsec_00112233445566778899aabbccddeeff';
/** A Private API Key in the documented format (sec_ + 8-8-8), so the SDK prints no format warning. */
export const API_KEY = 'sec_test0000-test0000-test0000';
export const WEBHOOK_URL = 'https://example.com/api/shieldlabs/webhook';

export function readData(name: string): string {
  return readFileSync(new URL(name, DATA), 'utf8');
}

export function readJson(name: string): unknown {
  return JSON.parse(readData(name));
}

export interface SignatureVector {
  name: string;
  secret?: string;
  secrets?: string[];
  body: string;
  body_base64: string;
  signature_header: string;
  valid: boolean;
  note: string;
}

export function signatureVectors(): SignatureVector[] {
  return (readJson('webhook-signature-vectors.json') as { vectors: SignatureVector[] }).vectors;
}

/** The exact bytes of a vector. */
export function vectorBytes(vector: SignatureVector): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(vector.body_base64, 'base64'));
}

/** `sha256=<hex HMAC-SHA256>` of the body, keyed with the full secret string. */
export function sign(body: string | Uint8Array, secret: string = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/** A delivery as ShieldLabs sends it. `signature: null` leaves the header out. */
export function webhookRequest(
  body: string | Uint8Array<ArrayBuffer>,
  signature: string | null,
  method = 'POST',
): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('x-shield-signature', signature);
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(WEBHOOK_URL, { method, headers, body: hasBody ? body : null });
}

/** A signed delivery of `body`. */
export function signedRequest(body: string, secret: string = SECRET): Request {
  return webhookRequest(body, sign(body, secret));
}

export interface HistoryRow {
  request_id: string;
  [key: string]: unknown;
}

export function historyRows(): HistoryRow[] {
  return (readJson('history-page.json') as { data: HistoryRow[] }).data;
}

export function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

/** A History API 200 body with the rows that match a request ID lookup. */
export function historyPage(rows: HistoryRow[]): Response {
  return jsonResponse({ data: rows, total: rows.length });
}

export type FakeFetch = ReturnType<typeof fakeFetch>;

/** A fetch that answers from a queue (the last answer repeats) and records every call. */
export function fakeFetch(...answers: (() => Response)[]) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => {
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === undefined) return Promise.reject(new Error('fakeFetch has no answer'));
    return Promise.resolve(answer());
  });
}

/** The URL and init of one recorded fetch call. */
export function callOf(fetchFn: FakeFetch, index = 0): { url: URL; init: RequestInit } {
  const call = fetchFn.mock.calls[index];
  if (call === undefined) throw new Error('fetch was not called ' + String(index + 1) + ' times');
  return { url: new URL(call[0]), init: call[1] ?? {} };
}

/** A promise with its resolve function, to control when an async callback settles. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

import { describe, expect, it, vi } from 'vitest';
import {
  SignatureVerificationError,
  ValidationError,
  WebhookParseError,
  createWebhookHandler,
  isRateLimited,
  riskBand,
  type WebhookErrorContext,
  type WebhookHandlerEvent,
  type WebhookHandlerOptions,
} from '../src/server';
import {
  SECRET,
  deferred,
  readData,
  sign,
  signatureVectors,
  signedRequest,
  vectorBytes,
  WEBHOOK_URL,
  webhookRequest,
} from './helpers';

const PING = readData('webhook-ping.raw.txt');
const SCORED = readData('webhook-identification-scored.raw.txt');
/** The fixture parsed and serialized again: the handler verifies whatever bytes arrive. */
const compact = (name: string): string => JSON.stringify(JSON.parse(readData(name)));

function setup(options: Pick<WebhookHandlerOptions, 'secret' | 'maxBodySize'> = { secret: SECRET }) {
  const onEvent = vi.fn<(event: WebhookHandlerEvent) => unknown>();
  const onError = vi.fn<(error: unknown, context: WebhookErrorContext) => unknown>();
  const handler = createWebhookHandler({ ...options, onEvent, onError });
  return { handler, onEvent, onError };
}

function onlyEvent(onEvent: ReturnType<typeof setup>['onEvent']): WebhookHandlerEvent {
  expect(onEvent).toHaveBeenCalledTimes(1);
  return onEvent.mock.calls[0]![0];
}

function onlyError(onError: ReturnType<typeof setup>['onError']): [unknown, WebhookErrorContext] {
  expect(onError).toHaveBeenCalledTimes(1);
  return onError.mock.calls[0]!;
}

describe('createWebhookHandler: shared signature vectors', () => {
  for (const vector of signatureVectors()) {
    it(`${vector.name} (${vector.valid ? 'valid' : 'invalid'})`, async () => {
      const { handler, onEvent, onError } = setup({ secret: vector.secrets ?? vector.secret ?? '' });
      const response = await handler(webhookRequest(vectorBytes(vector), vector.signature_header));
      const eventType = (JSON.parse(vector.body) as { event_type: string }).event_type;

      if (vector.valid) {
        expect(response.status).toBe(200);
        expect(onError).not.toHaveBeenCalled();
        // Pings are acknowledged without calling onEvent.
        expect(onEvent).toHaveBeenCalledTimes(eventType === 'webhook.ping' ? 0 : 1);
      } else {
        // An empty secret is a configuration error of the endpoint (500), everything else is a 401.
        expect(response.status).toBe(vector.secret === '' ? 500 : 401);
        expect(onEvent).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
      }
    });
  }
});

describe('createWebhookHandler: deliveries', () => {
  it('acknowledges webhook.ping with 200 and does not call onEvent', async () => {
    const { handler, onEvent, onError } = setup();
    const response = await handler(webhookRequest(PING, 'sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ received: true });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('passes identification.scored to onEvent as a typed, normalized event', async () => {
    const { handler, onEvent } = setup();
    const response = await handler(signedRequest(SCORED));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const event = onlyEvent(onEvent);
    if (event.event_type !== 'identification.scored') throw new Error('expected a scored event');
    expect(event.schema_version).toBe('2026-06-01');
    expect(event.created_at).toBe('2026-09-30T12:34:57.482913041Z');
    expect(event.data).toMatchObject({
      request_id: '02f1d973-84db-4156-a7f7-e799e6bf389b',
      device_id: 'ac7c303d-971b-41d1-8e25-cd5b46b46aed',
      user_hid: '9f86d081884c7d659a2feaa0c55ad015',
      public_ip: { ip: '203.0.113.24', country: 'Netherlands' },
      connection_type: 'proxy',
      risk_score: 80,
      observed_at: '2026-09-30T12:34:57.482Z',
      source: 'webhook',
    });
    expect(event.data.detection_flags.proxy).toBe(true);
    expect(event.data.detection_flags.browser_automation).toBe(false);
    expect(event.data.signals.map((signal) => signal.name)).toEqual(['proxy', 'datacenter_ip', 'antidetect_browser']);
    expect(riskBand(event.data.risk_score)).toBe('dangerous');
  });

  it('answers 200 only after onEvent resolves', async () => {
    const gate = deferred();
    let settled = false;
    const handler = createWebhookHandler({ secret: SECRET, onEvent: () => gate.promise });
    const pending = handler(signedRequest(SCORED)).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    gate.resolve();
    expect((await pending).status).toBe(200);
  });

  it('parses the 999 rate-limit marker event', async () => {
    const { handler, onEvent } = setup();
    expect((await handler(signedRequest(compact('webhook-rate-limited.json')))).status).toBe(200);
    const event = onlyEvent(onEvent);
    if (event.event_type !== 'identification.scored') throw new Error('expected a scored event');
    expect(event.data.risk_score).toBe(999);
    expect(isRateLimited(event.data.risk_score)).toBe(true);
    expect(riskBand(event.data.risk_score)).toBe('rate_limited');
    expect(event.data.signals).toEqual([{ name: 'rate_limited', weight: 999, description: null }]);
  });

  it('parses the Test delivery of the analytics dashboard (17 flags, the missing ones are false)', async () => {
    const { handler, onEvent } = setup();
    expect((await handler(signedRequest(compact('webhook-test-delivery.json')))).status).toBe(200);
    const event = onlyEvent(onEvent);
    if (event.event_type !== 'identification.scored') throw new Error('expected a scored event');
    expect(event.data.request_id).toBe('13f84f05-7c2a-4e9b-9f1d-2a6b8c0e4d11');
    expect(event.data.user_hid).toBeNull();
    expect(event.data.detection_flags.browser_automation).toBe(false);
    expect(event.data.detection_flags.search_bot).toBe(false);
    expect(Object.keys(event.data.detection_flags)).toHaveLength(19);
  });

  it('passes an event type this version does not know to onEvent', async () => {
    const { handler, onEvent } = setup();
    const body = '{"created_at":"2026-09-30T12:40:00Z","event_type":"identification.refined","schema_version":"2026-06-01"}';
    expect((await handler(signedRequest(body))).status).toBe(200);
    const event = onlyEvent(onEvent);
    expect(event.event_type).toBe('identification.refined');
    expect(event.raw).toEqual(JSON.parse(body));
  });
});

describe('createWebhookHandler: rejected deliveries', () => {
  it('answers 401 without reading the body when the signature header is missing', async () => {
    const { handler, onEvent, onError } = setup();
    const request = webhookRequest(SCORED, null);
    const response = await handler(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_signature' });
    expect(request.bodyUsed).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(SignatureVerificationError);
    expect(context).toEqual({ request, status: 401 });
  });

  it.each([
    ['a digest that is not hex', 'sha256=not-a-digest'],
    ['an empty header', ''],
    ['a header without the sha256= prefix', sign(SCORED).slice('sha256='.length)],
    ['another algorithm', 'sha1=' + sign(SCORED).slice('sha256='.length)],
    ['a digest one character short', sign(SCORED).slice(0, -1)],
    ['two signatures in one header', `${sign(SCORED)}, ${sign(SCORED)}`],
  ])('answers 401 without reading the body for %s', async (_label, signature) => {
    const { handler, onEvent, onError } = setup();
    const request = webhookRequest(SCORED, signature);
    const response = await handler(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_signature' });
    expect(request.bodyUsed).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(SignatureVerificationError);
    expect((error as Error).message).toContain('malformed');
    expect(context.status).toBe(401);
  });

  it.each([
    ['a signature made with another secret', sign(SCORED, 'whsec_ffeeddccbbaa99887766554433221100')],
    ['a signature of other bytes', sign(SCORED.replace('"risk_score":80', '"risk_score":10'))],
  ])('answers 401 for %s', async (_label, signature) => {
    const { handler, onEvent, onError } = setup();
    const response = await handler(webhookRequest(SCORED, signature));
    expect(response.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onlyError(onError)[0]).toBeInstanceOf(SignatureVerificationError);
  });

  it.each([
    ['a body that is not JSON', 'event_type=identification.scored'],
    ['a JSON array', '[1,2,3]'],
    ['an object without event_type', '{"schema_version":"2026-06-01"}'],
    ['a scored event without data', '{"event_type":"identification.scored","schema_version":"2026-06-01"}'],
  ])('answers 400 for a valid signature over %s', async (_label, body) => {
    const { handler, onEvent, onError } = setup();
    const response = await handler(signedRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_payload' });
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(WebhookParseError);
    expect(context.status).toBe(400);
  });

  it('answers 400 when the body cannot be read', async () => {
    const { handler, onEvent, onError } = setup();
    const reset = new Error('connection reset');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(reset);
      },
    });
    const response = await handler(streamRequest(body, sign(SCORED)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_payload' });
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(WebhookParseError);
    expect((error as Error).cause).toBe(reset);
    expect(context.status).toBe(400);
  });

  it('answers 400 when something else already read the body', async () => {
    const { handler, onError } = setup();
    const request = signedRequest(SCORED);
    await request.text();
    expect((await handler(request)).status).toBe(400);
    const [error] = onlyError(onError);
    expect(error).toBeInstanceOf(WebhookParseError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('answers 401 for a well-formed signature over an empty body', async () => {
    const { handler, onEvent, onError } = setup();
    const request = new Request(WEBHOOK_URL, { method: 'POST', headers: { 'x-shield-signature': sign(SCORED) } });
    expect(request.body).toBeNull();
    expect((await handler(request)).status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onlyError(onError)[0]).toBeInstanceOf(SignatureVerificationError);
  });

  it('answers 405 with Allow: POST for other methods', async () => {
    const { handler, onEvent, onError } = setup();
    for (const method of ['GET', 'PUT', 'HEAD']) {
      const response = await handler(webhookRequest(PING, sign(PING), method));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

/** A delivery whose body is a stream, sent without Content-Length (like a chunked request). */
function streamRequest(body: ReadableStream<Uint8Array>, signature: string, headers: Record<string, string> = {}): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shield-signature': signature, ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
}

/** An endless body in chunks of `chunkSize` bytes that counts what was pulled and whether it was cancelled. */
function endlessBody(chunkSize: number) {
  const state = { pulledBytes: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulledBytes += chunkSize;
      controller.enqueue(new Uint8Array(chunkSize).fill(0x20));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe('createWebhookHandler: body size', () => {
  it('answers 413 from Content-Length before it reads the body', async () => {
    const { handler, onEvent, onError } = setup({ secret: SECRET, maxBodySize: 1024 });
    const request = webhookRequest(SCORED, sign(SCORED));
    request.headers.set('content-length', String(1024 ** 3));
    const response = await handler(request);
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(request.bodyUsed).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(WebhookParseError);
    expect((error as Error).message).toContain('maxBodySize (1024 bytes)');
    expect(context).toEqual({ request, status: 413 });
  });

  it('stops reading a body without Content-Length as soon as it passes the limit, and cancels the rest', async () => {
    const { handler, onEvent, onError } = setup({ secret: SECRET, maxBodySize: 64 * 1024 });
    const { stream, state } = endlessBody(16 * 1024);
    const response = await handler(streamRequest(stream, sign(SCORED)));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(state.cancelled).toBe(true);
    // The body never ends: the handler stopped after the limit, the chunk that crossed it and the
    // few chunks the stream pulled ahead.
    expect(state.pulledBytes).toBeLessThanOrEqual(64 * 1024 + 4 * 16 * 1024);
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(WebhookParseError);
    expect(context.status).toBe(413);
  });

  it('still answers 413 when cancelling the rest of the body fails', async () => {
    const { handler } = setup({ secret: SECRET, maxBodySize: 1024 });
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4096));
      },
      cancel() {
        cancelCalls += 1;
        throw new Error('socket already closed');
      },
    });
    expect((await handler(streamRequest(stream, sign(SCORED)))).status).toBe(413);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelCalls).toBe(1);
  });

  it('limits bodies to 1 MiB by default', async () => {
    const { handler, onError } = setup();
    const { stream, state } = endlessBody(64 * 1024);
    expect((await handler(streamRequest(stream, sign(SCORED)))).status).toBe(413);
    expect(state.pulledBytes).toBeGreaterThan(1024 * 1024);
    expect(state.pulledBytes).toBeLessThanOrEqual(1024 * 1024 + 4 * 64 * 1024);
    expect((onlyError(onError)[0] as Error).message).toContain('maxBodySize (1048576 bytes)');

    const header = setup();
    const request = webhookRequest(SCORED, sign(SCORED));
    request.headers.set('content-length', String(1024 * 1024 + 1));
    expect((await header.handler(request)).status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it('counts the bytes it reads, whatever Content-Length declares', async () => {
    const { handler, onError } = setup({ secret: SECRET, maxBodySize: 1024 });
    const { stream } = endlessBody(4096);
    expect((await handler(streamRequest(stream, sign(SCORED), { 'content-length': '100' }))).status).toBe(413);
    expect(onlyError(onError)[1].status).toBe(413);
  });

  it('ignores a Content-Length that is not a number', async () => {
    const { handler, onEvent } = setup();
    const request = signedRequest(SCORED);
    request.headers.set('content-length', 'about 2 KB');
    expect((await handler(request)).status).toBe(200);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('accepts a body of exactly maxBodySize bytes, streamed in chunks', async () => {
    const bytes = new TextEncoder().encode(SCORED);
    const { handler, onEvent } = setup({ secret: SECRET, maxBodySize: bytes.byteLength });
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 100));
        offset += 100;
      },
    });
    const request = streamRequest(stream, sign(SCORED), { 'content-length': String(bytes.byteLength) });
    expect((await handler(request)).status).toBe(200);
    const event = onlyEvent(onEvent);
    if (event.event_type !== 'identification.scored') throw new Error('expected a scored event');
    expect(event.data.request_id).toBe('02f1d973-84db-4156-a7f7-e799e6bf389b');

    const smaller = setup({ secret: SECRET, maxBodySize: bytes.byteLength - 1 });
    expect((await smaller.handler(signedRequest(SCORED))).status).toBe(413);
    expect(smaller.onEvent).not.toHaveBeenCalled();
  });

  it('checks the signature header before the size', async () => {
    const { handler, onError } = setup({ secret: SECRET, maxBodySize: 1024 });
    const request = webhookRequest(SCORED, null);
    request.headers.set('content-length', String(1024 ** 3));
    expect((await handler(request)).status).toBe(401);
    expect(onlyError(onError)[1].status).toBe(401);
  });
});

describe('createWebhookHandler: onEvent failures', () => {
  it('answers 500 with a generic body when onEvent throws', async () => {
    const failure = new Error('insert failed for user 42 on db.internal:5432');
    const onError = vi.fn();
    const handler = createWebhookHandler({
      secret: SECRET,
      onEvent: () => {
        throw failure;
      },
      onError,
    });
    const response = await handler(signedRequest(SCORED));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });
    expect(text).not.toContain('db.internal');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe(failure);
    expect((onError.mock.calls[0]![1] as WebhookErrorContext).status).toBe(500);
  });

  it('answers 500 when onEvent rejects', async () => {
    const onError = vi.fn();
    const handler = createWebhookHandler({ secret: SECRET, onEvent: () => Promise.reject(new Error('queue down')), onError });
    expect((await handler(signedRequest(SCORED))).status).toBe(500);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('waits for an async onError before answering', async () => {
    const gate = deferred();
    let settled = false;
    const handler = createWebhookHandler({ secret: SECRET, onEvent: vi.fn(), onError: () => gate.promise });
    const pending = handler(webhookRequest(SCORED, null)).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    gate.resolve();
    expect((await pending).status).toBe(401);
  });

  it('still answers when onError throws, and logs that error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createWebhookHandler({
      secret: SECRET,
      onEvent: () => {
        throw new Error('handler failed');
      },
      onError: () => {
        throw new Error('reporter failed');
      },
    });
    expect((await handler(signedRequest(SCORED))).status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]![0])).toContain('onError threw');
  });

  it('logs a console error for 500 and a console warning for 401 and 400 without onError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new Error('handler failed');
    const handler = createWebhookHandler({
      secret: SECRET,
      onEvent: () => {
        throw failure;
      },
    });

    expect((await handler(signedRequest(SCORED))).status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]![1]).toBe(failure);

    expect((await handler(webhookRequest(SCORED, 'sha256=00'))).status).toBe(401);
    expect((await handler(signedRequest('not json'))).status).toBe(400);
    expect(consoleWarn).toHaveBeenCalledTimes(2);
    expect(String(consoleWarn.mock.calls[0]![0])).toContain('401');
    expect(String(consoleWarn.mock.calls[1]![0])).toContain('400');
    // Never the secret.
    for (const call of [...consoleWarn.mock.calls, ...consoleError.mock.calls]) {
      expect(String(call[0])).not.toContain(SECRET);
    }
  });
});

describe('createWebhookHandler: secrets', () => {
  it('reads SHIELDLABS_WEBHOOK_SECRET on every request by default', async () => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', '');
    const { handler, onEvent } = setup({});
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', SECRET);
    expect((await handler(signedRequest(SCORED))).status).toBe(200);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('accepts several comma-separated secrets in SHIELDLABS_WEBHOOK_SECRET, trimmed', async () => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', ` whsec_old_secret_value_0000000000 ,\n${SECRET} , `);
    const { handler } = setup({});
    expect((await handler(signedRequest(SCORED))).status).toBe(200);
    expect((await handler(signedRequest(SCORED, 'whsec_old_secret_value_0000000000'))).status).toBe(200);
    expect((await handler(signedRequest(SCORED, 'whsec_unknown'))).status).toBe(401);
  });

  it('answers 500 and reports a ValidationError when no secret is configured', async () => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', ' , ');
    const { handler, onEvent, onError } = setup({});
    const response = await handler(signedRequest(SCORED));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(onEvent).not.toHaveBeenCalled();
    const [error, context] = onlyError(onError);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain('SHIELDLABS_WEBHOOK_SECRET');
    expect(context.status).toBe(500);
  });

  it('answers 500 when the variable is not set at all', async () => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', undefined);
    const { handler, onError } = setup({});
    expect((await handler(signedRequest(SCORED))).status).toBe(500);
    expect(onlyError(onError)[0]).toBeInstanceOf(ValidationError);
  });

  it('uses the secret option instead of the environment', async () => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', 'whsec_from_the_environment');
    const explicit = setup({ secret: SECRET });
    expect((await explicit.handler(signedRequest(SCORED))).status).toBe(200);
    expect((await explicit.handler(signedRequest(SCORED, 'whsec_from_the_environment'))).status).toBe(401);
  });

  it('accepts a list of secrets, trims them and skips empty entries', async () => {
    const { handler } = setup({ secret: ['', ' whsec_old_secret_value_0000000000 ', `${SECRET}\n`] });
    expect((await handler(signedRequest(SCORED))).status).toBe(200);
    expect((await handler(signedRequest(SCORED, 'whsec_old_secret_value_0000000000'))).status).toBe(200);
  });

  it('parses a string option like the variable: commas separate secrets, which are trimmed', async () => {
    const rotation = ` whsec_old_secret_value_0000000000 ,\n${SECRET} , `;
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', rotation);
    const fromOption = setup({ secret: process.env.SHIELDLABS_WEBHOOK_SECRET });
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', 'whsec_unrelated_value');
    for (const secret of [SECRET, 'whsec_old_secret_value_0000000000']) {
      expect((await fromOption.handler(signedRequest(SCORED, secret))).status).toBe(200);
    }
    expect((await fromOption.handler(signedRequest(SCORED, 'whsec_unrelated_value'))).status).toBe(401);
    expect(fromOption.onEvent).toHaveBeenCalledTimes(2);
  });

  it('trims a secret option read from a file with a trailing newline', async () => {
    const { handler } = setup({ secret: `${SECRET}\n` });
    expect((await handler(signedRequest(SCORED))).status).toBe(200);
  });

  it.each([[''], [' , '], [[]], [['', '']], [[' ', '\n']]])('treats the secret option %j as a configuration error (500)', async (secret) => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', SECRET);
    const { handler, onError } = setup({ secret });
    expect((await handler(signedRequest(SCORED))).status).toBe(500);
    const [error] = onlyError(onError);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain('secret option');
  });
});

describe('createWebhookHandler: options', () => {
  it.each([
    ['no options', undefined],
    ['null', null],
    ['no onEvent', { secret: SECRET }],
    ['an onEvent that is not a function', { onEvent: 'log' }],
    ['an onError that is not a function', { onEvent: vi.fn(), onError: true }],
    ['a secret that is a number', { onEvent: vi.fn(), secret: 42 }],
    ['a secret list with a number', { onEvent: vi.fn(), secret: [SECRET, 42] }],
    ['a maxBodySize of 0', { onEvent: vi.fn(), maxBodySize: 0 }],
    ['a negative maxBodySize', { onEvent: vi.fn(), maxBodySize: -1 }],
    ['a fractional maxBodySize', { onEvent: vi.fn(), maxBodySize: 1.5 }],
    ['an infinite maxBodySize', { onEvent: vi.fn(), maxBodySize: Number.POSITIVE_INFINITY }],
    ['a maxBodySize given as text', { onEvent: vi.fn(), maxBodySize: '1mb' }],
  ])('throws a ValidationError for %s', (_label, options) => {
    expect(() => createWebhookHandler(options as never)).toThrow(ValidationError);
  });

  it('does not read the environment when it is created', () => {
    vi.stubEnv('SHIELDLABS_WEBHOOK_SECRET', undefined);
    expect(() => createWebhookHandler({ onEvent: vi.fn() })).not.toThrow();
  });
});

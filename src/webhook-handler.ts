import {
  SignatureVerificationError,
  ValidationError,
  WebhookParseError,
  webhooks,
  type IdentificationScoredEvent,
  type UnknownWebhookEvent,
  type WebhookEvent,
  type WebhookSecret,
} from '@shieldlabs-ai/node';
import { envWebhookSecrets, splitSecrets } from './env';
import { errorMessage } from './internal';

/**
 * The events `onEvent` receives: `identification.scored`, or an event type this version does not
 * know yet. `webhook.ping` (Verify in the analytics dashboard) is acknowledged by the handler and
 * never passed to `onEvent`.
 */
export type WebhookHandlerEvent = IdentificationScoredEvent | UnknownWebhookEvent;

/** The status of a rejected or failed delivery, with its request. Passed to `onError`. */
export interface WebhookErrorContext {
  /** The incoming request. The handler may have read its body. */
  request: Request;
  /** The status the handler answers with. */
  status: 400 | 401 | 413 | 500;
}

/** Options of {@link createWebhookHandler}. */
export interface WebhookHandlerOptions {
  /**
   * The endpoint signing secret (`whsec_...`), or several while you rotate secrets. A string may
   * list several secrets separated by commas, like the variable; every secret is trimmed and empty
   * entries are ignored. Default: the value of `SHIELDLABS_WEBHOOK_SECRET`, read on every request.
   */
  secret?: WebhookSecret | undefined;
  /**
   * Called with every verified event except `webhook.ping`. The handler answers 200 after the
   * returned value (or promise) resolves, and 500 when it throws or rejects. Today each
   * identification is delivered once per endpoint, with a 1-second timeout and no retries; a later
   * server release adds retries that resend identical bytes. Keep it short and idempotent on
   * `event.data.request_id`.
   */
  onEvent: (event: WebhookHandlerEvent) => unknown;
  /**
   * Called when the handler answers 400, 401, 413 or 500, before it answers. Default: a console
   * warning for 400, 401 and 413, a console error for 500.
   */
  onError?: ((error: unknown, context: WebhookErrorContext) => unknown) | undefined;
  /**
   * The largest request body the handler reads, in bytes. Default 1 048 576 (1 MiB); a delivery is
   * about 2 KB. A larger `Content-Length` is answered with 413 before the body is read, and a body
   * without `Content-Length` is read only until it passes the limit.
   */
  maxBodySize?: number | undefined;
}

/** A route handler for `POST` requests: `export const POST = createWebhookHandler({ ... })`. */
export type WebhookHandler = (request: Request) => Promise<Response>;

type FailureStatus = WebhookErrorContext['status'];

const SIGNATURE_HEADER = 'x-shield-signature';
/** The header format that can match a signature: checked before the body is read. */
const SIGNATURE_FORMAT = /^sha256=[0-9a-fA-F]{64}$/;
const DECIMAL = /^\d+$/;
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;
const LOG_PREFIX = '[shieldlabs]';

const RESPONSE_BODIES = {
  200: { received: true },
  400: { error: 'invalid_payload' },
  401: { error: 'invalid_signature' },
  405: { error: 'method_not_allowed' },
  413: { error: 'payload_too_large' },
  500: { error: 'internal_error' },
} as const;

const MISSING_ENV_SECRET =
  'No webhook signing secret is configured. Set SHIELDLABS_WEBHOOK_SECRET to the signing secret of ' +
  'this endpoint (whsec_..., several separated by commas while you rotate), or pass the secret option.';
const EMPTY_SECRET_OPTION =
  'The secret option holds no signing secret. Pass the signing secret of this endpoint (whsec_...), ' +
  'or leave the option out to use SHIELDLABS_WEBHOOK_SECRET.';

function jsonResponse(status: keyof typeof RESPONSE_BODIES, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(RESPONSE_BODIES[status]), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function defaultReport(error: unknown, status: FailureStatus): void {
  if (status === 500) {
    console.error(LOG_PREFIX + ' Webhook delivery failed, answered 500:', error);
  } else {
    console.warn(`${LOG_PREFIX} Webhook delivery rejected with ${status}: ${errorMessage(error)}`);
  }
}

/**
 * The configured secrets, or undefined when the option is left out (use the environment). Parsed
 * like the variable: a string is a comma-separated list, and every secret is trimmed.
 */
function secretsOption(secret: unknown): string[] | undefined {
  if (secret === undefined) return undefined;
  if (typeof secret === 'string') return splitSecrets(secret);
  if (Array.isArray(secret) && secret.every((item): item is string => typeof item === 'string')) {
    return secret.map((item) => item.trim()).filter((item) => item !== '');
  }
  throw new ValidationError('secret must be a string or an array of strings.');
}

function maxBodySizeOption(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_BODY_SIZE;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError('maxBodySize must be a whole number of bytes, 1 or more.');
  }
  return value;
}

/** The body size the request declares, or null without a usable `Content-Length`. */
function declaredLength(headers: Headers): number | null {
  const value = headers.get('content-length')?.trim();
  return value !== undefined && DECIMAL.test(value) ? Number(value) : null;
}

/**
 * The body bytes, or null as soon as the body passes `limit` bytes: reading stops there and the
 * rest of the body is cancelled, so an oversized request never sits in memory.
 */
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const stream = request.body;
  if (stream === null) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * A route handler that receives ShieldLabs webhooks: it reads the raw body, verifies the
 * `X-Shield-Signature` header, parses the event and calls `onEvent`. Verification uses
 * `webhooks.constructEventAsync` of @shieldlabs-ai/node, so it runs in the Node.js runtime and, with
 * WebCrypto, in the Edge runtime.
 *
 * The body is read only when the signature header is well formed, and never beyond `maxBodySize`.
 *
 * | Answer | When |
 * |---|---|
 * | 200 | `onEvent` resolved, or the event is a `webhook.ping` (not passed to `onEvent`) |
 * | 400 | The signature is valid but the body is not a ShieldLabs event, or the body could not be read |
 * | 401 | The signature header is missing, malformed or does not match any secret |
 * | 405 | The request is not a `POST` |
 * | 413 | The body is larger than `maxBodySize` |
 * | 500 | `onEvent` threw or rejected, or no signing secret is configured |
 *
 * Response bodies are generic JSON and never include error details.
 */
export function createWebhookHandler(options: WebhookHandlerOptions): WebhookHandler {
  const raw: unknown = options;
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('createWebhookHandler() needs an options object with onEvent.');
  }
  const { onEvent, onError } = options;
  const onEventValue: unknown = onEvent;
  const onErrorValue: unknown = onError;
  if (typeof onEventValue !== 'function') {
    throw new ValidationError('createWebhookHandler() needs an onEvent function.');
  }
  if (onErrorValue !== undefined && typeof onErrorValue !== 'function') {
    throw new ValidationError('onError must be a function.');
  }
  const configuredSecrets = secretsOption(options.secret);
  const maxBodySize = maxBodySizeOption(options.maxBodySize);

  async function fail(request: Request, status: FailureStatus, error: unknown): Promise<Response> {
    if (onError === undefined) {
      defaultReport(error, status);
    } else {
      try {
        await onError(error, { request, status });
      } catch (reportError) {
        console.error(LOG_PREFIX + ' onError threw while reporting a webhook failure:', reportError);
      }
    }
    return jsonResponse(status);
  }

  function tooLarge(): WebhookParseError {
    return new WebhookParseError(`The request body is larger than maxBodySize (${maxBodySize} bytes).`);
  }

  return async function handleShieldLabsWebhook(request: Request): Promise<Response> {
    if (request.method !== 'POST') return jsonResponse(405, { allow: 'POST' });

    const secrets = configuredSecrets ?? envWebhookSecrets();
    if (secrets.length === 0) {
      const message = configuredSecrets === undefined ? MISSING_ENV_SECRET : EMPTY_SECRET_OPTION;
      return fail(request, 500, new ValidationError(message));
    }

    // Everything that can be checked without the body is checked first: a request that cannot be
    // a delivery is answered before a single byte of its body is read.
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (signature === null) {
      return fail(request, 401, new SignatureVerificationError('The X-Shield-Signature header is missing.'));
    }
    if (!SIGNATURE_FORMAT.test(signature.trim())) {
      return fail(
        request,
        401,
        new SignatureVerificationError(
          'The X-Shield-Signature header is malformed (expected sha256=<64 hex characters>).',
        ),
      );
    }
    const declared = declaredLength(request.headers);
    if (declared !== null && declared > maxBodySize) return fail(request, 413, tooLarge());

    let body: Uint8Array | null;
    try {
      // The exact bytes that were signed: never parse and re-serialize before verifying.
      body = await readBody(request, maxBodySize);
    } catch (error) {
      return fail(request, 400, new WebhookParseError('The request body could not be read.', { cause: error }));
    }
    if (body === null) return fail(request, 413, tooLarge());

    let event: WebhookEvent;
    try {
      event = await webhooks.constructEventAsync(body, signature, secrets);
    } catch (error) {
      if (error instanceof SignatureVerificationError) return fail(request, 401, error);
      if (error instanceof WebhookParseError) return fail(request, 400, error);
      return fail(request, 500, error);
    }

    if (event.event_type === 'webhook.ping') return jsonResponse(200);

    try {
      await onEvent(event);
    } catch (error) {
      return fail(request, 500, error);
    }
    return jsonResponse(200);
  };
}

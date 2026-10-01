// An error from verification that is neither a signature nor a parse error (for example a runtime
// without WebCrypto) is a failure of the endpoint: 500, never a 401 or a 400.
import { describe, expect, it, vi } from 'vitest';
import type * as NodeSdk from '@shieldlabs-ai/node';
import { createWebhookHandler } from '../src/server';
import { SECRET, readData, signedRequest } from './helpers';

const runtimeError = new Error('WebCrypto (crypto.subtle) is not available in this runtime.');

vi.mock('@shieldlabs-ai/node', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeSdk>();
  return {
    ...actual,
    webhooks: { ...actual.webhooks, constructEventAsync: () => Promise.reject(runtimeError) },
  };
});

describe('createWebhookHandler: unexpected verification errors', () => {
  it('answers 500 with a generic body and reports the error', async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const handler = createWebhookHandler({ secret: SECRET, onEvent, onError });
    const response = await handler(signedRequest(readData('webhook-identification-scored.raw.txt')));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe(runtimeError);
  });
});

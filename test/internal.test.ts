// Internal helpers that the entry tests reach only in unusual runtimes.
import { describe, expect, it, vi } from 'vitest';
import { envApiBaseUrl, envApiKey, envWebhookSecrets, splitSecrets } from '../src/env';
import { errorMessage } from '../src/internal';

/** Runs `read` with `globalThis.process` replaced, synchronously, and puts the original back. */
function withProcess<T>(replacement: unknown, read: () => T): T {
  const original = globalThis.process;
  (globalThis as { process: unknown }).process = replacement;
  try {
    return read();
  } finally {
    globalThis.process = original;
  }
}

describe('environment variables', () => {
  it('reads nothing where no process global exists (browsers, some edge runtimes)', () => {
    vi.stubEnv('SHIELDLABS_API_KEY', 'sec_test0000-test0000-test0000');
    const values = withProcess(undefined, () => [envApiKey(), envApiBaseUrl(), envWebhookSecrets()]);
    expect(values).toEqual([undefined, undefined, []]);
  });

  it('reads nothing when process has no env object', () => {
    const values = withProcess({}, () => [envApiKey(), envApiBaseUrl(), envWebhookSecrets()]);
    expect(values).toEqual([undefined, undefined, []]);
  });

  it('splits a secret list on commas, trims the entries and drops empty ones', () => {
    expect(splitSecrets(' whsec_a ,whsec_b,, ,\twhsec_c\n')).toEqual(['whsec_a', 'whsec_b', 'whsec_c']);
    expect(splitSecrets(undefined)).toEqual([]);
    expect(splitSecrets('')).toEqual([]);
  });
});

describe('errorMessage', () => {
  it('uses the message of an Error and the text of any other value', () => {
    expect(errorMessage(new TypeError('bad input'))).toBe('bad input');
    expect(errorMessage('plain text')).toBe('plain text');
    expect(errorMessage(42)).toBe('42');
  });
});

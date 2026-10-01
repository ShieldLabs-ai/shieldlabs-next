// The server entry: its own helpers plus the re-exports of @shieldlabs-ai/node, from the source and from
// both builds (`npm test` builds first).
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as node from '@shieldlabs-ai/node';
import * as server from '../src/server';

type ServerApi = Record<string, unknown>;

const require = createRequire(import.meta.url);
const OWN = ['createWebhookHandler', 'getIdentification'];
const FROM_NODE = [
  'ApiError',
  'AuthenticationError',
  'BadRequestError',
  'ConnectionError',
  'NIL_UUID',
  'NotFoundError',
  'QuotaExceededError',
  'RISK_BANDS',
  'RateLimitError',
  'SIGNALS',
  'ServerError',
  'ShieldLabs',
  'ShieldLabsError',
  'SignatureVerificationError',
  'TimeoutError',
  'ValidationError',
  'WebhookParseError',
  'evaluateIdentification',
  'isRateLimited',
  'riskBand',
  'userHidAsync',
];
const EXPORTS = [...OWN, ...FROM_NODE].sort();

describe('server entry', () => {
  it('exports getIdentification and createWebhookHandler', () => {
    expect(typeof server.getIdentification).toBe('function');
    expect(typeof server.createWebhookHandler).toBe('function');
  });

  it('re-exports the client, risk helpers, constants and error classes of @shieldlabs-ai/node unchanged', () => {
    expect(Object.keys(server).sort()).toEqual(EXPORTS);
    const nodeApi = node as unknown as ServerApi;
    const serverApi = server as unknown as ServerApi;
    for (const name of FROM_NODE) expect(serverApi[name], name).toBe(nodeApi[name]);
  });

  it('keeps the helpers of @shieldlabs-ai/node working through the re-exports', () => {
    expect(server.riskBand(25)).toBe('trusted');
    expect(server.riskBand(45)).toBe('suspicious');
    expect(server.riskBand(80)).toBe('dangerous');
    expect(server.riskBand(999)).toBe('rate_limited');
    expect(server.isRateLimited(999)).toBe(true);
    expect(server.NIL_UUID).toBe('00000000-0000-0000-0000-000000000000');
    expect(server.RISK_BANDS.suspicious).toEqual({ min: 30, max: 59 });
    expect(server.SIGNALS.VPN).toBe('vpn');
    expect(new server.ValidationError('bad input')).toBeInstanceOf(server.ShieldLabsError);
  });

  it('computes a User HID with userHidAsync, and leaves out the synchronous userHid', async () => {
    const expected = createHmac('sha256', 'hid-secret-value').update('account-42').digest('hex');
    await expect(server.userHidAsync('account-42', 'hid-secret-value')).resolves.toBe(expected);
    await expect(server.userHidAsync('', 'hid-secret-value')).rejects.toBeInstanceOf(server.ValidationError);
    expect('userHid' in server).toBe(false);
  });

  it('the ES module build exports the same API', async () => {
    // A computed specifier: the type check runs before the build, when dist/ does not exist yet.
    const api = (await import(/* @vite-ignore */ new URL('../dist/server.js', import.meta.url).href)) as ServerApi;
    expect(Object.keys(api).sort()).toEqual(EXPORTS);
    expect(api.riskBand).toBe(node.riskBand);
  });

  it('the CommonJS build exports the same API', () => {
    const api = require('../dist/server.cjs') as ServerApi;
    expect(Object.keys(api).sort()).toEqual(EXPORTS);
  });
});

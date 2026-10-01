// The client entry: its exports, the built files (`npm test` builds first) with their "use client"
// directive, server rendering of the provider from both builds, and the behaviour of the hooks it
// re-exports.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import * as core from '@shieldlabs-ai/js';
import * as react from '@shieldlabs-ai/react';
import type * as ReactModule from 'react';
import type * as ReactDomServer from 'react-dom/server';
import * as client from '../src/index';
import type { ShieldLabsProviderProps, UseIdentifyOptions, UseIdentifyResult, UseShieldLabsResult } from '../src/index';

type ClientApi = typeof client;

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const EXPORTS = ['ShieldLabsError', 'ShieldLabsProvider', 'useIdentify', 'useShieldLabs'];
const PUBLIC_KEY = '0123456789abcdef0123456789abcdef';
const USER_HID = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function read(file: string): string {
  return readFileSync(new URL(file, root), 'utf8');
}

/** Server-renders the provider with a component that calls both hooks, all from one build. */
function renderWith(api: ClientApi): string {
  const { createElement } = require('react') as typeof ReactModule;
  const { renderToString } = require('react-dom/server') as typeof ReactDomServer;
  function Probe() {
    const { status } = api.useShieldLabs();
    const { isLoading } = api.useIdentify();
    return createElement('span', null, `${status} ${String(isLoading)}`);
  }
  return renderToString(createElement(api.ShieldLabsProvider, { publicKey: PUBLIC_KEY }, createElement(Probe)));
}

interface Hooks {
  shieldlabs: UseShieldLabsResult;
  identify: UseIdentifyResult['identify'];
}

/**
 * Server-renders the provider from one build and returns what its hooks gave the component. Their
 * functions can still be called afterwards: without a browser, loading the agent fails with
 * `unsupported_environment`, which shows how each function reports a missing identification.
 */
function hooksOf(
  api: ClientApi,
  props: Partial<ShieldLabsProviderProps> = {},
  identifyOptions?: UseIdentifyOptions,
): Hooks {
  const { createElement } = require('react') as typeof ReactModule;
  const { renderToString } = require('react-dom/server') as typeof ReactDomServer;
  let hooks: Hooks | undefined;
  function Probe() {
    hooks = { shieldlabs: api.useShieldLabs(), identify: api.useIdentify(identifyOptions).identify };
    return null;
  }
  renderToString(createElement(api.ShieldLabsProvider, { publicKey: PUBLIC_KEY, ...props }, createElement(Probe)));
  if (hooks === undefined) throw new Error('the probe component did not render');
  return hooks;
}

/** 'settled' when the promise settles within a short wait, otherwise 'waiting'. */
async function settlesSoon(promise: Promise<unknown>): Promise<'settled' | 'waiting'> {
  const settled = promise.then(
    () => 'settled' as const,
    () => 'settled' as const,
  );
  const waiting = new Promise<'waiting'>((resolve) => {
    setTimeout(() => {
      resolve('waiting');
    }, 50);
  });
  return Promise.race([settled, waiting]);
}

const ENTRIES: [string, () => Promise<ClientApi>][] = [
  ['the source entry', () => Promise.resolve(client)],
  // A computed specifier: the type check runs before the build, when dist/ does not exist yet.
  ['the ES module build', async () => (await import(/* @vite-ignore */ new URL('dist/index.js', root).href)) as ClientApi],
  ['the CommonJS build', () => Promise.resolve(require('../dist/index.cjs') as ClientApi)],
];

describe('client entry', () => {
  it('re-exports the provider and hooks of @shieldlabs-ai/react and the error class of @shieldlabs-ai/js', () => {
    expect(Object.keys(client).sort()).toEqual(EXPORTS);
    expect(client.ShieldLabsProvider).toBe(react.ShieldLabsProvider);
    expect(client.useShieldLabs).toBe(react.useShieldLabs);
    expect(client.useIdentify).toBe(react.useIdentify);
    expect(client.ShieldLabsError).toBe(core.ShieldLabsError);
  });

  it.each(['dist/index.js', 'dist/index.cjs'])('%s starts with the "use client" directive', (file) => {
    expect(read(file).startsWith('"use client";\n')).toBe(true);
  });

  it.each(['dist/server.js', 'dist/server.cjs'])('%s has no "use client" directive', (file) => {
    expect(read(file)).not.toContain('use client');
  });

  it('the ES module build exports the same API', async () => {
    // A computed specifier: the type check runs before the build, when dist/ does not exist yet.
    const api = (await import(/* @vite-ignore */ new URL('dist/index.js', root).href)) as ClientApi;
    expect(Object.keys(api).sort()).toEqual(EXPORTS);
    expect(api.ShieldLabsError).toBe(core.ShieldLabsError);
  });

  it('the CommonJS build exports the same API and renders on the server', () => {
    const api = require('../dist/index.cjs') as ClientApi;
    expect(Object.keys(api).sort()).toEqual(EXPORTS);
    // Nothing loads during server rendering: the agent loads in an effect in the browser.
    expect(renderWith(api)).toBe('<span>loading false</span>');
  });

  it('server-renders the provider from the source entry', () => {
    expect(renderWith(client)).toBe('<span>loading false</span>');
  });

  it.each(['dist/index.d.ts', 'dist/index.d.cts'])('%s declares the client API', (file) => {
    const types = read(file);
    for (const name of [
      ...EXPORTS,
      'ShieldLabsProviderProps',
      'ShieldLabsStatus',
      'UseShieldLabsResult',
      'UseIdentifyOptions',
      'UseIdentifyResult',
      'IdentifyOptions',
      'IdentifyResult',
      'InteractionIdentifier',
      'LoadOptions',
      'ShieldLabsAgent',
      'ShieldLabsErrorCode',
    ]) {
      expect(types).toMatch(new RegExp('\\b' + name + '\\b'));
    }
  });
});

describe.each(ENTRIES)('the hooks from %s', (_label, entry) => {
  it('useShieldLabs() returns the status, identify(), check(), load() and getAgent()', async () => {
    const { shieldlabs } = hooksOf(await entry());
    expect(Object.keys(shieldlabs).sort()).toEqual(['check', 'error', 'getAgent', 'identify', 'load', 'status']);
    expect(shieldlabs).toMatchObject({ status: 'loading', error: null });
    for (const name of ['identify', 'check', 'load', 'getAgent'] as const) expect(typeof shieldlabs[name]).toBe('function');
  });

  it('useIdentify().identify() resolves null when there is no identification, while useShieldLabs().identify() rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = await entry();
    const { shieldlabs, identify } = hooksOf(api);

    await expect(identify()).resolves.toBeNull();
    const failure: unknown = await shieldlabs.identify().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(api.ShieldLabsError);
    expect(failure).toMatchObject({ code: 'unsupported_environment' });
    await expect(shieldlabs.getAgent()).rejects.toMatchObject({ code: 'unsupported_environment' });
    // The provider names the setup problem once in the console.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ShieldLabs]'));
  });

  it('a second identify() with the same options while the first runs returns the same call', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { identify } = hooksOf(await entry());
    const first = identify();
    expect(identify()).toBe(first);
    expect(identify({})).toBe(first);
    // A call without a timeout runs with the provider timeout, 10 seconds by default.
    expect(identify({ timeout: 10_000 })).toBe(first);
    // Another timeout asks for another identification.
    const other = identify({ timeout: 5_000 });
    expect(other).not.toBe(first);
    await expect(Promise.all([first, other])).resolves.toEqual([null, null]);
  });

  it('a userId key in identify() overrides the User HID of the hook, also set to undefined or null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { identify } = hooksOf(await entry(), {}, { userId: USER_HID });
    const forUser = identify();
    // Casts: this package type-checks with exactOptionalPropertyTypes, while plain JavaScript and
    // other TypeScript settings can pass both values.
    const anonymous = identify({ userId: undefined as unknown as string });
    // An anonymous identification, not the running one for the User HID of the hook.
    expect(anonymous).not.toBe(forUser);
    expect(identify({ userId: null as unknown as string })).toBe(anonymous);
    // Only options without the key use the User HID of the hook.
    expect(identify({})).toBe(forUser);
    await expect(Promise.all([forUser, anonymous])).resolves.toEqual([null, null]);
  });

  it('a call without a timeout counts as one with the provider timeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { identify } = hooksOf(await entry(), { timeout: 4_000 });
    const first = identify({ timeout: 4_000 });
    expect(identify()).toBe(first);
    // 10 seconds is not the timeout this provider gives a call.
    const other = identify({ timeout: 10_000 });
    expect(other).not.toBe(first);
    await expect(Promise.all([first, other])).resolves.toEqual([null, null]);
  });

  it('with autoLoad={false}, nothing loads until load(), and the calls answer at once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = await entry();
    const { shieldlabs, identify } = hooksOf(api, { autoLoad: false });

    await expect(identify()).resolves.toBeNull();
    const failure: unknown = await shieldlabs.identify().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(api.ShieldLabsError);
    expect(failure).toMatchObject({ code: 'not_initialized' });
    await expect(shieldlabs.check()).resolves.toBeNull();

    // getAgent() waits for load(); load() then starts loading, which fails here without a browser.
    const agent = shieldlabs.getAgent();
    expect(await settlesSoon(agent)).toBe('waiting');
    expect(warn).not.toHaveBeenCalled();
    // load() returns nothing: there is no promise to await.
    const load: () => unknown = shieldlabs.load;
    expect(load()).toBeUndefined();
    await expect(agent).rejects.toMatchObject({ code: 'unsupported_environment' });
  });
});

describe('the entries stay apart', () => {
  it.each(['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'])('%s never references server code', (file) => {
    expect(read(file)).not.toContain('@shieldlabs-ai/node');
  });

  it.each(['dist/server.js', 'dist/server.cjs', 'dist/server.d.ts'])('%s never references client code', (file) => {
    const text = read(file);
    for (const name of ['@shieldlabs-ai/react', '@shieldlabs-ai/js', '"react"', "'react'", './index']) {
      expect(text).not.toContain(name);
    }
  });

  it.each(['dist/server.js', 'dist/server.cjs'])('%s keeps @shieldlabs-ai/node external and imports no node:* module', (file) => {
    const text = read(file);
    expect(text).toMatch(/from "@shieldlabs-ai\/node"|require\("@shieldlabs-ai\/node"\)/);
    expect(text).not.toMatch(/["']node:/);
  });
});

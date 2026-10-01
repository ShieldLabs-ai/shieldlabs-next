// Bundles the built entries the way an Edge runtime build does (`npm test` builds first) and checks
// what ends up in the bundle: no node:* module and no client code in the server entry, no server
// code in the client entry. The edge bundle is then run against the shared fixtures.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions, type Metafile } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { signatureVectors } from './helpers';

const SERVER_ENTRY = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const CLIENT_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const NODE_IMPORT = /\bfrom\s*["']node:|\brequire\(\s*["']node:|\bimport\(\s*["']node:/;

async function bundle(entry: string, options: BuildOptions): Promise<{ code: string; metafile: Metafile }> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    logLevel: 'silent',
    ...options,
  });
  const output = result.outputFiles?.[0];
  if (output === undefined || result.metafile === undefined) throw new Error('esbuild wrote no output');
  return { code: output.text, metafile: result.metafile };
}

/** Every import of every bundled module, including the ones esbuild left external. */
function importsOf(metafile: Metafile): string[] {
  return Object.values(metafile.inputs).flatMap((input) => input.imports.map((item) => item.path));
}

/** Bundles the server entry for an Edge runtime: neutral platform, edge-light and worker conditions. */
function edgeBundle(): Promise<{ code: string; metafile: Metafile }> {
  return bundle(SERVER_ENTRY, {
    platform: 'neutral',
    conditions: ['edge-light', 'worker'],
    mainFields: ['module', 'main'],
    target: 'es2022',
  });
}

const temporary = mkdtempSync(join(tmpdir(), 'shieldlabs-next-edge-'));
afterAll(() => {
  rmSync(temporary, { recursive: true, force: true });
});

describe('server entry in an Edge runtime build', () => {
  it('resolves the edge build of @shieldlabs-ai/node and imports no node:* module', async () => {
    const { code, metafile } = await edgeBundle();
    const inputs = Object.keys(metafile.inputs);
    expect(inputs.some((path) => path.endsWith('@shieldlabs-ai/node/dist/edge.js'))).toBe(true);
    expect(inputs.some((path) => path.endsWith('@shieldlabs-ai/node/dist/index.js'))).toBe(false);
    expect(importsOf(metafile).filter((path) => path.startsWith('node:'))).toEqual([]);
    expect(code).not.toMatch(NODE_IMPORT);
  });

  it('contains no client code', async () => {
    const { code, metafile } = await edgeBundle();
    // React, the browser packages, or the client entry of this package (src/index.ts, dist/index.js).
    const clientModules = Object.keys(metafile.inputs).filter(
      (path) =>
        /@shieldlabs-ai\/(react|js)\/|node_modules\/react(-dom)?\/|(^|\/)(src|dist)\/index\.(ts|js)$/.test(path) &&
        !path.includes('@shieldlabs-ai/node/'),
    );
    expect(clientModules).toEqual([]);
    expect(code).not.toContain('use client');
  });

  it('keeps literal process.env reads for the three variables', async () => {
    const { code } = await edgeBundle();
    for (const name of ['SHIELDLABS_API_KEY', 'SHIELDLABS_API_BASE_URL', 'SHIELDLABS_WEBHOOK_SECRET']) {
      expect(code).toContain('process.env.' + name);
    }
  });

  it('would catch a node:* import (a Node.js build of the same entry has one)', async () => {
    const { code, metafile } = await bundle(SERVER_ENTRY, { platform: 'node', conditions: ['node'] });
    expect(importsOf(metafile)).toContain('node:crypto');
    expect(code).toMatch(NODE_IMPORT);
  });

  it('passes every signature vector with WebCrypto when it runs', async () => {
    const { code } = await edgeBundle();
    writeFileSync(join(temporary, 'server-edge.mjs'), code);
    writeFileSync(join(temporary, 'run-vectors.mjs'), VECTOR_RUNNER);
    // A separate Node.js process loads the bundle natively, outside the test runner's module system.
    const output = execFileSync(process.execPath, [join(temporary, 'run-vectors.mjs'), VECTORS_FILE], {
      encoding: 'utf8',
    });
    const { results, signCalls } = JSON.parse(output) as {
      results: { name: string; valid: boolean; ping: boolean; status: number; events: number }[];
      signCalls: number;
    };

    expect(results).toHaveLength(signatureVectors().length);
    for (const result of results) {
      const expectedEvents = result.valid && !result.ping ? 1 : 0;
      expect({ name: result.name, accepted: result.status === 200, events: result.events }).toEqual({
        name: result.name,
        accepted: result.valid,
        events: expectedEvents,
      });
    }
    // The edge build computes the HMAC with crypto.subtle.
    expect(signCalls).toBeGreaterThan(0);
  });

  it('computes a User HID with WebCrypto when it runs', async () => {
    const { code } = await edgeBundle();
    writeFileSync(join(temporary, 'server-edge-hid.mjs'), code);
    writeFileSync(join(temporary, 'run-hid.mjs'), HID_RUNNER);
    const output = execFileSync(process.execPath, [join(temporary, 'run-hid.mjs')], { encoding: 'utf8' });
    const expected = createHmac('sha256', 'hid-secret-value').update('account-42').digest('hex');
    expect(JSON.parse(output)).toEqual({ hid: expected, signCalls: 1 });
  });
});

const VECTORS_FILE = fileURLToPath(new URL('./data/webhook-signature-vectors.json', import.meta.url));

const VECTOR_RUNNER = `
import { readFileSync } from 'node:fs';
import { createWebhookHandler } from './server-edge.mjs';

const subtle = globalThis.crypto.subtle;
const sign = subtle.sign.bind(subtle);
let signCalls = 0;
subtle.sign = (...args) => {
  signCalls += 1;
  return sign(...args);
};

const { vectors } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = [];
for (const vector of vectors) {
  let events = 0;
  const handler = createWebhookHandler({
    secret: vector.secrets ?? vector.secret,
    onEvent: () => {
      events += 1;
    },
    onError: () => {},
  });
  const body = Uint8Array.from(atob(vector.body_base64), (char) => char.charCodeAt(0));
  const response = await handler(
    new Request('https://example.com/api/shieldlabs/webhook', {
      method: 'POST',
      headers: { 'x-shield-signature': vector.signature_header },
      body,
    }),
  );
  const ping = JSON.parse(vector.body).event_type === 'webhook.ping';
  results.push({ name: vector.name, valid: vector.valid, ping, status: response.status, events });
}
process.stdout.write(JSON.stringify({ results, signCalls }));
`;

const HID_RUNNER = `
import { userHidAsync } from './server-edge-hid.mjs';

const subtle = globalThis.crypto.subtle;
const sign = subtle.sign.bind(subtle);
let signCalls = 0;
subtle.sign = (...args) => {
  signCalls += 1;
  return sign(...args);
};

const hid = await userHidAsync('account-42', 'hid-secret-value');
process.stdout.write(JSON.stringify({ hid, signCalls }));
`;

describe('client entry in a browser build', () => {
  it('contains no server code', async () => {
    const { metafile } = await bundle(CLIENT_ENTRY, { platform: 'browser', external: ['react', 'react-dom'] });
    const inputs = Object.keys(metafile.inputs);
    expect(inputs.some((path) => path.includes('@shieldlabs-ai/react/'))).toBe(true);
    expect(inputs.some((path) => path.includes('@shieldlabs-ai/node/'))).toBe(false);
    expect(importsOf(metafile).filter((path) => path.startsWith('node:'))).toEqual([]);
  });
});

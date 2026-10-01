// The package manifest and the way Node.js resolves both entries under the conditions that Next.js
// uses (`npm test` builds first). The resolution checks run in separate processes that import the
// package by its own name.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECRET, readData } from './helpers';

const root = new URL('../', import.meta.url);

interface ConditionTarget {
  types: string;
  default: string;
}

interface PackageJson {
  name: string;
  version: string;
  main: string;
  module: string;
  types: string;
  exports: Record<string, { import: ConditionTarget; require: ConditionTarget } | string>;
  typesVersions: Record<string, Record<string, string[]>>;
  files: string[];
  sideEffects: boolean;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as PackageJson;

function exists(path: string): boolean {
  return existsSync(new URL(path, root));
}

/** Runs an ES module script with Node.js in the package root and returns what it prints. */
function runModule(script: string, conditions: string[] = []): string {
  return execFileSync(
    process.execPath,
    [...conditions.map((condition) => '--conditions=' + condition), '--input-type=module', '-e', script],
    { cwd: new URL('.', root), encoding: 'utf8' },
  ).trim();
}

describe('package.json', () => {
  it('is version 1.0.0 of @shieldlabs-ai/next', () => {
    expect(manifest.name).toBe('@shieldlabs-ai/next');
    expect(manifest.version).toBe('1.0.0');
  });

  it('maps both entries with types first, and every target exists after the build', () => {
    expect(Object.keys(manifest.exports)).toEqual(['.', './server', './package.json']);
    for (const subpath of ['.', './server']) {
      const entry = manifest.exports[subpath];
      if (entry === undefined || typeof entry === 'string') throw new Error('missing export ' + subpath);
      expect(Object.keys(entry)).toEqual(['import', 'require']);
      for (const target of [entry.import, entry.require]) {
        expect(Object.keys(target)).toEqual(['types', 'default']);
        expect(exists(target.types)).toBe(true);
        expect(exists(target.default)).toBe(true);
      }
    }
    for (const path of [manifest.main, manifest.module, manifest.types]) expect(exists(path)).toBe(true);
    const serverTypes = manifest.typesVersions['*']?.server?.[0];
    expect(serverTypes).toBe('./dist/server.d.ts');
    expect(exists(serverTypes!)).toBe(true);
  });

  it('publishes the build only and has no side effects', () => {
    expect(manifest.files).toEqual(['dist', 'CHANGELOG.md']);
    expect(manifest.sideEffects).toBe(false);
  });

  it('declares the ShieldLabs packages, React and Next.js as peer dependencies', () => {
    expect(manifest.peerDependencies).toEqual({
      '@shieldlabs-ai/js': '^1.0.0',
      '@shieldlabs-ai/node': '^1.0.0',
      '@shieldlabs-ai/react': '^1.0.0',
      next: '^14.0.0 || ^15.0.0 || ^16.0.0',
      react: '^18.0.0 || ^19.0.0',
    });
    expect(manifest.peerDependenciesMeta).toEqual({ next: { optional: true } });
    expect(manifest.dependencies).toBeUndefined();
  });

  it('depends on nothing but registry versions', () => {
    const specs = Object.values({ ...manifest.peerDependencies, ...manifest.devDependencies });
    for (const spec of specs) expect(spec).not.toMatch(/^(file|link|workspace|git|https?):|\.tgz$/);
  });
});

describe('resolution by Node.js', () => {
  it('resolves both entries by name and loads them', () => {
    const output = runModule(`
      const client = await import('@shieldlabs-ai/next');
      const server = await import('@shieldlabs-ai/next/server');
      console.log(JSON.stringify({
        client: import.meta.resolve('@shieldlabs-ai/next'),
        server: import.meta.resolve('@shieldlabs-ai/next/server'),
        clientExports: Object.keys(client).sort(),
        serverFunctions: ['getIdentification', 'createWebhookHandler', 'evaluateIdentification', 'riskBand', 'isRateLimited']
          .filter((name) => typeof server[name] === 'function'),
      }));
    `);
    const result = JSON.parse(output) as { client: string; server: string; clientExports: string[]; serverFunctions: string[] };
    expect(result.client.endsWith('/dist/index.js')).toBe(true);
    expect(result.server.endsWith('/dist/server.js')).toBe(true);
    expect(result.clientExports).toEqual(['ShieldLabsError', 'ShieldLabsProvider', 'useIdentify', 'useShieldLabs']);
    expect(result.serverFunctions).toHaveLength(5);
  });

  it('loads the CommonJS builds with require()', () => {
    const output = runModule(`
      import { createRequire } from 'node:module';
      const require = createRequire(process.cwd() + '/');
      const client = require('@shieldlabs-ai/next');
      const server = require('@shieldlabs-ai/next/server');
      console.log(JSON.stringify({
        client: require.resolve('@shieldlabs-ai/next'),
        server: require.resolve('@shieldlabs-ai/next/server'),
        provider: typeof client.ShieldLabsProvider,
        handler: typeof server.createWebhookHandler,
      }));
    `);
    const result = JSON.parse(output) as { client: string; server: string; provider: string; handler: string };
    expect(result.client.endsWith('/dist/index.cjs')).toBe(true);
    expect(result.server.endsWith('/dist/server.cjs')).toBe(true);
    expect([result.provider, result.handler]).toEqual(['function', 'function']);
  });

  it.each([
    ['edge-light', 'edge.js'],
    ['worker', 'edge.js'],
    ['react-server', 'index.js'],
  ])('with the %s condition, the server entry uses the %s build of @shieldlabs-ai/node and verifies a ping', (condition, build) => {
    const output = runModule(
      `
      const { createWebhookHandler } = await import('@shieldlabs-ai/next/server');
      const handler = createWebhookHandler({ secret: ${JSON.stringify(SECRET)}, onEvent: () => {} });
      const response = await handler(new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'x-shield-signature': 'sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8' },
        body: ${JSON.stringify(readData('webhook-ping.raw.txt'))},
      }));
      console.log(JSON.stringify({ node: import.meta.resolve('@shieldlabs-ai/node'), status: response.status }));
    `,
      [condition],
    );
    const result = JSON.parse(output) as { node: string; status: number };
    expect(result.node.endsWith('/@shieldlabs-ai/node/dist/' + build)).toBe(true);
    expect(result.status).toBe(200);
  });
});

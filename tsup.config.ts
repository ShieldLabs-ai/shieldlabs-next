import { defineConfig } from 'tsup';

// Peer dependencies stay external, so the application's bundler resolves them with its own export
// conditions (for example the edge build of @shieldlabs-ai/node in the Next.js Edge runtime).
const external = ['@shieldlabs-ai/js', '@shieldlabs-ai/node', '@shieldlabs-ai/react', 'next', 'react'];

export default defineConfig([
  {
    // Client entry: `@shieldlabs-ai/next`.
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2019',
    platform: 'neutral',
    splitting: false,
    tsconfig: 'tsconfig.build.json',
    external,
    // Marks the built files as a client module, so Server Components (for example the root layout)
    // can render ShieldLabsProvider. The directive must be the first statement of each file.
    banner: { js: '"use client";' },
  },
  {
    // Server entry: `@shieldlabs-ai/next/server`. No directive, no client code and no node:* imports.
    entry: { server: 'src/server.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2020',
    platform: 'neutral',
    splitting: false,
    tsconfig: 'tsconfig.build.json',
    external,
  },
]);

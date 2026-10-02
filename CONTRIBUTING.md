# Contributing to @shieldlabs-ai/next

Thank you for improving the ShieldLabs Next.js integration.

## Set up

You need Node.js 20 or later. Install the development tools and the published peer packages
`@shieldlabs-ai/react`, `@shieldlabs-ai/js` and `@shieldlabs-ai/node` from this repository's root.
You do not need checkouts of the other SDKs.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0' \
  '@shieldlabs-ai/react@^1.0.0' '@shieldlabs-ai/node@^1.0.0'
```

Repeat the second command after every `npm ci`, which removes the separately installed peers.
`--no-save` leaves `package.json` and `package-lock.json` unchanged. If a check reports missing
peers, run that command again.

### Why `.npmrc` sets `legacy-peer-deps=true`

The lockfile was created with `legacy-peer-deps=true`; the repository keeps that setting for
`npm ci`. The separate install uses `--legacy-peer-deps=false` to resolve the published peers.
This setting applies only to this checkout: npm does not publish `.npmrc`.

CI still builds the peer packages from their `main` branches and tests the packed copies. The
commands above instead test the published 1.x packages. To test a peer change, build and pack it
in its own checkout, then replace its package name in the second command with the path to that
tarball. Install all three peers in the same command. Never commit a `file:` dependency or a tarball.

## Checks

Run these before you open a pull request. CI runs them on Node.js 20, 22 and 24.

```bash
npm run typecheck
npm run lint
npm test -- --coverage   # builds first; coverage must stay at 90 % or more
npm run build
```

The tests use the global `Request`, `Response` and WebCrypto of Node.js, bundle the built server
entry with esbuild for the Edge runtime (the build fails the test when a `node:*` import remains),
and run the shared test fixtures in `test/data` that every ShieldLabs server SDK passes. The fixture
files are identical across the SDKs: do not edit them; add cases for this package in the tests.

`package.json` keeps `vite`, which vitest runs on, at 6.x so the tests run on every Node.js 20
release, and its `overrides` make tsup build with the same `esbuild` version as the tests.

CI also builds `examples/app-router` with Next.js 14, 15 and the latest Next.js. To do the same locally,
follow [Build against local copies of the packages](./examples/app-router/README.md#build-against-local-copies-of-the-packages),
then delete `examples/app-router/node_modules` and `examples/app-router/.next`.

## Guidelines

- Keep the entries apart. `src/index.ts` (client) only re-exports `@shieldlabs-ai/react` and
  `@shieldlabs-ai/js`. `src/server.ts` and its modules never import React, browser code or `node:*`
  modules, so they run in the Node.js and Edge runtimes.
- Read environment variables when a function runs, never at import time, and always with a literal
  `process.env.NAME` expression (see `src/env.ts`).
- Webhook responses stay generic: never put error details, secrets or keys in a response body or a
  log message.
- Every change comes with tests. Use conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`,
  `ci:`, `chore:`) and add a line to `CHANGELOG.md` under "Unreleased".
- Documentation style: plain technical English, "risk signals", and the three risk bands trusted
  0-29, suspicious 30-59 and dangerous 60-100.

## Releasing

Apps install this package next to `@shieldlabs-ai/js`, `@shieldlabs-ai/react` and `@shieldlabs-ai/node`, so
they are released first, in this order: `@shieldlabs-ai/js`, `@shieldlabs-ai/node`, `@shieldlabs-ai/react`,
then `@shieldlabs-ai/next`. Then update the version in `package.json`, move the "Unreleased" changelog
entries under the new version, and push a tag such as `v1.0.1`.

The release workflow checks that the tag matches `package.json` and that the three peer dependencies
are on npm, installs the published versions, runs all checks, packs the package and publishes the
pack to npm with provenance, using the `NPM_TOKEN` repository secret. The publish job runs in the
`npm` environment: add required reviewers to it in the repository settings to approve each release.

Re-running the workflow is safe: a version that is already on npm is not published again. If a
release requires newer peer versions, publish those versions before re-running the workflow.

## Security

Please report security issues privately to <contact@shieldlabs.ai> rather than in a public issue.

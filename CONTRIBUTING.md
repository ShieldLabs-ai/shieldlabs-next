# Contributing to @shieldlabs-ai/next

Thank you for improving the ShieldLabs Next.js integration.

## Set up

You need Node.js 20 or later. The package builds on three other ShieldLabs packages, which are its
peer dependencies: `@shieldlabs-ai/react`, `@shieldlabs-ai/js` and `@shieldlabs-ai/node`. Until they are
published to npm, work with local packs of them, built from working copies of
[shieldlabs-js](https://github.com/ShieldLabs-ai/shieldlabs-js),
[shieldlabs-react](https://github.com/ShieldLabs-ai/shieldlabs-react) and
[shieldlabs-node](https://github.com/ShieldLabs-ai/shieldlabs-node) next to this repository:

```bash
# in shieldlabs-js
npm ci && npm run build && npm pack
# in shieldlabs-react
npm ci && npm install --no-save ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz && npm run build && npm pack
# in shieldlabs-node
npm ci && npm pack

# in this repository
npm ci
npm install --no-save --legacy-peer-deps=false ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz \
  ../shieldlabs-react/shieldlabs-ai-react-1.0.0.tgz ../shieldlabs-node/shieldlabs-ai-node-1.0.0.tgz
```

Repeat the last command after every `npm ci`. When the packs are missing, `npm run typecheck`,
`npm run lint` and `npm run build` stop with these instructions (`scripts/check-peers.mjs`). Never
commit a `file:` dependency or a tarball.

### Why `.npmrc` sets `legacy-peer-deps=true` for now

`package.json` lists the three ShieldLabs packages as peer dependencies, because apps install them
next to this package. npm installs peer dependencies automatically and would try to download them
from the registry, where they do not exist yet, so `npm ci` would fail. `legacy-peer-deps=true` in
`.npmrc` makes npm skip peer dependencies; it applies to work in this repository only and is not
published. The same setting would make npm leave out the packs, whose names match peer
dependencies, so their install command turns it off with `--legacy-peer-deps=false`. `--no-save`
keeps `package.json` and `package-lock.json` unchanged. The release workflow installs the published
packages the same way, so a release needs no change to `.npmrc` or `package.json`.

Once the three packages are on npm: delete `.npmrc`, add them to `devDependencies`, run
`npm install` to refresh `package-lock.json`, and remove the pack steps from this file, from
`examples/app-router/README.md` and from `.github/workflows/ci.yml`.

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

Re-running the workflow is safe. When it stopped because a peer dependency was not on npm yet,
publish that package and re-run the workflow; a version that is already on npm is not published
again.

## Security

Please report security issues privately to <contact@shieldlabs.ai> rather than in a public issue.

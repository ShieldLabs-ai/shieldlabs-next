# Changelog

All notable changes to `@shieldlabs-ai/next` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-30

### Added

- Client entry `@shieldlabs-ai/next`: `ShieldLabsProvider`, `useShieldLabs()` and `useIdentify()` of
  `@shieldlabs-ai/react`, `ShieldLabsError` of `@shieldlabs-ai/js` and their types, including
  `ShieldLabsAgent` and `InteractionIdentifier`. The built files start with the `"use client"`
  directive, so the root layout of the App Router can render the provider.
- `useIdentify().identify()` resolves the result, or `null` with the reason in `error`, and never
  rejects. While a call with the same User HID and `timeout` runs, a second call of the same hook
  returns it, so a double submit costs one identification; a call without `timeout` counts as one
  with the provider `timeout`. Options of `identify()` with a `userId` key override the `userId` of
  the hook, also with `undefined` or `null`, which both identify anonymously. The call's `timeout`
  covers the wait for the agent to load and the agent's answer.
- `ShieldLabsProvider` takes `autoLoad` (default `true`). With `autoLoad={false}`, for example until
  the user has given consent, nothing loads until `load()` from `useShieldLabs()` is called. Until
  then `useIdentify().identify()` resolves `null` at once with a `not_initialized` error, and
  `runOnMount` ends the same way without running again after `load()`.
  `useShieldLabs().identify()` rejects with `not_initialized`, `check()` resolves `null` and
  `getAgent()` waits, with no timeout of its own.
- `useShieldLabs()` returns `status`, `error`, `identify()`, `check()`, `load()` and `getAgent()`,
  which resolves the loaded agent, for example for `agent.identifyOnInteraction(form)`.
- Server entry `@shieldlabs-ai/next/server` for the Node.js and Edge runtimes. It imports no client code
  and no Node.js built-ins; Edge builds get the edge build of `@shieldlabs-ai/node` through its export
  conditions.
- `getIdentification(requestId, options?)`: `identifications.get()` of `@shieldlabs-ai/node` (waits for
  the verdict by default) with a client created on first use from `SHIELDLABS_API_KEY` and
  `SHIELDLABS_API_BASE_URL`, whose requests stay out of the Next.js Data Cache. Rejects with a
  `ValidationError` that names the variable when the key is missing. The `client` option takes your
  own `ShieldLabs` client.
- `createWebhookHandler({ secret, onEvent, onError, maxBodySize })`: a route handler that reads the
  raw body, verifies `X-Shield-Signature` with WebCrypto and answers 401 for a missing or invalid
  signature, 400 for an unusable body with a valid signature, 413 for a body larger than
  `maxBodySize` (default 1 MiB), 200 after `onEvent` resolves, 200 for `webhook.ping` (which never
  reaches `onEvent`), 405 for other methods and 500 when `onEvent` fails or no secret is configured.
  A missing or malformed signature header and a `Content-Length` above the limit are answered before
  the body is read, and a body without `Content-Length` is read only up to the limit. Response bodies
  are generic JSON. The default secret comes from `SHIELDLABS_WEBHOOK_SECRET`, with several secrets
  separated by commas while you rotate; the `secret` option is parsed the same way.
- Re-exports of `@shieldlabs-ai/node`: `ShieldLabs`, `evaluateIdentification`, `riskBand`,
  `isRateLimited`, `userHidAsync` (the User HID helper that works in both runtimes), `NIL_UUID`,
  `SIGNALS`, `RISK_BANDS`, the error classes, and the `Identification`, evaluation and webhook event
  types.
- ESM and CommonJS builds with TypeScript declarations. Peer dependencies: `@shieldlabs-ai/react`,
  `@shieldlabs-ai/js` and `@shieldlabs-ai/node` 1.x, `react` 18 or 19, and `next` 14, 15 or 16.
- `examples/app-router`: a signup page that arms its form with `identifyOnInteraction()` once the
  agent has loaded, a Server Action that reads and evaluates the verdict and refuses reused request
  IDs (recorded in an asynchronous store before the policy runs), and a webhook route handler in the
  Node.js runtime, with the Edge runtime as a commented option.
- README guide for the App Router (provider, consent with `autoLoad`, early identification with
  `getAgent()` and `identifyOnInteraction()`, Server Actions, signed-in users with a User HID, route
  handlers, middleware and the webhook route, Edge runtime) and the Pages Router.

### Changed

- Replaces the pre-release scaffold. `useShieldLabs()` now returns the status and the calls of the
  agent from `@shieldlabs-ai/react` 1.x: `status`, `error`, `identify()`, `check()`, `load()` and
  `getAgent()`.

### Removed

- The placeholder types `IdentificationResult` and `ShieldLabsOptions` of the scaffold. The browser
  receives a request ID, and results are read on your server with `@shieldlabs-ai/next/server`.

[Unreleased]: https://github.com/ShieldLabs-ai/shieldlabs-next/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ShieldLabs-ai/shieldlabs-next/releases/tag/v1.0.0

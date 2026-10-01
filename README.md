# @shieldlabs-ai/next

Next.js integration for ShieldLabs device intelligence: the React provider and hooks as a client
module, and server helpers that read identifications and verify signed webhooks in the Node.js and
Edge runtimes.

[![CI](https://github.com/ShieldLabs-ai/shieldlabs-next/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldLabs-ai/shieldlabs-next/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@shieldlabs-ai/next)](https://www.npmjs.com/package/@shieldlabs-ai/next)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

`@shieldlabs-ai/next` brings two packages to Next.js:
[`@shieldlabs-ai/react`](https://github.com/ShieldLabs-ai/shieldlabs-react) (the provider and hooks,
which load the hosted agent from `https://cdn.shieldlabs.ai` through
[`@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js)) and
[`@shieldlabs-ai/node`](https://github.com/ShieldLabs-ai/shieldlabs-node) (the History API client,
webhook verification and risk helpers). It supports Next.js 14, 15 and 16 with React 18 and 19. The
guide starts with the App Router; the [Pages Router](#pages-router) works as well.

New to ShieldLabs? [Start free](https://app.shieldlabs.ai), then copy the keys of your domain from
Integration > API keys in the analytics dashboard (the Install tab also shows a ready snippet that
contains the Public Key).

## How it fits

1. **Browser.** `ShieldLabsProvider` in your root layout loads the agent once, and `useIdentify()`
   runs an identification when the user begins a protected action (signup, login, checkout). The page
   receives a `requestId` and sends it with the action.
2. **Your backend.** A Server Action or route handler calls `getIdentification(requestId)` from
   `@shieldlabs-ai/next/server` to read the verdict from the History API, or a route handler made with
   `createWebhookHandler()` receives it in a signed `identification.scored` webhook.
3. **Decision.** Your server acts on the Risk Score (bands: trusted 0-29, suspicious 30-59,
   dangerous 60-100), the detection flags and identifiers such as the device ID.
   `evaluateIdentification()` applies a reusable guard policy.

The browser only ever gets the request ID. The Risk Score, risk signals, detection flags, visitor ID
and device ID are read on your server and stay there.

## Install

```bash
npm install @shieldlabs-ai/next @shieldlabs-ai/react @shieldlabs-ai/js @shieldlabs-ai/node
# or
yarn add @shieldlabs-ai/next @shieldlabs-ai/react @shieldlabs-ai/js @shieldlabs-ai/node
# or
pnpm add @shieldlabs-ai/next @shieldlabs-ai/react @shieldlabs-ai/js @shieldlabs-ai/node
```

`@shieldlabs-ai/react`, `@shieldlabs-ai/js` and `@shieldlabs-ai/node` (1.x), `react` (18 or 19) and `next`
(14, 15 or 16) are peer dependencies: install them in your app, as above.

Put the keys of your domain in `.env.local` (see [Environment variables](#environment-variables)):

```bash
NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY=0123456789abcdef0123456789abcdef
SHIELDLABS_API_KEY=sec_your_private_key
SHIELDLABS_WEBHOOK_SECRET=whsec_your_signing_secret
```

## Quick start

With the App Router: a provider in the root layout, a signup page whose form sends a `requestId`, a
Server Action that reads the verdict, a store for used request IDs, and a route handler for webhooks.
The imports use the `@/` alias that `create-next-app` sets up.

```tsx
// app/layout.tsx (a Server Component: ShieldLabsProvider is a client component inside it)
import type { ReactNode } from 'react';
import { ShieldLabsProvider } from '@shieldlabs-ai/next';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ShieldLabsProvider publicKey={process.env.NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY!}>
          {children}
        </ShieldLabsProvider>
      </body>
    </html>
  );
}
```

```tsx
// app/signup/page.tsx
import { SignupForm } from './signup-form';

export default function SignupPage() {
  return (
    <main>
      <h1>Create an account</h1>
      <SignupForm />
    </main>
  );
}
```

```tsx
// app/signup/signup-form.tsx
'use client';

import { useState, type SyntheticEvent } from 'react';
import { useIdentify } from '@shieldlabs-ai/next';
import { signup } from './actions';

export function SignupForm() {
  const { identify, isLoading } = useIdentify();
  const [message, setMessage] = useState('');

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // null when there is no identification (a content blocker, a timeout): the signup goes out
    // anyway, and the Server Action treats it as unverified.
    const result = await identify();
    if (result) formData.set('requestId', result.requestId);
    const { ok } = await signup(formData);
    setMessage(ok ? 'Account created.' : 'We could not create your account.');
  }

  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" required />
      <button disabled={isLoading}>Sign up</button>
      <p role="status">{message}</p>
    </form>
  );
}
```

```ts
// app/signup/actions.ts
'use server';

import { evaluateIdentification, getIdentification, type Identification } from '@shieldlabs-ai/next/server';
import { markRequestIdUsed } from '@/lib/request-ids';

export async function signup(formData: FormData): Promise<{ ok: boolean }> {
  const requestId = formData.get('requestId');
  let identification: Identification | null = null;
  if (typeof requestId === 'string' && requestId !== '') {
    try {
      // Waits until ShieldLabs has stored the verdict, for up to 10 seconds.
      identification = await getIdentification(requestId);
    } catch (error) {
      console.error('ShieldLabs verdict unavailable:', error); // a malformed ID, a wrong key, a network error
    }
  }

  // One identification authorizes one attempt: record its request ID first (the store is
  // asynchronous), then hand the answer to isReplay, which must answer synchronously.
  const firstUse = identification !== null && (await markRequestIdUsed(identification.request_id));

  // Refuses a missing, reused or stale identification, the rate-limit marker, missing device signals,
  // browser automation or disabled JavaScript, and the dangerous band.
  const verdict = evaluateIdentification(identification, { isReplay: () => !firstUse });
  if (!verdict.ok) return { ok: false };

  // Create the account here.
  return { ok: true };
}
```

```ts
// lib/request-ids.ts
// Used request IDs, in the memory of one server process. In production, use a store that every
// instance shares: Redis (SET <request id> 1 NX EX 600) or a column with a unique index.
const used = new Map<string, number>();

/** Records a request ID. Resolves to true the first time, and to false for every repeat. */
export async function markRequestIdUsed(requestId: string): Promise<boolean> {
  const now = Date.now();
  for (const [id, forgetAt] of used) if (forgetAt <= now) used.delete(id);
  if (used.has(requestId)) return false;
  used.set(requestId, now + 10 * 60 * 1000); // twice the 5-minute freshness window
  return true;
}
```

```ts
// app/api/shieldlabs/webhook/route.ts
import { createWebhookHandler } from '@shieldlabs-ai/next/server';

export const POST = createWebhookHandler({
  // Verified with SHIELDLABS_WEBHOOK_SECRET. webhook.ping is answered by the handler itself.
  onEvent(event) {
    if (event.event_type !== 'identification.scored') return;
    // Store the verdict here, keyed by request ID (an upsert), so a repeated delivery changes nothing.
    console.info('ShieldLabs verdict', event.data.request_id, event.data.risk_score);
  },
});
```

`identify()` from `useIdentify()` never rejects: it resolves the result, or `null` with the reason in
`error`. A second submit while the identification runs gets the same one, so a double click costs one
identification.

Add `https://<your domain>/api/shieldlabs/webhook` as a webhook endpoint in the analytics dashboard,
put its signing secret in `SHIELDLABS_WEBHOOK_SECRET` and press Verify: the handler answers the
`webhook.ping` with 200.

`getIdentification()` waits until the verdict is stored, which is usually 1 to 3 seconds after
`identify()`. Start the identification when the user begins the action to save that time
([Identify when the user begins the action](#identify-when-the-user-begins-the-action)).
[`examples/app-router`](./examples/app-router) is a complete app built this way.

## Guide

### The provider in the root layout

`ShieldLabsProvider` is a client component, so the root layout (a Server Component) can render it
around `{children}`. It renders its children on the server and loads the agent once in the browser,
after hydration. Keep it in the root layout, so that navigation does not remount it; it never starts
an identification on a route change. In development, React StrictMode does not load the agent twice.

- `publicKey` is the Public Key of your domain. Next.js inlines `NEXT_PUBLIC_` variables into the
  browser code at build time, so set `NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY` before `next build`. When it
  is missing, `useShieldLabs()` reports `status: 'error'` and the provider logs a console warning.
- `autoLoad` (default `true`) loads the agent after hydration. With `autoLoad={false}`, nothing loads
  until `load()` from `useShieldLabs()` is called or `autoLoad` becomes `true` (see
  [Consent](#consent)).
- `checkOnLoad` runs a background `check()` once per provider mount when the agent is ready, for
  passive monitoring of the visit, unless an `identify()` or `check()` for the same User HID is
  already running. The agent limits it to one identification per visit every five minutes.
- The other props (`environment`, `scriptUrl`, `timeout`) and the hooks are those of
  `@shieldlabs-ai/react`: see its [reference](https://github.com/ShieldLabs-ai/shieldlabs-react#reference).

You do not need to wait for `status: 'ready'`: an identification requested while the agent loads
waits for it, and its `timeout` (default 10 seconds) covers the whole call, the wait for the agent and
then the agent's answer.

### Identify when the user begins the action

The History row of an identification appears about 1 to 3 seconds after the browser call, and it can
be refined for up to about 10 seconds while follow-up checks finish. Start the identification when
the user begins the action and send its `requestId` with the submit: by then the verdict is usually
stored, and `getIdentification()` returns at once.

`getAgent()` from `useShieldLabs()` resolves the loaded agent of `@shieldlabs-ai/js`, and its
`identifyOnInteraction(form)` starts an identification on the first `focusin`, `pointerdown` or
`keydown` inside the form. The handle's `take()` returns that identification for this submission and
re-arms, so the next submission gets its own request ID:

```tsx
'use client';

import { useEffect, useRef, type SyntheticEvent } from 'react';
import { useIdentify, useShieldLabs, type InteractionIdentifier } from '@shieldlabs-ai/next';
import { signup } from './actions';

export function SignupForm() {
  const { getAgent } = useShieldLabs();
  const { identify } = useIdentify();
  const formRef = useRef<HTMLFormElement>(null);
  const early = useRef<InteractionIdentifier | null>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let active = true;
    getAgent().then(
      (agent) => {
        if (active) early.current = agent.identifyOnInteraction(form);
      },
      () => {}, // the agent could not load: the submit handler tries again
    );
    return () => {
      active = false;
      early.current?.dispose();
      early.current = null;
    };
  }, [getAgent]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // The early identification while it is fresh, otherwise a new one. Without an early handle,
    // identify() loads the agent again. Both give null when there is no identification.
    const result = early.current ? await early.current.take().catch(() => null) : await identify();
    if (result) formData.set('requestId', result.requestId);
    await signup(formData);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      {/* fields */}
    </form>
  );
}
```

`take()` hands out the early identification only while it is fresh. When it failed, or finished more
than 4 minutes ago, `take()` starts a new one, so the request ID your server receives stays inside the
5-minute freshness window. While users keep interacting with the form, a new identification starts at
most every 4 minutes (after a failure, at most one attempt every 5 seconds), and each of them is
billed. The effect's cleanup removes the listeners when the form unmounts.
[`examples/app-router`](./examples/app-router) is a complete signup page built this way.

- One identification authorizes one protected action. Never identify on every render or route
  change: each identification is billed and counts toward a small per-IP budget (see
  [Call budget](https://github.com/ShieldLabs-ai/shieldlabs-js#call-budget)).
- The agent sends the identification right after it hands over the request ID. Calling a Server
  Action or `fetch()` keeps the page open meanwhile; do not navigate away (for example with
  `router.push()`) before your request is sent.
- The agent also runs its own limited background checks on clicks and navigation, so your backend can
  see more identifications for the same user and session than the page started.

### Read the verdict in a Server Action

`getIdentification(requestId, options?)` reads the identification for a request ID from the History
API and returns an `Identification`, or `null` when none is found in time. It is
`identifications.get()` of `@shieldlabs-ai/node` with a client created from `SHIELDLABS_API_KEY`:

- By default it waits, within a total budget of `timeout` (default 10 000 ms). The first poll runs
  at once. With `pollInterval` p (default 250 ms), the waits between polls are p, 2p, 4p, 6p and 8p,
  then 8p for every later wait, each capped at max(2 s, p): 250 ms, 500 ms, 1 s, 1.5 s and then
  every 2 s by default, and a `pollInterval` of 3 000 polls every 3 s. A wait that would pass the
  deadline is cut short, so the last poll runs at the deadline. Each poll is one HTTP attempt.
- A 429, a 5xx, a connection error or an attempt timeout keeps polling, while 400, 401, 403 and 404
  stop at once. After a 429, the `RateLimitError` is thrown at once when its `Retry-After`, capped
  at 10 s, is longer than the time left. Otherwise the next wait is the longest of the scheduled
  wait, 1 s and `Retry-After` capped at 10 s (a missing `Retry-After`, `0` or a date in the past
  counts as 0), cut short at the deadline, and the last poll runs at the deadline. At the deadline
  it throws the error of a failed last poll, and otherwise resolves `null`. `{ wait: false }` reads
  once, with the client's normal retries. The details are in
  [Wait for the verdict](https://github.com/ShieldLabs-ai/shieldlabs-node#wait-for-the-verdict).
- `null` means unverified, never clean: refuse the action or route it to review.
- The client is created on the first call and reused. Its requests use `cache: 'no-store'`, so the
  Next.js Data Cache never keeps a History response (in Next.js 14 it caches `fetch()` by default).
- It works wherever server code runs: Server Actions, route handlers, Server Components, Pages Router
  API routes, in the Node.js and Edge runtimes.

`evaluateIdentification(identification, options?)` applies the guard policy every integration needs.
Checks run in this order and the first failure wins:

| Order | Check | `reason` |
|---|---|---|
| 1 | No identification (`null`) | `missing` |
| 2 | `isReplay(requestId)` returns true | `replayed` |
| 3 | Older than `maxAge` (default 5 minutes, by `observed_at`) | `stale` |
| 4 | Risk Score above 100 (the 999 rate-limit marker) | `rate_limited` |
| 5 | All-zero device ID (no usable device signals) | `no_device_signals` |
| 6 | A flag in `blockFlags` (default `browser_automation`, `javascript_disabled`) | `blocked_flag` |
| 7 | A band in `blockBands` (default `dangerous`) | `blocked_band` |

The defaults are a starting point to tune per action (see
[Apply a policy](https://github.com/ShieldLabs-ai/shieldlabs-node#apply-a-policy)). The SDK keeps no
state, and `isReplay` answers synchronously, while a shared store (a Redis key set with `NX` and an
expiry, a column with a unique index) answers with a promise. Record the request ID first, then pass
the answer, as the Quick start does:

```ts
const firstUse = identification !== null && (await markRequestIdUsed(identification.request_id));
const verdict = evaluateIdentification(identification, { isReplay: () => !firstUse });
```

Never write `isReplay: (id) => !markRequestIdUsed(id)` with an asynchronous store: a promise is always
truthy, so `isReplay` would return `false` for every repeat. Record `identification.request_id` (the ID
as ShieldLabs stores it) rather than the value from the form, so the same identification sent in
another letter case still counts as a repeat.

Send the browser only the outcome (created, refused, try again), never the Risk Score, the band or
the flags. A form that posts JSON to a route handler uses the same code in `app/api/.../route.ts`.

### Signed-in users: pass a User HID

For actions of signed-in users (login, checkout, a change of email address), pass a User HID so that
ShieldLabs ties the identification to the account. Compute it on the server with `userHidAsync()`
(HMAC-SHA256 of your account ID keyed with a secret of your app, 64 lowercase hex characters) and hand
it to the client component as a prop. Only this value reaches the browser: never pass a raw email
address or account ID to `useIdentify()`.

```tsx
// app/account/page.tsx (a Server Component)
import { userHidAsync } from '@shieldlabs-ai/next/server';
import { getSession } from '@/lib/session'; // your authentication
import { ChangeEmailForm } from './change-email-form';

export default async function AccountPage() {
  const session = await getSession();
  // USER_HID_SECRET: a long random value of your app (for example `openssl rand -hex 32`), kept on the
  // server. Changing it changes every User HID, so treat it as permanent.
  const userHid = await userHidAsync(String(session.user.id), process.env.USER_HID_SECRET!);
  return <ChangeEmailForm userHid={userHid} />;
}
```

```tsx
// app/account/change-email-form.tsx
'use client';

import type { SyntheticEvent } from 'react';
import { useIdentify } from '@shieldlabs-ai/next';
import { changeEmail } from './actions';

export function ChangeEmailForm({ userHid }: { userHid: string }) {
  // Every identification of this hook carries the User HID.
  const { identify } = useIdentify({ userId: userHid });

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // null when there is no identification: the Server Action treats the change as unverified.
    const result = await identify();
    if (result) formData.set('requestId', result.requestId);
    await changeEmail(formData);
  }

  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" required />
      <button>Change email</button>
    </form>
  );
}
```

The Server Action `changeEmail` reads and evaluates the identification like the signup action, and
also checks that it carries the User HID of the signed-in account:

```ts
const expected = await userHidAsync(String(session.user.id), process.env.USER_HID_SECRET!);
if (identification !== null && identification.user_hid !== expected) return { ok: false };
```

`userHidAsync()` works in the Node.js and Edge runtimes. Omit `userId` for visitors who are not signed
in: their identifications are anonymous (`user_hid` is `"anonymous"`).

### Receive webhooks in a route handler

`createWebhookHandler(options)` returns a route handler for `POST` requests. It reads the raw body
from `request.body` (up to `maxBodySize` bytes), verifies the `X-Shield-Signature` header over those
exact bytes with `webhooks.constructEventAsync()` of `@shieldlabs-ai/node`, and calls `onEvent` with the
typed event:

| Answer | When |
|---|---|
| `200 {"received":true}` | `onEvent` resolved, or the event is a `webhook.ping` |
| `400 {"error":"invalid_payload"}` | The signature is valid, but the body is not a ShieldLabs event, or the body could not be read |
| `401 {"error":"invalid_signature"}` | The signature header is missing, malformed or matches no secret |
| `405 {"error":"method_not_allowed"}` | The request is not a `POST` (the response has `Allow: POST`). In the App Router, Next.js answers the methods your route file does not export before the handler runs |
| `413 {"error":"payload_too_large"}` | The body is larger than `maxBodySize` (default 1 MiB) |
| `500 {"error":"internal_error"}` | `onEvent` threw or rejected, or no signing secret is configured |

Response bodies are always these generic JSON objects and never include error details.

- **Pings.** `webhook.ping` (Verify in the analytics dashboard) is answered with 200 by the handler
  and never reaches `onEvent`. `onEvent` receives `identification.scored` events and, as an
  `UnknownWebhookEvent`, event types this version does not know yet: return to acknowledge them.
- **Deliveries.** Today each identification is delivered once per endpoint, with a 1-second timeout
  and no retries. A later server release adds retries that resend identical bytes, so make `onEvent`
  idempotent on `event.data.request_id`. A missed delivery is not sent again, so read the History API
  (`getIdentification()`) whenever you need a verdict for certain. It also holds the latest state: a
  History row can be refined after its webhook was sent, and the webhook is not sent again.
- **Answer fast.** The handler answers after `onEvent` resolves, so keep it under the 1-second
  timeout: store the verdict or queue the work. In Next.js 15.1 and later, work passed to `after()`
  from `next/server` runs after the response is sent.
- **Body size.** The handler reads the body only when the `X-Shield-Signature` header is well formed,
  and never more than `maxBodySize` bytes (default 1 MiB; a delivery is about 2 KB). A larger
  `Content-Length` gets 413 before anything is read, and a body without `Content-Length` is read only
  until it passes the limit. In the Node.js runtime, the default, this keeps large requests out of
  memory as long as no middleware runs on the webhook path (see
  [Middleware and the webhook route](#middleware-and-the-webhook-route)). When you host the app
  yourself with `next start`, an Edge route handler runs only after Next.js has read the whole body.
- **Secrets.** By default the handler reads `SHIELDLABS_WEBHOOK_SECRET` on every request. Put
  several secrets in it, separated by commas, while you rotate: a delivery is valid when any of them
  matches. The `secret` option (a string or an array) replaces the variable and follows the same
  rules: in a string, commas separate secrets, and every secret is trimmed.
- **Failures.** `onError(error, { request, status })` is called before the handler answers 400, 401,
  413 or 500. Without it, the handler logs a console warning for 400, 401 and 413 and a console error
  for 500. Messages never include secrets.
- **Routing.** The endpoint URL must use `https` and be reachable from the internet. Keep middleware
  off the webhook path (see [Middleware and the webhook route](#middleware-and-the-webhook-route)).

### Middleware and the webhook route

When middleware (`middleware.ts`, or `proxy.ts` in Next.js 16) runs on a path, Next.js copies the
request body for it before the route handler runs, so `maxBodySize` cannot keep a large request out of
memory there. Next.js 14, and Next.js 15 before 15.5.5, read the whole body, whatever its size; later
releases stop at 10 MB by default (`experimental.middlewareClientMaxBodySize`, or
`experimental.proxyClientMaxBodySize` in Next.js 16). A redirect or rewrite on this path (locale,
trailing slash or sign-in redirects) also keeps deliveries from reaching the handler. Leave the
webhook path out of the matcher:

```ts
// middleware.ts (proxy.ts in Next.js 16)
export const config = {
  // Every path except the webhook route and static files.
  matcher: ['/((?!api/shieldlabs/webhook|_next/static|_next/image|favicon.ico).*)'],
};
```

When middleware has to run on every path, cap request bodies for the webhook path in the reverse
proxy in front of the app instead. The same applies to a Pages Router API route.

### Edge runtime

The server entry imports no Node.js built-ins, so the same code runs in the Edge runtime:

```ts
// app/api/shieldlabs/webhook/route.ts
import { createWebhookHandler } from '@shieldlabs-ai/next/server';

export const runtime = 'edge';

export const POST = createWebhookHandler({
  onEvent(event) {
    // ...
  },
});
```

- Bundlers that build for the Edge runtime select the edge build of `@shieldlabs-ai/node` through its
  export conditions (`edge-light`, `worker`). Signatures are verified with WebCrypto, and
  `getIdentification()` uses `fetch()`.
- The environment variables are read when a request is handled, with literal
  `process.env.SHIELDLABS_*` names. Set them for the Edge runtime like any other variable of your
  deployment.
- Recent Next.js releases print a deprecation warning for the Edge runtime during the build. Without
  the `runtime` line, the handler runs in the Node.js runtime, the default, with the same behaviour.
- When you host the app yourself with `next start`, an Edge route handler runs only after Next.js has
  read the whole request body, so `maxBodySize` cannot keep a large request out of memory there. Use
  the Edge runtime for the webhook route only on a hosting platform that caps request bodies itself;
  otherwise keep the Node.js runtime, where the handler reads the body as a stream, as
  [`examples/app-router`](./examples/app-router) does.

### Use your own client

Pass a `ShieldLabs` client to set the timeout, retries or `fetch` yourself:

```ts
import { ShieldLabs, getIdentification } from '@shieldlabs-ai/next/server';

const shieldlabs = new ShieldLabs({
  apiKey: process.env.SHIELDLABS_API_KEY!,
  timeout: 5_000,
  // Next.js 14 caches fetch() by default: keep History responses out of the Data Cache.
  fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
});

const identification = await getIdentification(requestId, { client: shieldlabs, timeout: 5_000 });
```

For History searches by device ID, User HID, visitor ID or IP (for example, how many accounts one
device has used), use the client of `@shieldlabs-ai/node` directly: see
[Search history for account-abuse checks](https://github.com/ShieldLabs-ai/shieldlabs-node#search-history-for-account-abuse-checks).

### Pages Router

The client entry works in the Pages Router unchanged; the `"use client"` directive has no effect
there. Render the provider in `pages/_app.tsx`:

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app';
import { ShieldLabsProvider } from '@shieldlabs-ai/next';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ShieldLabsProvider publicKey={process.env.NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY!}>
      <Component {...pageProps} />
    </ShieldLabsProvider>
  );
}
```

Pages call `useIdentify()` as in the App Router and send the `requestId` to an API route, which reads
the verdict. It uses `lib/request-ids.ts` from the [Quick start](#quick-start):

```ts
// pages/api/signup.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { evaluateIdentification, getIdentification, type Identification } from '@shieldlabs-ai/next/server';
import { markRequestIdUsed } from '../../lib/request-ids';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { requestId } = req.body as { requestId?: unknown };

  let identification: Identification | null = null;
  if (typeof requestId === 'string' && requestId !== '') {
    try {
      identification = await getIdentification(requestId); // waits until the verdict is stored
    } catch (error) {
      console.error('ShieldLabs verdict unavailable:', error);
    }
  }

  // Record the request ID first, then pass the answer: isReplay must answer synchronously.
  const firstUse = identification !== null && (await markRequestIdUsed(identification.request_id));
  const verdict = evaluateIdentification(identification, { isReplay: () => !firstUse });
  if (!verdict.ok) return res.status(403).json({ ok: false });

  // Create the account here.
  return res.status(200).json({ ok: true });
}
```

For webhooks, the signature covers the exact bytes ShieldLabs sent, so an API route in the Node.js
runtime turns off the body parser, reads the raw body itself (up to a limit) and hands it to the
handler as a `Request`:

```ts
// pages/api/shieldlabs/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createWebhookHandler } from '@shieldlabs-ai/next/server';

// Keep the body raw: parsed and serialized again, it no longer matches the signature.
export const config = { api: { bodyParser: false } };

// A delivery is about 2 KB: never read more than 1 MiB of a request.
const MAX_BODY_SIZE = 1024 * 1024;

const handleWebhook = createWebhookHandler({
  maxBodySize: MAX_BODY_SIZE,
  onEvent(event) {
    if (event.event_type !== 'identification.scored') return;
    // Store the verdict here, keyed by request ID (an upsert), so a repeated delivery changes nothing.
    console.info('ShieldLabs verdict', event.data.request_id, event.data.risk_score);
  },
});

/** The raw body, or null when it is larger than MAX_BODY_SIZE. */
async function readRawBody(req: NextApiRequest): Promise<Buffer | null> {
  if (Number(req.headers['content-length']) > MAX_BODY_SIZE) return null; // not read at all
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += bytes.length;
    if (size > MAX_BODY_SIZE) return null; // leaving the loop stops reading and closes the request
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.method === 'POST' ? await readRawBody(req) : Buffer.alloc(0);
  if (body === null) return res.status(413).json({ error: 'payload_too_large' });
  const signature = req.headers['x-shield-signature'];
  const response = await handleWebhook(
    new Request('https://localhost/api/shieldlabs/webhook', {
      method: req.method ?? 'POST',
      headers: typeof signature === 'string' ? { 'x-shield-signature': signature } : {},
      body: req.method === 'POST' ? new Uint8Array(body) : null,
    }),
  );
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.status(response.status).send(await response.text());
}
```

An API route in the Edge runtime receives a `Request` with the raw body, so the handler is its
default export. When you host the app yourself, prefer the Node.js route above: in the Edge runtime,
Next.js reads the whole request body before the handler runs.

```ts
// pages/api/shieldlabs/webhook.ts
import { createWebhookHandler } from '@shieldlabs-ai/next/server';

export const config = { runtime: 'edge' };

export default createWebhookHandler({
  onEvent(event) {
    if (event.event_type === 'identification.scored') console.info('ShieldLabs verdict', event.data.request_id);
  },
});
```

### Environment variables

| Variable | Where | Read by | Value |
|---|---|---|---|
| `NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY` | Browser (inlined at build time) | The `publicKey` prop you pass to `ShieldLabsProvider` | Public Key of the domain (32 hex characters), from Integration > API keys |
| `SHIELDLABS_API_KEY` | Server only | `getIdentification()` without `client` | Private API Key of the domain (`sec_...`) |
| `SHIELDLABS_API_BASE_URL` | Server only, optional | `getIdentification()` without `client` | Another History API origin, for tests: `https`, or plain `http` on `localhost`, `127.0.0.1` or `[::1]`. Default `https://account.shieldlabs.ai` |
| `SHIELDLABS_WEBHOOK_SECRET` | Server only | `createWebhookHandler()` without `secret` | Signing secret of the endpoint (`whsec_...`). Several, separated by commas, while you rotate |
| `USER_HID_SECRET` | Server only, your own | Your code, for `userHidAsync()` (the SDK never reads it) | A long random value you create once, the key of your User HIDs |

- Never give a server variable a `NEXT_PUBLIC_` prefix: Next.js adds those variables to the
  JavaScript it sends to the browser. The provider refuses a `sec_` or `whsec_` value as `publicKey`.
- The server entry reads its variables when a function runs, never at import time, so `next build`
  does not need them. Values are trimmed; an empty value counts as not set.
- For development and staging, register a separate domain in the analytics dashboard and use its
  keys (see [Environments](https://docs.shieldlabs.ai/setup/environments)).

### Test on a registered domain

ShieldLabs records identifications only for the domains registered in your account. On `localhost`
the page still receives a `requestId`, but the identification is rejected and your backend never
finds it (`getIdentification()` returns `null` after its timeout). Test on a development domain with
its own keys. Webhook endpoints need a public `https` URL, so point a development endpoint at a
deployed preview or a tunnel.

### Consent

The agent does not read your consent banner (see
[Consent](https://github.com/ShieldLabs-ai/shieldlabs-js#consent) in the `@shieldlabs-ai/js` guide).
Where your policy requires consent before the agent loads, render the provider with
`autoLoad={false}` and call `load()` from `useShieldLabs()` once the user has agreed:

```tsx
// app/layout.tsx
<ShieldLabsProvider publicKey={process.env.NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY!} autoLoad={false}>
  <ConsentBanner />
  {children}
</ShieldLabsProvider>
```

```tsx
// app/consent-banner.tsx
'use client';

import { useShieldLabs } from '@shieldlabs-ai/next';

export function ConsentBanner() {
  const { load } = useShieldLabs();
  // Record the choice as your consent tool requires, then load the agent.
  return <button onClick={load}>Accept</button>;
}
```

When the layout already knows the choice (for example from a cookie), pass it instead:
`autoLoad={consentGiven}`. Until the agent loads, the rest of the app works unchanged and nothing
waits for consent:

- `identify()` from `useIdentify()` resolves `null` at once, with a `not_initialized` error, so forms
  go out without a `requestId` and your server treats them as unverified. `runOnMount` ends the same
  way and does not run again by itself after `load()`.
- `useShieldLabs().identify()` rejects with `not_initialized`, and `check()` resolves `null`.
- `getAgent()` waits, with no timeout of its own, so a form set up for early identification (see
  [Identify when the user begins the action](#identify-when-the-user-begins-the-action)) is armed once
  `load()` has been called and the agent has loaded. When that load fails, `getAgent()` rejects with
  its error. `checkOnLoad` runs once the agent is ready.
- `status` stays `'loading'`.

### Call budget and Content Security Policy

The rules of `@shieldlabs-ai/js` apply unchanged:

- [Call budget](https://github.com/ShieldLabs-ai/shieldlabs-js#call-budget): one identification per
  protected action, and a small per-IP budget on the ingest. Never clear the agent's storage.
- [Content Security Policy](https://github.com/ShieldLabs-ai/shieldlabs-js#content-security-policy):
  the `script-src` and `connect-src` origins the agent needs. Add them where your app sets its
  policy, for example in `headers()` of `next.config.js` or in middleware.

### Package entry points

| Import | Use it in | Contents |
|---|---|---|
| `@shieldlabs-ai/next` | The root layout, Client Components, Pages Router pages and `_app` | The provider, the hooks, `ShieldLabsError` and their types. The built files start with `"use client"` |
| `@shieldlabs-ai/next/server` | Server Actions, route handlers, Server Components and Pages Router API routes, in the Node.js and Edge runtimes | `getIdentification`, `createWebhookHandler` and re-exports of `@shieldlabs-ai/node`, including `userHidAsync` |

The entries never import each other: the client entry contains no server code, and the server entry
contains no React, browser or Node.js built-in code. Import `@shieldlabs-ai/next/server` only in server
code; `SHIELDLABS_API_KEY` and `SHIELDLABS_WEBHOOK_SECRET` exist only on the server.

## Reference

### `@shieldlabs-ai/next`

| Export | Description |
|---|---|
| `ShieldLabsProvider` | Loads the agent once in the browser and provides it to the hooks below it. Props: `publicKey`, `environment`, `scriptUrl`, `timeout`, `autoLoad` (default `true`), `checkOnLoad` |
| `useShieldLabs()` | `{ status, error, identify, check, load, getAgent }` of the closest provider. `status` is `'loading'`, `'ready'` or `'error'`. `identify()` rejects with a `ShieldLabsError` when there is no identification, `load()` starts loading with `autoLoad={false}`, and `getAgent()` resolves the loaded agent (for `identifyOnInteraction(form)`) |
| `useIdentify(options?)` | `{ identify, result, isLoading, error, reset }`. Options: `userId` (a User HID computed on your server), `runOnMount`. `identify()` resolves the result, or `null` with the reason in `error`, and never rejects; while a call of the same hook with the same User HID and `timeout` runs, it returns that call (a call without `timeout` counts as one with the provider `timeout`). Options of `identify()` with a `userId` key override the `userId` of the hook, also with `undefined` or `null` (an anonymous identification) |
| `ShieldLabsError` | The browser error class, with `code`: `invalid_options`, `unsupported_environment`, `load_failed`, `not_initialized` or `timeout` |
| Types | `ShieldLabsProviderProps`, `ShieldLabsStatus`, `UseShieldLabsResult`, `UseIdentifyOptions`, `UseIdentifyResult`, `IdentifyOptions`, `IdentifyResult`, `InteractionIdentifier`, `LoadOptions`, `ShieldLabsAgent`, `ShieldLabsErrorCode` |

`IdentifyOptions` are `userId` and `timeout`: the milliseconds the whole call may take, a wait for the
agent to load and then the agent's answer. `ShieldLabsAgent` is the loaded agent of `@shieldlabs-ai/js`
(`identify()`, `check()`, `identifyOnInteraction(target, options?)`), and `InteractionIdentifier` the
handle that `identifyOnInteraction()` returns (`take()`, `dispose()`). The full descriptions are in the
[`@shieldlabs-ai/react` reference](https://github.com/ShieldLabs-ai/shieldlabs-react#reference).

### `@shieldlabs-ai/next/server`

`getIdentification(requestId, options?): Promise<Identification | null>`

| Option | Default | Description |
|---|---|---|
| `client` | a client from `SHIELDLABS_API_KEY` | The `ShieldLabs` client to read with |
| `wait` | `true` | Poll until the identification appears (`true`) or read once (`false`) |
| `timeout` | `10000` | Total budget of the wait in milliseconds; the last poll runs at the deadline |
| `pollInterval` | `250` | p, the first wait between polls in milliseconds. The waits are p, 2p, 4p, 6p and 8p, then 8p for every later wait, each capped at max(2 000, p): a `pollInterval` of 3 000 polls every 3 s |
| `signal` | | An `AbortSignal` that cancels the call |

`createWebhookHandler(options): (request: Request) => Promise<Response>`

| Option | Default | Description |
|---|---|---|
| `onEvent(event)` | required | Called with every verified event except `webhook.ping`: an `IdentificationScoredEvent` or an `UnknownWebhookEvent`. May return a promise; the handler answers after it resolves |
| `secret` | `SHIELDLABS_WEBHOOK_SECRET` | The signing secret (`whsec_...`) or an array of secrets. In a string, commas separate secrets; every secret is trimmed |
| `onError(error, { request, status })` | console logging | Called before the handler answers 400, 401, 413 or 500 |
| `maxBodySize` | `1048576` (1 MiB) | The largest body the handler reads, in bytes. A larger `Content-Length` gets 413 before the body is read; a body without one is read only until it passes the limit |

Re-exported from `@shieldlabs-ai/node`:

| Export | Description |
|---|---|
| `ShieldLabs` | The History API client, for the `client` option |
| `evaluateIdentification(identification, options?)` | `{ ok, reason, band, flag? }`. Options: `maxAge`, `now`, `blockBands`, `blockFlags`, `isReplay` |
| `riskBand(score)` | `'trusted'` (0-29), `'suspicious'` (30-59), `'dangerous'` (60-100), or `'rate_limited'` for the 999 marker |
| `isRateLimited(score)` | `true` for the rate-limit marker (a score above 100) |
| `userHidAsync(userId, secret)` | The User HID of an account: HMAC-SHA256 of `userId` keyed with `secret`, as 64 lowercase hex characters. Works in the Node.js and Edge runtimes |
| `NIL_UUID`, `SIGNALS`, `RISK_BANDS` | The all-zero UUID, the known risk signal slugs (an open set), the band ranges |
| Error classes | `ShieldLabsError` and its subclasses: `ValidationError`, `ApiError`, `BadRequestError`, `AuthenticationError`, `QuotaExceededError`, `NotFoundError`, `RateLimitError`, `ServerError`, `ConnectionError`, `TimeoutError`, `SignatureVerificationError`, `WebhookParseError` |
| Types | `Identification`, `IdentificationSignal`, `DetectionFlags`, `TrafficSource`, `IpInfo`, `ConnectionType`, `RiskBand`, `KnownSignal`, `Evaluation`, `EvaluationReason`, `EvaluateOptions`, `WebhookEvent`, `IdentificationScoredEvent`, `WebhookPingEvent`, `UnknownWebhookEvent`, `UnknownEventType`, `WebhookSecret`, `ShieldLabsOptions` |

Types of this package: `GetIdentificationOptions`, `WebhookHandlerOptions`, `WebhookHandler`,
`WebhookHandlerEvent` and `WebhookErrorContext`. The `Identification` model (identifiers, IPs with
countries, connection type, traffic source, Risk Score, risk signals, the 19 detection flags,
`observed_at`) is described in the
[`@shieldlabs-ai/node` reference](https://github.com/ShieldLabs-ai/shieldlabs-node#identification).

## Errors and retries

**In the browser**, every error is a `ShieldLabsError` with a `code`. `identify()` from
`useIdentify()` never rejects: it resolves `null` and puts the error in `error`. `identify()` and
`getAgent()` from `useShieldLabs()`, and `take()` of an interaction handle, reject with it. Whenever
there is no identification, send the action anyway without a `requestId`: your server treats it as
unverified (see [Errors and retries](https://github.com/ShieldLabs-ai/shieldlabs-react#errors-and-retries)
of `@shieldlabs-ai/react`).

**`getIdentification()`** rejects with the error classes of `@shieldlabs-ai/node`:

| Error | When |
|---|---|
| `ValidationError` | `SHIELDLABS_API_KEY` is not set (and no `client` was passed) or holds characters that cannot be sent in a header, `SHIELDLABS_API_BASE_URL` is not a valid URL or uses plain `http` on a host other than `localhost`, `127.0.0.1` or `[::1]`, the request ID is not a UUID, or an option is invalid. Nothing is sent, and the message never repeats the key |
| `BadRequestError` | 400. Polling stops at once |
| `AuthenticationError` | 401 or 403: a wrong key, or the key of a disabled domain. Polling stops at once |
| `NotFoundError` | 404: usually a wrong `SHIELDLABS_API_BASE_URL`. Polling stops at once |
| `RateLimitError`, `ServerError`, `ConnectionError`, `TimeoutError` | A single read (`wait: false`) still failed after its retries, or the last poll failed this way at the deadline. A 429 inside the wait is thrown at once when its `Retry-After`, capped at 10 s, is longer than the time left; otherwise the next wait is the longest of the scheduled wait, 1 s and the capped `Retry-After` (0 when missing), cut short at the deadline, where the last poll runs |
| `ApiError` | Any other error status, or a response body the SDK cannot use |

A single read is retried up to `maxRetries` times (default 2) on connection errors, timeouts, 429 and
5xx, with exponential backoff and jitter (0.5 s base, doubling, capped at 8 s). `Retry-After` is
followed as sent, capped at 10 s (`0` or a date in the past retries at once), and a 429 without it
waits at least 1 s. 400, 401, 402, 403 and 404 are never retried. While `getIdentification()` waits
for a verdict, each poll is a single attempt and the polling schedule takes the place of these
retries. Error messages never include keys.

**`createWebhookHandler()`** throws a `ValidationError` when its options are not an object with an
`onEvent` function, when `onError` is not a function, when `secret` is not a string or an array of
strings, or when `maxBodySize` is not a whole number of bytes, 1 or more. It never throws while
handling a request: it answers with the statuses in
[Receive webhooks in a route handler](#receive-webhooks-in-a-route-handler) and reports the error to
`onError` (a `SignatureVerificationError` for 401, a `WebhookParseError` for 400 and 413, the thrown
value or a `ValidationError` for 500).

## Compatibility

- Next.js 14, 15 and 16: the App Router (Server Components, Server Actions, route handlers) and the
  Pages Router (pages and API routes), built with webpack or Turbopack.
- React 18 and 19.
- The Node.js runtime (Node.js 18.17 or later; Next.js 16 needs Node.js 20.9 or later) and the Edge
  runtime.
- ESM and CommonJS builds with TypeScript declarations. No dependencies besides the peer
  dependencies, no network calls at import time and no telemetry.

## Development

```bash
npm ci
# Until the other ShieldLabs packages are on npm, install local packs of them (see CONTRIBUTING.md):
npm install --no-save --legacy-peer-deps=false ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz \
  ../shieldlabs-react/shieldlabs-ai-react-1.0.0.tgz ../shieldlabs-node/shieldlabs-ai-node-1.0.0.tgz
npm run typecheck
npm run lint
npm test -- --coverage   # builds first, then runs the tests
npm run build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md). Documentation: <https://docs.shieldlabs.ai>. Analytics
dashboard: <https://app.shieldlabs.ai>. Support: <contact@shieldlabs.ai>.

## License

[MIT](./LICENSE), Copyright (c) 2026 ShieldLabs Inc.

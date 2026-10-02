# Next.js App Router example

A signup flow with `@shieldlabs-ai/next` in the App Router:

| File | What it does |
|---|---|
| `app/layout.tsx` | Renders `ShieldLabsProvider` with the Public Key from `NEXT_PUBLIC_SHIELDLABS_PUBLIC_KEY` |
| `app/signup/page.tsx` | A client component that gets the agent with `getAgent()` from `useShieldLabs()`, arms the form with `agent.identifyOnInteraction(form)` and sends the `requestId` with the submit |
| `app/signup/actions.ts` | A Server Action that reads the verdict with `getIdentification()`, applies `evaluateIdentification()` and refuses a request ID that was already used |
| `lib/request-ids.ts` | `markRequestIdUsed()`: records a request ID and resolves to `true` only the first time |
| `app/api/shieldlabs/webhook/route.ts` | A route handler made with `createWebhookHandler()`, in the Node.js runtime, that logs every scored identification once |

The first focus, click or key press in the form starts an identification, so it is usually finished
by the time the user submits. The submit handler calls `take()`, which hands over that identification
while it is fresh and has not failed, and otherwise starts a new one, so every submission carries its
own request ID. While a user keeps interacting with the form, a new identification starts at most
every four minutes (the Server Action accepts an identification for five minutes), and after a failure
at most one attempt every five seconds; each one is billable. When the agent could not load at first,
the submit handler calls `identify()` from `useIdentify()`, which loads it again and resolves `null`
when there is still no identification.

The Server Action records the request ID with `markRequestIdUsed()` before it applies the policy, and
passes the answer to `isReplay`. It refuses a missing, reused or stale identification, the rate-limit
marker, missing device signals, browser automation or disabled JavaScript, and the dangerous band (the
defaults of `evaluateIdentification()`, a starting point to tune). The browser only learns whether the
signup went through; the verdict is logged on the server. Used request IDs are kept in memory, which
covers one server process: in production, keep them in a shared store with an expiry, such as Redis or
a column with a unique index.

The webhook route runs in the Node.js runtime, the default, where the handler reads at most
`maxBodySize` bytes of a request. The commented `runtime` line switches it to the Edge runtime: use it
only on a hosting platform that caps request bodies itself, because with `next start` Next.js reads the
whole body of an Edge request before the handler runs. If you add middleware, leave this path out of
its matcher (see [Receive webhooks in a route handler](../../README.md#receive-webhooks-in-a-route-handler)).

## Run it

From this example directory, install the published packages from npm:

```bash
npm install
cp .env.example .env.local   # then fill in the keys of your domain
npm run dev
```

Open <http://localhost:3000/signup>. ShieldLabs records identifications only for registered domains:
on `localhost` the page still gets a request ID, but the identification is rejected, so the Server
Action finds nothing and refuses the signup after 10 seconds. Deploy the example to a registered
development domain (with its own keys) to see verdicts and the identifications in the
[analytics dashboard](https://app.shieldlabs.ai).

To receive webhooks, add `https://<your domain>/api/shieldlabs/webhook` as a webhook endpoint in the
analytics dashboard, put its signing secret in `SHIELDLABS_WEBHOOK_SECRET` and press Verify. The
route answers the `webhook.ping` with 200, and the Test delivery shows up in the server log.

## Build against local copies of the packages

Use the published peer packages and a tarball of this checkout to test changes to the Next.js
integration:

```bash
# repository root
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0' \
  '@shieldlabs-ai/react@^1.0.0' '@shieldlabs-ai/node@^1.0.0'
npm pack
cd examples/app-router
npm install --no-save --no-package-lock ../../shieldlabs-ai-next-1.0.0.tgz
npm run build
```

Adjust the tarball filename if the package version changes. To test a peer change as well, build
and pack it in its own checkout. Replace its package name in the root install command with that
tarball, and include the tarball in the example install too. Never commit a tarball or a `file:`
dependency.

To build with Next.js 14, add `next@14 react@18 react-dom@18 @types/react@18 @types/react-dom@18` to
the last `npm install`. Next.js 14 sets `"jsx": "preserve"` in `tsconfig.json` during the build;
newer versions set `"react-jsx"`.

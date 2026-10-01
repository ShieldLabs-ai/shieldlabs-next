# Test fixtures

Shared test fixtures that every ShieldLabs server SDK passes. The files are identical across the
SDKs; do not edit them by hand. Add cases for this package in separate files or inline in the tests.

| File | Used for |
|---|---|
| `webhook-signature-vectors.json` | 21 signature vectors (`secret` or a `secrets` list), each run through `createWebhookHandler` |
| `webhook-identification-scored.json`, `.raw.txt` | Scored event, pretty and as the compact bytes that are sent |
| `webhook-rate-limited.json` | Scored event carrying the 999 rate-limit marker |
| `webhook-ping.json`, `.raw.txt` | Verify ping, exact bytes |
| `webhook-test-delivery.json` | Test delivery from the analytics dashboard: 17 of the 19 flags, second-precision timestamps |
| `history-page.json`, `history-empty.json` | History API 200 bodies served by the fake `fetch` of the `getIdentification` tests |
| `error-responses.json` | Error bodies per API and status, with the error class the SDK raises |

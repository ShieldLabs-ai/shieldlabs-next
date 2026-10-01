import { createWebhookHandler, riskBand, type DetectionFlags } from '@shieldlabs-ai/next/server';

// This route handler runs in the Node.js runtime, the default. There the handler reads the request
// body as a stream and never more than maxBodySize bytes (1 MiB by default), wherever the app runs.
//
// Verification uses WebCrypto, so the same code also runs in the Edge runtime. Uncomment the next line
// only when your hosting platform caps request bodies itself: with `next start`, Next.js reads the
// whole body of an Edge request into memory before the handler runs.
// export const runtime = 'edge';

// Request IDs this instance has handled. Today each identification is delivered once per endpoint
// (1-second timeout, no retries). A later server release adds retries that resend identical bytes, so
// handlers are idempotent on data.request_id. In production, use a shared store, for example a unique
// key in your database.
const handled = new Set<string>();

// The signing secret comes from SHIELDLABS_WEBHOOK_SECRET. webhook.ping (Verify in the analytics
// dashboard) is answered with 200 by the handler and never reaches onEvent.
export const POST = createWebhookHandler({
  onEvent(event) {
    // An event type this version does not know yet is acknowledged and skipped.
    if (event.event_type !== 'identification.scored') return;

    const { request_id, risk_score, detection_flags } = event.data;
    if (handled.has(request_id)) return;
    if (handled.size >= 10_000) handled.clear();
    handled.add(request_id);

    // Deliveries time out after 1 second: store the verdict or queue the work, and answer.
    const flags = (Object.keys(detection_flags) as (keyof DetectionFlags)[]).filter((flag) => detection_flags[flag]);
    console.info('[shieldlabs webhook]', request_id, risk_score, riskBand(risk_score), flags.join(', ') || 'no flags');
  },
});

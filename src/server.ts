/**
 * @shieldlabs-ai/next/server: server helpers for route handlers, Server Actions, Server Components and
 * Pages Router API routes, in the Node.js runtime and in the Edge runtime.
 *
 * Built on @shieldlabs-ai/node. This entry imports no client code and no node:* module: in the Edge
 * runtime, the bundler resolves the edge build of @shieldlabs-ai/node through its export conditions.
 */
export { getIdentification } from './get-identification';
export type { GetIdentificationOptions } from './get-identification';
export { createWebhookHandler } from './webhook-handler';
export type {
  WebhookErrorContext,
  WebhookHandler,
  WebhookHandlerEvent,
  WebhookHandlerOptions,
} from './webhook-handler';

export {
  ApiError,
  AuthenticationError,
  BadRequestError,
  ConnectionError,
  NIL_UUID,
  NotFoundError,
  QuotaExceededError,
  RISK_BANDS,
  RateLimitError,
  SIGNALS,
  ServerError,
  ShieldLabs,
  ShieldLabsError,
  SignatureVerificationError,
  TimeoutError,
  ValidationError,
  WebhookParseError,
  evaluateIdentification,
  isRateLimited,
  riskBand,
  // Only the async User HID helper: the synchronous `userHid` needs node:crypto, which the Edge
  // runtime does not have.
  userHidAsync,
} from '@shieldlabs-ai/node';
export type {
  ConnectionType,
  DetectionFlags,
  EvaluateOptions,
  Evaluation,
  EvaluationReason,
  Identification,
  IdentificationScoredEvent,
  IdentificationSignal,
  IpInfo,
  KnownSignal,
  RiskBand,
  ShieldLabsOptions,
  TrafficSource,
  UnknownEventType,
  UnknownWebhookEvent,
  WebhookEvent,
  WebhookPingEvent,
  WebhookSecret,
} from '@shieldlabs-ai/node';

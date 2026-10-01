/**
 * @shieldlabs-ai/next: the client entry.
 *
 * The React provider and hooks of @shieldlabs-ai/react as a client module (the built files start with
 * "use client"), so the root layout of the App Router, a Server Component, can render
 * `<ShieldLabsProvider>`. Server helpers live in `@shieldlabs-ai/next/server`.
 *
 * Named re-exports only: Next.js does not allow `export *` in a client module.
 */
export { ShieldLabsProvider, useIdentify, useShieldLabs } from '@shieldlabs-ai/react';
export type {
  ShieldLabsProviderProps,
  ShieldLabsStatus,
  UseIdentifyOptions,
  UseIdentifyResult,
  UseShieldLabsResult,
} from '@shieldlabs-ai/react';
export { ShieldLabsError } from '@shieldlabs-ai/js';
export type {
  IdentifyOptions,
  IdentifyResult,
  InteractionIdentifier,
  LoadOptions,
  ShieldLabsAgent,
  ShieldLabsErrorCode,
} from '@shieldlabs-ai/js';

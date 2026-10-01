// Compile-time checks: `npm run typecheck` fails when a public type changes shape.
import { describe, expectTypeOf, it } from 'vitest';
import type {
  IdentifyOptions,
  IdentifyResult,
  InteractionIdentifier,
  ShieldLabsAgent,
  ShieldLabsProviderProps,
  UseIdentifyResult,
  UseShieldLabsResult,
} from '../src/index';
import {
  createWebhookHandler,
  getIdentification,
  riskBand,
  type Evaluation,
  type GetIdentificationOptions,
  type Identification,
  type ShieldLabs,
  type WebhookHandler,
  type WebhookHandlerEvent,
  type WebhookHandlerOptions,
  type WebhookPingEvent,
  evaluateIdentification,
  userHidAsync,
} from '../src/server';

/** The shape Next.js calls a route handler with: the request and a context with the params. */
type RouteHandler = (request: Request, context: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

describe('public types', () => {
  it('createWebhookHandler returns a route handler', () => {
    const handler = createWebhookHandler({ onEvent: () => undefined });
    expectTypeOf(handler).toEqualTypeOf<WebhookHandler>();
    expectTypeOf(handler).toEqualTypeOf<(request: Request) => Promise<Response>>();
    expectTypeOf(handler).toExtend<RouteHandler>();
  });

  it('onEvent receives every event except webhook.ping, and may be sync or async', () => {
    expectTypeOf<WebhookPingEvent>().not.toExtend<WebhookHandlerEvent>();
    createWebhookHandler({
      secret: ['whsec_new', 'whsec_old'],
      onEvent: (event) => {
        expectTypeOf(event).toEqualTypeOf<WebhookHandlerEvent>();
        if (event.event_type === 'identification.scored') {
          expectTypeOf(event.data).toEqualTypeOf<Identification>();
        }
      },
      onError: (error, context) => {
        expectTypeOf(error).toBeUnknown();
        expectTypeOf(context.status).toEqualTypeOf<400 | 401 | 413 | 500>();
        expectTypeOf(context.request).toEqualTypeOf<Request>();
      },
    });
    createWebhookHandler({ onEvent: async () => Promise.resolve() });
    createWebhookHandler({ onEvent: () => 42, maxBodySize: 64 * 1024 });
    expectTypeOf<WebhookHandlerOptions>().toHaveProperty('maxBodySize').toEqualTypeOf<number | undefined>();
  });

  it('getIdentification resolves an Identification or null', () => {
    expectTypeOf(getIdentification).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(getIdentification).returns.toEqualTypeOf<Promise<Identification | null>>();
    expectTypeOf<GetIdentificationOptions>().toHaveProperty('client').toEqualTypeOf<ShieldLabs | undefined>();
    expectTypeOf<GetIdentificationOptions>().toHaveProperty('wait').toEqualTypeOf<boolean | undefined>();
    expectTypeOf<GetIdentificationOptions>().toHaveProperty('timeout').toEqualTypeOf<number | undefined>();
  });

  it('re-exports the risk helpers and the async User HID helper of @shieldlabs-ai/node', () => {
    expectTypeOf(userHidAsync).parameters.toEqualTypeOf<[userId: string, secret: string]>();
    expectTypeOf(userHidAsync).returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf(evaluateIdentification).returns.toEqualTypeOf<Evaluation>();
    expectTypeOf(riskBand).returns.toEqualTypeOf<'trusted' | 'suspicious' | 'dangerous' | 'rate_limited'>();
  });

  it('re-exports the React types', () => {
    expectTypeOf<ShieldLabsProviderProps>().toHaveProperty('publicKey').toEqualTypeOf<string>();
    expectTypeOf<IdentifyResult>().toEqualTypeOf<{ requestId: string; userId: string | null }>();
  });

  it('the provider takes autoLoad for deferred loading', () => {
    expectTypeOf<ShieldLabsProviderProps>().toHaveProperty('autoLoad').toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ShieldLabsProviderProps>()
      .toHaveProperty('checkOnLoad')
      .toEqualTypeOf<boolean | { userId?: string } | undefined>();
  });

  it('useIdentify().identify() resolves the result or null and never rejects', () => {
    expectTypeOf<UseIdentifyResult['identify']>().parameters.toEqualTypeOf<[options?: IdentifyOptions]>();
    expectTypeOf<UseIdentifyResult['identify']>().returns.toEqualTypeOf<Promise<IdentifyResult | null>>();
  });

  it('useShieldLabs() adds load() and getAgent() to the calls of the agent', () => {
    expectTypeOf<UseShieldLabsResult['identify']>().returns.toEqualTypeOf<Promise<IdentifyResult>>();
    expectTypeOf<UseShieldLabsResult['check']>().returns.toEqualTypeOf<Promise<IdentifyResult | null>>();
    expectTypeOf<UseShieldLabsResult['load']>().toEqualTypeOf<() => void>();
    expectTypeOf<UseShieldLabsResult['getAgent']>().toEqualTypeOf<() => Promise<ShieldLabsAgent>>();
  });

  it('the agent from getAgent() starts identifications on interaction', () => {
    expectTypeOf<ShieldLabsAgent['identifyOnInteraction']>()
      .parameters.toEqualTypeOf<[target: EventTarget, options?: IdentifyOptions]>();
    expectTypeOf<ShieldLabsAgent['identifyOnInteraction']>().returns.toEqualTypeOf<InteractionIdentifier>();
    expectTypeOf<InteractionIdentifier['take']>().returns.toEqualTypeOf<Promise<IdentifyResult>>();
    expectTypeOf<InteractionIdentifier['dispose']>().returns.toBeVoid();
  });
});

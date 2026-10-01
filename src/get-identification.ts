import {
  ShieldLabs,
  ValidationError,
  type FetchLike,
  type GetIdentificationOptions as ClientGetIdentificationOptions,
  type Identification,
} from '@shieldlabs-ai/node';
import { envApiBaseUrl, envApiKey } from './env';
import { errorMessage } from './internal';

/**
 * Options of {@link getIdentification}: the options of `identifications.get` in @shieldlabs-ai/node
 * (`wait`, `timeout`, `pollInterval`, `signal`) plus `client`.
 */
export interface GetIdentificationOptions extends ClientGetIdentificationOptions {
  /**
   * The History API client to use. Default: one client per process, created on first use from
   * `SHIELDLABS_API_KEY` and, when set, `SHIELDLABS_API_BASE_URL`.
   */
  client?: ShieldLabs | undefined;
}

const MISSING_API_KEY =
  'SHIELDLABS_API_KEY is not set. Add the Private API Key of your domain (sec_...) to the server ' +
  'environment, for example in .env.local, or pass { client: new ShieldLabs({ apiKey }) }. Never give ' +
  'it a NEXT_PUBLIC_ prefix: Next.js adds those variables to the JavaScript sent to the browser.';

/**
 * The global fetch with `cache: 'no-store'`. The Next.js Data Cache must never keep a History API
 * response: polling would read the same "not scored yet" answer again and again.
 */
const noStoreFetch: FetchLike = (url, init) => fetch(url, { ...init, cache: 'no-store' });

interface DefaultClient {
  apiKey: string;
  baseUrl: string | undefined;
  client: ShieldLabs;
}

let defaultClient: DefaultClient | undefined;

/** The client built from the environment, created again only when the variables change. */
function clientFromEnvironment(): ShieldLabs {
  const apiKey = envApiKey();
  if (apiKey === undefined) throw new ValidationError(MISSING_API_KEY);
  const baseUrl = envApiBaseUrl();
  if (defaultClient?.apiKey !== apiKey || defaultClient.baseUrl !== baseUrl) {
    let client: ShieldLabs;
    try {
      client = new ShieldLabs({ apiKey, baseUrl, fetch: noStoreFetch });
    } catch (error) {
      throw new ValidationError(
        'Could not create the ShieldLabs client from SHIELDLABS_API_KEY and SHIELDLABS_API_BASE_URL: ' +
          errorMessage(error),
        { cause: error },
      );
    }
    defaultClient = { apiKey, baseUrl, client };
  }
  return defaultClient.client;
}

function checkedClient(client: unknown): ShieldLabs {
  const candidate = client as { identifications?: { get?: unknown } } | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.identifications?.get !== 'function'
  ) {
    throw new ValidationError('client must be a ShieldLabs client from @shieldlabs-ai/node.');
  }
  return client as ShieldLabs;
}

/**
 * The identification with this request ID, read from the History API, or `null` when none is found.
 * Same as `identifications.get()` of @shieldlabs-ai/node: with `wait` (the default) it polls with
 * backoff within a total budget of `timeout` (default 10 000 ms), because the History row appears
 * about 1 to 3 seconds after the browser call. The row can be refined for up to about 10 seconds
 * while follow-up checks finish; the first version found is returned.
 *
 * Without `client`, it uses a client created from `SHIELDLABS_API_KEY` (and
 * `SHIELDLABS_API_BASE_URL` when set), and rejects with a `ValidationError` when the key is missing.
 * That client sends its requests with `cache: 'no-store'`.
 */
export async function getIdentification(
  requestId: string,
  options: GetIdentificationOptions = {},
): Promise<Identification | null> {
  const raw: unknown = options;
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('getIdentification() options must be an object.');
  }
  const { client, ...getOptions } = options;
  const shieldlabs = client === undefined ? clientFromEnvironment() : checkedClient(client);
  return shieldlabs.identifications.get(requestId, getOptions);
}

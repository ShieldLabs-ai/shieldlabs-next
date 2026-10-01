// Environment variables of the server entry.
//
// Every variable is read with a literal `process.env.NAME` expression, never with a computed key, so
// tools that analyze or replace `process.env` references in a bundle (for example for the Edge
// runtime) see each name. Declared locally so that the package needs no Node.js types.
//
// The `typeof process` checks stay: where no `process` global exists, `process?.env` would throw a
// ReferenceError, so the optional chain the linter suggests is not equivalent.
/* eslint-disable @typescript-eslint/prefer-optional-chain */
declare const process: { env?: Record<string, string | undefined> } | undefined;

function clean(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `SHIELDLABS_API_KEY`: the Private API Key (`sec_...`), trimmed, or undefined when unset or blank. */
export function envApiKey(): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  return clean(process.env.SHIELDLABS_API_KEY);
}

/** `SHIELDLABS_API_BASE_URL`: an override of the History API origin, or undefined when unset or blank. */
export function envApiBaseUrl(): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  return clean(process.env.SHIELDLABS_API_BASE_URL);
}

/**
 * `SHIELDLABS_WEBHOOK_SECRET`: one endpoint signing secret, or several separated by commas while you
 * rotate secrets. Each entry is trimmed and empty entries are dropped.
 */
export function envWebhookSecrets(): string[] {
  if (typeof process === 'undefined' || !process.env) return [];
  return splitSecrets(process.env.SHIELDLABS_WEBHOOK_SECRET);
}

/** The non-empty, trimmed entries of a comma-separated list. */
export function splitSecrets(value: string | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

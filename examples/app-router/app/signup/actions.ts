'use server';

import { evaluateIdentification, getIdentification, type Evaluation, type Identification } from '@shieldlabs-ai/next/server';
import { markRequestIdUsed } from '@/lib/request-ids';

export interface SignupState {
  ok: boolean;
  message: string;
}

/** Freshness window: an identification authorizes a signup attempt for 5 minutes. */
const MAX_AGE_MS = 5 * 60 * 1000;

const TRY_AGAIN: SignupState = { ok: false, message: 'We could not verify this signup. Please submit the form again.' };
const UNAVAILABLE: SignupState = { ok: false, message: 'We could not verify this signup right now. Please try again later.' };
const RATE_LIMITED: SignupState = { ok: false, message: 'Too many attempts from your network. Please try again in a few minutes.' };
const REFUSED: SignupState = { ok: false, message: 'We could not create your account.' };

/** What the browser learns about a refusal: never the Risk Score, the band or the flag. */
function refusal(verdict: Evaluation): SignupState {
  switch (verdict.reason) {
    case 'missing':
    case 'replayed':
    case 'stale':
      // The next submission starts a new identification.
      return TRY_AGAIN;
    case 'rate_limited':
      return RATE_LIMITED;
    default:
      return REFUSED;
  }
}

export async function signup(formData: FormData): Promise<SignupState> {
  const email = formData.get('email');
  const requestId = formData.get('requestId');
  if (typeof email !== 'string' || email.trim() === '') {
    return { ok: false, message: 'Enter an email address.' };
  }
  // No request ID (for example, a content blocker stopped the agent): unverified, never clean.
  if (typeof requestId !== 'string' || requestId === '') {
    console.info('[signup] refused: the form carried no request ID');
    return TRY_AGAIN;
  }

  let identification: Identification | null;
  try {
    // Waits with backoff, for up to 10 seconds, until the identification is stored and scored.
    identification = await getIdentification(requestId);
  } catch (error) {
    // A malformed request ID, a missing SHIELDLABS_API_KEY or a network error. This example refuses
    // the signup when it cannot read the verdict.
    console.error('[signup] could not read the identification:', error);
    return UNAVAILABLE;
  }

  // One identification, one attempt: record the request ID before the checks, so any later submission
  // with it is refused as replayed. The store answers asynchronously and isReplay needs a boolean at
  // once, so await the store first and pass its answer.
  const firstUse = identification !== null && (await markRequestIdUsed(identification.request_id));

  // Refuses a missing, reused or stale identification, the rate-limit marker, missing device signals,
  // browser automation or disabled JavaScript, and the dangerous band. Tune the options per action.
  const verdict = evaluateIdentification(identification, { maxAge: MAX_AGE_MS, isReplay: () => !firstUse });
  console.info('[signup]', { requestId, risk_score: identification?.risk_score ?? null, ...verdict });
  if (!verdict.ok) return refusal(verdict);

  // Create the account here.
  return { ok: true, message: 'Account created.' };
}

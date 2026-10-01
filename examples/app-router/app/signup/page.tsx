'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  ShieldLabsError,
  useIdentify,
  useShieldLabs,
  type IdentifyResult,
  type InteractionIdentifier,
} from '@shieldlabs-ai/next';
import { signup, type SignupState } from './actions';

export default function SignupPage() {
  const { status, error: loadError, getAgent } = useShieldLabs();
  const { identify } = useIdentify();
  const formRef = useRef<HTMLFormElement>(null);
  const early = useRef<InteractionIdentifier | null>(null);
  const [state, setState] = useState<SignupState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Once the agent has loaded, identifyOnInteraction() starts an identification on the first focus,
  // click or key press in the form. ShieldLabs usually stores its verdict 1 to 3 seconds later, well
  // before the user submits.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let active = true;
    getAgent().then(
      (agent) => {
        if (active) early.current = agent.identifyOnInteraction(form);
      },
      () => {
        // The agent could not load (the status line shows why). The submit handler tries again.
      },
    );
    return () => {
      active = false;
      early.current?.dispose();
      early.current = null;
    };
  }, [getAgent]);

  // One identification per submission. take() hands over the early one while it is fresh (not failed,
  // and finished less than 4 minutes ago) and otherwise starts a new one. When the agent could not load
  // at first, identify() loads it again; it resolves null instead of rejecting.
  async function identifySubmission(): Promise<IdentifyResult | null> {
    if (early.current === null) return identify();
    try {
      return await early.current.take();
    } catch (error) {
      if (error instanceof ShieldLabsError) console.warn(`ShieldLabs ${error.code}: ${error.message}`);
      return null;
    }
  }

  async function submit(form: HTMLFormElement): Promise<void> {
    const formData = new FormData(form);
    setSubmitting(true);
    try {
      const result = await identifySubmission();
      // No identification: send the signup anyway. The server treats it as unverified.
      if (result !== null) formData.set('requestId', result.requestId);
      // The page stays open while the Server Action runs, so the agent can finish sending.
      setState(await signup(formData));
    } catch {
      setState({ ok: false, message: 'The signup request failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <main>
      <h1>Create an account</h1>
      <form ref={formRef} onSubmit={onSubmit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" required />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing up' : 'Sign up'}
        </button>
      </form>
      {state !== null && <p role="status">{state.message}</p>}
      <p className="status">
        Agent: {status}
        {loadError !== null ? ` (${loadError.code}: ${loadError.message})` : ''}
      </p>
    </main>
  );
}

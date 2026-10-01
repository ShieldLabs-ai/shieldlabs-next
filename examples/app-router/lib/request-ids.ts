// Used request IDs: one identification authorizes one attempt.
//
// This Map lives in one server process. In production, keep the IDs in a store that every instance
// shares, for example a Redis key set with `SET <request id> 1 NX EX 600` (the first use gets OK) or
// an insert into a column with a unique index (a repeat fails with a unique violation).
const used = new Map<string, number>();

/** Twice the 5-minute freshness window: after that, the identification is refused as stale anyway. */
const REMEMBER_MS = 10 * 60 * 1000;

/**
 * Records a request ID. Resolves to true the first time the ID is seen, and to false for every
 * repeat. Asynchronous like a call to a shared store.
 */
export async function markRequestIdUsed(requestId: string): Promise<boolean> {
  const now = Date.now();
  for (const [id, forgetAt] of used) {
    if (forgetAt <= now) used.delete(id);
  }
  if (used.has(requestId)) return false;
  used.set(requestId, now + REMEMBER_MS);
  return true;
}

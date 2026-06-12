/**
 * #19/L-2 — the PURE decision logic of the barge-in stash-and-replay, extracted from voice-session.ts so it is
 * deterministically unit-testable WITHOUT a live WS / STT / mic (the stash-and-replay WIRING stays in
 * voice-session and is e2e-voice-verified; THIS is the part a test can actually pin down). Dependency-free on
 * purpose so `npm run eval:followons` can import it under plain `tsx` with no DB/key.
 *
 * A barge-in transcript that arrived while a turn was in flight is stashed with the wall-clock time it landed.
 * When the in-flight turn settles we replay it — UNLESS it's gone stale (the in-flight turn ran pathologically
 * long and the buyer has effectively moved on), which the TTL guards against.
 */
export const BARGEIN_TTL_MS = 8000;

export type BargeinStash = { text: string; at: number } | null;

/** True iff a stashed barge-in is still fresh enough to replay. Behavior-identical to the inline guard it
 *  replaces (`stash && now - stash.at < ttlMs`). */
export function shouldReplayPendingBargein(stash: BargeinStash, now: number, ttlMs: number = BARGEIN_TTL_MS): boolean {
  return !!(stash && now - stash.at < ttlMs);
}

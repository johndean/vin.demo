/**
 * AI-CONSULTANT RUNTIME — P0: the continuous-speech seam (docs/DEMO_CONSULTANT_RUNTIME.md).
 *
 * This is the SEAM the runtime hangs off. In P0 it is PURE, dependency-free decision logic — NOT wired into the
 * live voice path yet (so P0 is genuine zero behavior change; nothing in the running engine imports this until P1).
 * It consolidates the barge-in / utterance-coherence / completion logic that today is scattered across
 * voice-session.ts (utterance counter, interrupted flag, pendingBargein stash, the streamedThisTurn boolean) into
 * ONE testable object, and adds the COMPLETION MARKER the per-turn boolean cannot represent. P1 moves the
 * per-session TTS chain into here and flips it on behind the SPEECH_DRIVER flag.
 *
 * Deliberately has NO imports (no DB/LLM/TTS/WS/DOM) so `npm run eval:phase25` can unit-test it under plain tsx.
 */

/** A spoken beat's completion — the thing a boolean (streamedThisTurn) cannot express. PARTIAL/FAILED are the
 *  states P1's completeOrRepairStreaming() acts on so the buyer never hears half a sentence into silence. */
export enum CompletionStatus {
  Pending = 'pending',   // streaming in progress / not yet resolved
  Complete = 'complete', // the model finished the thought cleanly
  Partial = 'partial',   // cut off mid-thought (e.g. max_tokens) — repairable
  Failed = 'failed',     // refused / errored / no usable output — repairable or degrade
}

/** Map a provider stop/finish reason to a CompletionStatus. Handles BOTH Claude (`end_turn`, `max_tokens`,
 *  `refusal`, `stop_sequence`) and Gemini (`STOP`, `MAX_TOKENS`, `SAFETY`, …) — lowercased so the same table
 *  serves both providers (provider parity). A missing reason is treated as Failed (repairable), never Complete. */
export function completionFromStopReason(stopReason: string | null | undefined): CompletionStatus {
  const s = (stopReason ?? '').toLowerCase();
  if (!s) return CompletionStatus.Failed;
  if (s === 'end_turn' || s === 'stop' || s === 'stop_sequence') return CompletionStatus.Complete;
  if (s === 'max_tokens' || s === 'length' || s === 'max_output_tokens') return CompletionStatus.Partial;
  if (s === 'refusal' || s === 'safety' || s === 'recitation' || s === 'prohibited_content' || s === 'blocklist' || s === 'spii') return CompletionStatus.Failed;
  // Gemini's OTHER / FINISH_REASON_UNSPECIFIED (and a bare malformed finish) are SUSPECT stops, not clean ones →
  // treat as Failed so the P1 repair path handles them rather than asserting a possibly-truncated line as complete.
  if (s === 'other' || s === 'finish_reason_unspecified' || s === 'malformed_function_call') return CompletionStatus.Failed;
  return CompletionStatus.Complete; // a genuinely unknown-but-named finish → treat as a clean stop
}

/** Is the runtime continuous-speech driver enabled? Engine env flag, OFF by default (mirrors ELEVENLABS_WS):
 *  with it OFF the live voice path runs EXACTLY as today. P1 reads this to flip the driver on. */
export function speechDriverEnabled(): boolean {
  const f = process.env.SPEECH_DRIVER;
  return !!(f && f !== '0' && f.toLowerCase() !== 'false');
}

export const BARGEIN_TTL_MS = 8000;

/**
 * The session-scoped speech coherence core. P0 owns ONLY the pure decision logic:
 *  - utterance coherence: a monotonic id; a barge-in bumps it; output stamped with a stale id is dropped (this is
 *    the consolidated RC-11 guard, today scattered as voice-session.ts `utterance`/`interrupted`).
 *  - the barge-in stash: a question that lands while a beat is in flight is stashed and replayed when it settles
 *    (the consolidated L-2 logic, today voice-session.ts `pendingBargein` + `replayPendingBargein`).
 *  - the active beat's CompletionStatus (so a partial/failed stream is recoverable, not a silent half-sentence).
 * P1 attaches the per-session TTS chain + completeOrRepairStreaming + auto-advance ownership to this object.
 */
export class SpeechDriver {
  private utterance = 0;
  private pending: { text: string; at: number } | null = null;
  private status: CompletionStatus = CompletionStatus.Complete;

  /** A barge-in supersedes whatever is speaking — bump the utterance id and return the new value. */
  barge(): number { return ++this.utterance; }

  /** The current utterance id; callers stamp their output with this when a beat starts. */
  get current(): number { return this.utterance; }

  /** True iff `id` is still the live utterance — stale output from a superseded turn must be dropped. */
  isCurrent(id: number): boolean { return id === this.utterance; }

  /** Begin a beat: reset its completion marker to Pending and return its utterance stamp. */
  startBeat(): number { this.status = CompletionStatus.Pending; return this.utterance; }

  /** Record how a beat finished (from completionFromStopReason). Returns the status for the caller to act on. */
  completeBeat(status: CompletionStatus): CompletionStatus { this.status = status; return status; }

  /** The active beat's completion marker. P1 uses Partial/Failed to fire the repair. */
  get beatStatus(): CompletionStatus { return this.status; }

  /** Stash a barge-in transcript to replay once the in-flight beat settles (no-op on empty text). */
  stash(text: string, at: number): void { if (text) this.pending = { text, at }; }

  /** Is there a fresh (within TTL) stashed barge-in awaiting replay? */
  hasPending(now: number, ttlMs: number = BARGEIN_TTL_MS): boolean { return !!(this.pending && now - this.pending.at < ttlMs); }

  /** Take (and clear) the stashed barge-in if still fresh; clears + returns null otherwise (never double-fires). */
  takePending(now: number, ttlMs: number = BARGEIN_TTL_MS): string | null {
    const p = this.pending; this.pending = null;
    return p && now - p.at < ttlMs ? p.text : null;
  }
}

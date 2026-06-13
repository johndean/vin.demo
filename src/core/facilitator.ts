/**
 * AI-CONSULTANT RUNTIME — P3: the FACILITATOR state machine (docs/DEMO_CONSULTANT_RUNTIME.md).
 *
 * Today the "walk" is a position-indexed caption playlist (journeys.ts journeyWalkPlan assigns arcRole by INDEX;
 * graph.ts navigateJourneyStep narrates the pre-assembled caption; discover() is skipped on walk turns; committee
 * objections speak only off-script). This replaces that with an EXECUTABLE facilitation state machine:
 *   OPEN → DISCOVER → SHOW → (OBJECTION ⇄ resume) → PROOF → CLOSE
 * driven by buyer interjections, not bare index — so the consultant ASKS, LISTENS, answers an objection AS the
 * committee role, and re-prioritizes WHICH grounded proof to show next.
 *
 * This module is PURE + dependency-free (no DB/LLM/graph) — a transition function over the assembler's beats +
 * the buyer's signals. CRITICAL INVARIANT (zero-gap, never fabricate): the facilitator only ORDERS/SELECTS among
 * the beats the assembler already produced from REAL, trust-gated assets — it never invents a beat, and an
 * OBJECTION/PROOF beat it surfaces MUST be `grounded`. If no grounded beat answers a raised concern, it says so
 * (mustGround) rather than make something up. P3 wires graph.ts to consult this behind the FACILITATOR flag.
 * Deterministically unit-tested by eval:phase26 (no DB/key/audio).
 */

export type FacilitationPhase = 'open' | 'discover' | 'show' | 'objection' | 'proof' | 'close';

/** An assembler beat the facilitator may select — the WalkEntry augmented with its facilitation role + the
 *  committee concern/criterion it answers (branchKey), + whether it has a validated source (trust gate). */
export interface FacilitationBeat {
  index: number;
  phase: FacilitationPhase;
  branchKey?: string | null;  // the concern this beat answers (used to re-prioritize on an objection/signal)
  grounded: boolean;          // has a trust-gated source — an objection/proof beat MUST be grounded to be surfaced
}

export interface FacilitatorState {
  phase: FacilitationPhase;
  stepIndex: number;               // current beat (mirrors the graph-owned journeyStep — RC-02)
  resumeIndex: number | null;      // where to return after an objection interjection settles
  openConcerns: string[];          // committee/buyer concerns raised but not yet answered (re-rank inputs)
  buyerSignals: string[];          // signals captured in DISCOVER (bias future proof selection)
  done: boolean;
}

/** A facilitator step's outcome: the next state + which beat to surface (or null) + an honesty flag. */
export interface FacilitatorStep {
  state: FacilitatorState;
  beatIndex: number | null;        // the beat to drive/narrate next (null = no beat, e.g. a pure OPEN/DISCOVER prompt)
  mustGround: boolean;             // true when a concern was raised but NO grounded beat answers it → answer must be
                                   // trust-gated/declined, NEVER fabricated (the zero-gap guarantee at runtime)
}

export function initialFacilitatorState(): FacilitatorState {
  return { phase: 'open', stepIndex: 0, resumeIndex: null, openConcerns: [], buyerSignals: [], done: false };
}

/** Case-insensitive token overlap (≥2 shared significant words) — the SAME grounding test the assembler uses to
 *  bind a proof to an objection. A concern only "matches" a beat's branchKey when the words genuinely echo. */
function answers(branchKey: string | null | undefined, concern: string): boolean {
  if (!branchKey) return false;
  const sig = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const a = sig(branchKey), b = sig(concern);
  let n = 0; for (const w of b) if (a.has(w)) n++;
  return n >= 2;
}

/** Pick the next beat to surface: prefer the next UNVISITED, GROUNDED beat whose branchKey answers an OPEN concern
 *  (re-rank toward what the buyer cares about); otherwise the next sequential beat. NEVER returns an out-of-range
 *  index, and never selects an ungrounded beat to answer a concern (the zero-gap invariant). */
function selectNext(beats: FacilitationBeat[], state: FacilitatorState): number | null {
  if (!beats.length) return null;
  if (state.openConcerns.length) {
    const hit = beats.find((b) => b.index > state.stepIndex && b.grounded && state.openConcerns.some((c) => answers(b.branchKey, c)));
    if (hit) return hit.index;
  }
  const next = beats.find((b) => b.index > state.stepIndex);
  return next ? next.index : null; // null → past the end
}

/**
 * The pure transition. Returns the next state + the beat to surface. Events:
 *  - advance: operator/auto Next → move to the next (possibly re-ranked) beat; past the end → CLOSE.
 *  - objection{concern}: the buyer pushed back → interject; surface a GROUNDED beat that answers it (mustGround if
 *    none exists), remembering where to resume. Does NOT consume the walk's forward position (resumeIndex holds it).
 *  - signal{signal}: DISCOVER captured a buyer signal → record it (biases future selection); no phase change.
 *  - resume: an objection was answered → return to the held position/phase.
 */
export function transition(state: FacilitatorState, beats: FacilitationBeat[], event:
  | { kind: 'advance' }
  | { kind: 'objection'; concern: string }
  | { kind: 'signal'; signal: string }
  | { kind: 'resume' },
): FacilitatorStep {
  switch (event.kind) {
    case 'signal': {
      const s = event.signal.trim();
      const buyerSignals = s && !state.buyerSignals.includes(s) ? [...state.buyerSignals, s] : state.buyerSignals;
      return { state: { ...state, buyerSignals }, beatIndex: state.stepIndex, mustGround: false };
    }
    case 'objection': {
      const concern = event.concern.trim();
      const openConcerns = concern && !state.openConcerns.includes(concern) ? [...state.openConcerns, concern] : state.openConcerns;
      // find a GROUNDED beat that answers THIS concern (never an ungrounded one — zero-gap)
      const hit = beats.find((b) => b.grounded && answers(b.branchKey, concern));
      const resumeIndex = state.resumeIndex ?? state.stepIndex; // hold the forward position across the interjection
      if (hit) return { state: { ...state, phase: 'objection', openConcerns, resumeIndex, stepIndex: hit.index }, beatIndex: hit.index, mustGround: false };
      // no grounded beat answers it → answer AS the role but trust-gated/declined; the walk position is untouched.
      return { state: { ...state, phase: 'objection', openConcerns, resumeIndex }, beatIndex: null, mustGround: true };
    }
    case 'resume': {
      const back = state.resumeIndex;
      if (back == null) return { state, beatIndex: state.stepIndex, mustGround: false };
      const phase = beats.find((b) => b.index === back)?.phase ?? 'show';
      return { state: { ...state, phase, stepIndex: back, resumeIndex: null }, beatIndex: back, mustGround: false };
    }
    case 'advance':
    default: {
      const next = selectNext(beats, state);
      if (next == null) return { state: { ...state, phase: 'close', done: true }, beatIndex: null, mustGround: false };
      const phase = beats.find((b) => b.index === next)?.phase ?? 'show';
      // answering a concern by advancing onto its proof clears it from the open set
      const cleared = beats.find((b) => b.index === next)?.branchKey;
      const openConcerns = cleared ? state.openConcerns.filter((c) => !answers(cleared, c)) : state.openConcerns;
      return { state: { ...state, phase, stepIndex: next, openConcerns }, beatIndex: next, mustGround: false };
    }
  }
}

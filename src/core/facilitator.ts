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
  navigable?: boolean;        // is a real SCREEN we can drive to (a 'node' beat) — P4 routes a buyer to a navigable
                              // proof; a grounded KNOWLEDGE beat answers but has no screen, so it is not navigable
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

/** Is the facilitator wired into the live walk? Engine env flag, OFF by default (mirrors speechDriverEnabled /
 *  ELEVENLABS_WS): with it OFF, graph.ts runs the unchanged index walk — byte-identical to today. P3 reads this. */
export function facilitatorEnabled(): boolean {
  const f = process.env.FACILITATOR;
  return !!(f && f !== '0' && f.toLowerCase() !== 'false');
}

/** Adapt the EXISTING walk plan (journeys.ts WalkEntry[]) into the facilitator's input WITHOUT changing the plan
 *  itself — additive + pure. Maps the positional arcRole to a facilitation phase, derives `grounded` (a verified
 *  SCREEN node, or a knowledge beat with resolved sourceText — the things the trust gate stands behind), and uses
 *  the caption as the branchKey (its objection/criterion keywords are what the re-rank/objection overlap matches).
 *  Typed structurally (not importing WalkEntry) so facilitator.ts stays dependency-free + node-unit-testable. */
export function toFacilitationBeats(plan: { arcRole: 'open' | 'show' | 'transit' | 'close'; kind: 'node' | 'beat'; stepKind: string; sourceText?: string | null; caption: string | null }[]): FacilitationBeat[] {
  return plan.map((e, index) => {
    const phase: FacilitationPhase = e.arcRole === 'open' ? 'open'
      : e.arcRole === 'close' ? 'close'
      : (e.kind === 'beat' && e.stepKind === 'knowledge' && !!e.sourceText) ? 'proof' // a grounded knowledge beat IS proof
      : 'show';
    const grounded = e.kind === 'node' || !!e.sourceText; // a verified screen, or a resolved (trust-gated) chunk
    return { index, phase, branchKey: e.caption ?? null, grounded, navigable: e.kind === 'node' };
  });
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

/** The index of the GROUNDED beat that answers a concern (≥2-token overlap on its branchKey), or null. The single
 *  zero-gap selector both the 'objection' transition and the P4 off-script interjection share — it NEVER returns an
 *  ungrounded beat, so any proof shown to answer a concern is always trust-gated. */
function groundedProofIndex(beats: FacilitationBeat[], concern: string): number | null {
  const hit = beats.find((b) => b.grounded && answers(b.branchKey, concern));
  return hit ? hit.index : null;
}

/** P4 (live discovery router / off-script interjection): the grounded proof beat that answers a buyer's concern, as
 *  a PURE READ — it does NOT mutate the walk phase/position (an off-script objection is answered IN PLACE; the walk
 *  cursor is untouched, so it consumes no journey step). mustGround is true when NO grounded proof answers the
 *  concern → the caller degrades honestly (free-roam / "I'm not certain"), NEVER fabricates.
 *  `navigableOnly` (graph.ts proofNodeFor) restricts the match to a real SCREEN ('node') proof — so a grounded
 *  KNOWLEDGE beat at an earlier index does NOT shadow a navigable node proof for the same concern (the demo can
 *  actually SHOW the screen). graph.ts maps a non-null beatIndex → the WalkEntry's nodeLabel to navigate there. */
export function selectProof(beats: FacilitationBeat[], concern: string, opts?: { navigableOnly?: boolean }): { beatIndex: number | null; mustGround: boolean } {
  const c = (concern ?? '').trim();
  const hit = beats.find((b) => b.grounded && (!opts?.navigableOnly || b.navigable === true) && answers(b.branchKey, c));
  return { beatIndex: hit ? hit.index : null, mustGround: !hit };
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
 *
 * WIRING STATUS: the live graph (P3-WIRE) drives this through ONLY `advance` (via advanceWalk, which holds concerns
 * aside → a SEQUENTIAL walk) + the lightweight noteConcern capture. The `objection`/`signal`/`resume` events and the
 * `mustGround` flag + `resumeIndex` interject-and-return machinery are the P4 surface — the discovery router will use
 * them to re-prioritize the next grounded proof WITHOUT collapsing the linear walk. Until then they live here +
 * eval:phase26 only (built ahead, deliberately not yet on the live path).
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
      // find a GROUNDED beat that answers THIS concern (never an ungrounded one — zero-gap; shared selector)
      const hitIdx = groundedProofIndex(beats, concern);
      const resumeIndex = state.resumeIndex ?? state.stepIndex; // hold the forward position across the interjection
      if (hitIdx != null) return { state: { ...state, phase: 'objection', openConcerns, resumeIndex, stepIndex: hitIdx }, beatIndex: hitIdx, mustGround: false };
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
      // Reset done:false on a successful advance — done is only ever set true at completion, so resetting it here
      // keeps the persisted channel internally consistent if the walk is rewound (operator restarts / journeyStep→0).
      return { state: { ...state, phase, stepIndex: next, openConcerns, done: false }, beatIndex: next, mustGround: false };
    }
  }
}

// ── P3 WIRE helpers (graph.ts ↔ facilitator). Pure; keep the graph thin + the seam math deterministically
// testable (eval:phase26). The graph owns `journeyStep` (the NEXT beat to surface — RC-02); the facilitator's
// `stepIndex` models the LAST surfaced beat. These two helpers bridge that off-by-one and the off-script path. ──

/** Map the graph's `journeyStep` (NEXT beat to surface) onto a facilitator ADVANCE and return the beat to surface
 *  + the new persisted state. We seed stepIndex = journeyStep-1 so `advance` lands ON journeyStep's beat (not past
 *  it); beatIndex==null means the walk is complete (past the last beat).
 *
 *  SCOPE (P3 vs P4): P3-WIRE drives the walk SEQUENTIALLY — the facilitator threads phase + the CAPTURED concerns/
 *  signals as persistent facilitation context, but does NOT re-order the forward cursor. So we run the advance with
 *  openConcerns held ASIDE for the selection (→ always the next sequential beat == today's index walk, byte-identical
 *  whether the flag is on or off), then carry the recorded concerns/signals forward on the returned state. Re-ranking
 *  the cursor toward the grounded proof a buyer cares about is P4's discovery router — it needs a visited/resume
 *  cursor to do so WITHOUT collapsing or skipping the linear walk (a plain forward-cursor jump to a late proof would
 *  end the walk early and skip intervening beats — the failure mode this deliberately avoids). */
export function advanceWalk(prior: FacilitatorState | null, beats: FacilitationBeat[], journeyStep: number): FacilitatorStep {
  const base = prior ?? initialFacilitatorState();
  const r = transition({ ...base, stepIndex: journeyStep - 1, openConcerns: [] }, beats, { kind: 'advance' });
  // Preserve the recorded concerns/signals (the captured intelligence P4 will act on) on the persisted state.
  return { ...r, state: { ...r.state, openConcerns: base.openConcerns, buyerSignals: base.buyerSignals } };
}

/** Record an OFF-SCRIPT objection's concern WITHOUT moving the walk position or surfacing a beat — so the NEXT
 *  advanceWalk re-ranks toward the grounded proof that answers it (the off-script answer itself is composed
 *  elsewhere, with committee+ROI). Pure: appends to openConcerns (dedup); returns the SAME ref when nothing changed
 *  (empty/duplicate concern) so the caller can cheaply detect a no-op. */
export function noteConcern(prior: FacilitatorState | null, concern: string): FacilitatorState {
  const base = prior ?? initialFacilitatorState();
  const c = concern.trim();
  if (!c || base.openConcerns.includes(c)) return base;
  return { ...base, openConcerns: [...base.openConcerns, c] };
}

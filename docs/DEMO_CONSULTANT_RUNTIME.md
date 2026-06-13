# VIN AI-Consultant Runtime — Architecture & Phased Migration Plan

> Design deliverable (2026-06-13). The fix for the root cause in `DEMO_FAILURE_ROOTCAUSE.md`: VIN is a stateless one-LangGraph-loop Q&A engine with a chat-panel UI, and the journey walk was bolted on top. This scopes the **missing layer** — a dedicated, stateful, mode-aware AI-Consultant *runtime* — as a **strangler-fig** migration (incremental, flag-gated, each phase independently demoable + reversible, every phase preserving the trust gate, execution-mode safety, cost telemetry, the zero-gap assembler, and the prompt-golden invariant). 5 pillar architects + a chief-architect synthesis, grounded in the real code. **Design only — no code in this pass.**

## North star

A dedicated, stateful, mode-aware FACILITATION layer that OWNS a journey-driven demo end to end, sitting ABOVE the stateless one-LangGraph-loop Q&A brain it consumes. Today the walk is that loop fed a position-indexed caption playlist (journeys.ts journeyWalkPlan, graph.ts navigateJourneyStep), spoken via per-node LLM streaming windows that close at each phase boundary (llm.ts narrate/answerAs), advanced only by an operator click (voice-session.ts:301), rendered as chat. The runtime replaces this with: one continuous-speech driver (new src/core/speech-driver.ts owning a per-session TTS chain, utterance-scoped barge-in, a PENDING/COMPLETE/PARTIAL/FAILED completion enum so a broken stream is repaired not left as half a sentence into silence); an executable facilitator state machine (open-discover-show-objection-proof-close) owning auto-advance as runtime behavior not a checkbox; live discovery that ROUTES (un-skips graph.ts:325 so a buyer answer re-ranks the next proof); a mode-aware surface where the product is the stage and speech primary; first-audio pre-staging to reach first word in roughly 1.2s. A strangler fig: every pillar flag-gated, wrapping not forking the preserved invariants (retrieval.ts trust gate, safety.ts execution modes, cost.ts telemetry, zero-gap assembler discipline, eval-prompts byte-golden), with the legacy one-loop/chat/playlist path intact behind the flags as the operator and eval substrate.

## Phased plan (strangler-fig — each phase flag-gated, falls back to today, deterministically evaluated)

### P0 - Runtime seam plus completion enum (no behavior change)  ·  effort L
**Goal:** Carve the seam the runtime hangs off with zero demo-behavior change: add SpeechDriver plus CompletionStatus as additive types, thread completionStatus out of narrate/answerAs while keeping their string contract via an additive sibling, and instantiate a SpeechDriver in voice-session.ts that defaults to a pass-through over the existing ttsChain/say_chunk path, so later phases swap behavior at one tested boundary.

**Deliverables:**
- NEW src/core/speech-driver.ts: SpeechDriver class, CompletionStatus enum, SpeechBeat/PendingUtterance types; P0 delegates to existing ttsChain (byte-identical).
- llm.ts additive sibling returning text plus completionStatus from stop_reason; narrate/answerAs still return a string; status computed not consumed.
- voice-session.ts instantiates speechDriver behind SPEECH_DRIVER flag; OFF runs verbatim.
- state.ts: no new checkpointed channel (driver is ephemeral, RC-A).

**Reuses:** ttsChain serialization (:148-154), say_chunk onDelta plus flushSentences (llm.ts:600,638), utterance barge guard (:62,80,149), WS mechanics, cost.ts recordVoice, checkpointer plus RC-02 journeyStep, trust gate plus safety unchanged.

**Flag gate:** `SPEECH_DRIVER (engine env, default OFF, mirroring ELEVENLABS_WS at voice-session.ts:41-45).`  
**Demoable outcome:** Internal/CI only: flag OFF unchanged, flag ON identical through the wrapper; a green parity diff. The one phase not buyer-demoable, it is the foundation.

**Eval strategy:** NEW eval:phase25 unit-tests SpeechDriver deterministically (no TTS/mic): queue ordering, newer utteranceId discards older beat, completeBeat transitions. eval:prompts 20/20 byte-golden proves prompts unchanged. eval:phase24 6/6 flag ON and OFF.

**Risk:** Medium. Touches the golden-sensitive llm.ts; mitigated by the additive sibling plus eval:prompts byte-identity gate. RC-A: driver holds transport only, never decision state.

### P1 - Continuous speech plus streaming-failure repair plus auto-advance ownership  ·  effort XL
**Goal:** Flip SpeechDriver to ACTIVE: one per-session TTS chain spanning narration-answer-narration with no phase reset; on PARTIAL/FAILED async-fire completeOrRepairStreaming so the buyer never hears half a sentence into silence; move auto-advance from a UI dwell-timer to runtime behavior (journey_next auto-fires on chain-settle). Kills stops-after-paragraph, half-sentence-silence, two-burst stutter.

**Deliverables:**
- Driver owns ttsChain across beats; delete per-turn resets (:171,227); replace streamedThisTurn boolean (:61,140,162) with completionStatus.
- llm.ts completeOrRepairStreaming about 50 LOC: fallback LLM finishing the interrupted thought; async-fired, does not block turn_done (RC-D); cost source=fallback.
- voice-session.ts journey_next auto-fires on chain-settle, idempotent vs the answering guard (RC-E).
- runtime.tsx retires the dwell-timer (1490-1512) as primary driver; keep a speechPaused toggle (RC-F); shipped autoWalk-true/collapse/ephemeral-caption stay as the surface floor.

**Reuses:** Shipped stop-the-bleed UI floor (autoWalk runtime.tsx:1414, collapse :1521, liveCaption :1557), say_chunk streaming, WS abort-on-barge (:275-276), RC-02 journeyStep mirroring, trust gate plus safety plus cost unchanged.

**Flag gate:** `SPEECH_DRIVER default-ON in the buyer voice path once parity holds; env-toggleable rollback. Auto-advance IS the driver behavior.`  
**Demoable outcome:** Buyer-visible: continuous voice beat to beat with no operator click and no mid-sentence silence; barge-in answered then speech resumes; a forced break repairs gracefully. First phase that FEELS like a consultant.

**Eval strategy:** Extend eval:phase25: inject FAILED status, assert repair runs and reaches the queue; auto-advance fires once per settled beat. eval:phase24 6/6 flag ON; barge replay out of deterministic scope (manual e2e voice). eval:prompts: repair prompt is a NEW recaptured golden case.

**Risk:** High. The missing core layer: rewrites the turn lifecycle (finally blocks :180-187,240-247) and barge replay (:200-204). RC-B/RC-C/RC-E utterance-counter-guarded in the driver. Mitigation: behind the flag, parity eval, legacy path one env-var away.

### P2 - First-audio pre-staging (parallel boot plus warm open plus interpret thinking-off)  ·  effort M
**Goal:** Collapse the 8-15s long delay to roughly 1.2s: parallelize the serial boot cascade (live-session.ts:103-138), batch journeyWalkPlan DB (journeys.ts:134-147 to Promise.all), disable adaptive thinking on interpret (llm.ts:404-428) for the walk path, and make the cold-start bridge a genuine first beat the driver time-aligns to step-0 (no second silence).

**Deliverables:**
- bootSession product/outcome/committee into Promise.all (now sequential 103-138); preserve the journey-then-committee edge.
- journeyWalkPlan per-step lookups (134-147) batched via Promise.all; WalkEntry shape unchanged.
- interpret thinking disabled on the walk path (mirror answerAs:597), golden-safe (param not prompt); keep currentModel().
- SpeechDriver: speakColdStartBridge (:256-261) becomes startBeat(open) beat-0; step-0 narration plus chunk plus selectors prefetched during the bridge (kills root-cause number-6).

**Reuses:** Existing honest bridge text (:259), narrate-parallel-driveTo (graph.ts:282-285), clientNav default (live-session.ts:100), cost telemetry, trust gate untouched (prefetch warms the SAME gated retrieval).

**Flag gate:** `FIRST_AUDIO_PRESTAGE (default OFF). Independent of SPEECH_DRIVER.`  
**Demoable outcome:** Buyer-visible: journey-select to first word in roughly 1.2s; open beat flows straight into step-0. Side-by-side latency before/after.

**Eval strategy:** Timing harness: assert boot plus plan wall-time under budget flag ON vs OFF on the seeded PO.vin journey (deterministic, no TTS). eval:prompts MUST stay green. eval:phase24 6/6.

**Risk:** Medium. Parallel boot can surface ordering assumptions (committee needs the journey row); parallelize independent legs only. interpret thinking-off already net-positive on the answer path.

### P3 - Facilitator state machine (executable arc over the playlist)  ·  effort L
**Goal:** Replace the position-indexed arc (journeys.ts:153-168, journey-assembler.ts) with an executable facilitation state machine (open-discover-show-objection-proof-close) WITHOUT discarding the zero-gap assembler; the assembler still produces the grounded WalkEntry set, the runtime adds a thin FacilitatorState that selects/orders beats and inserts dialogue beats. The committee intelligence mute today (live-session.ts:323) now speaks AS a role at the objection beat.

**Deliverables:**
- NEW src/core/facilitator.ts: FacilitatorState (arc, openConcerns, narratedBeats) pure transition function over the plan plus journeyStep; emits the next beat-intent. Pure, DB-free.
- graph.ts navigateJourneyStep consults FacilitatorState for arcRole plus whether to inject discovery/objection, not pure plan position. recentNarrations stays (append-bounded, state.ts:125; root-cause overstated the reset).
- Committee-at-objection: lift the live-session.ts:322-332 grounded-overlap matcher to fire on a facilitator objection beat (overlap two-plus, sanitized, role-level, trust-gated).

**Reuses:** Zero-gap assembler UNCHANGED as asset source, committee overlap discipline (:328), WalkEntry.arcRole/narrated (journeys.ts:108-116), trust gate (objection answers hasSource-gated).

**Flag gate:** `FACILITATOR (default OFF, today's playlist). Assembler output identical; only consumption branches.`  
**Demoable outcome:** Buyer-visible: the consultant answers AS the CFO role with the matched objection plus criterion at the objection beat, and asks a real what-do-you-think beat at transitions. The invested intelligence finally speaks during the walk.

**Eval strategy:** NEW eval:phase26: drive the transition function deterministically; assert arc ordering, an objection beat surfaces a trust-gated committee concern (not fabricated), no beat without a grounded source. eval:phase24 only-KEY-beats plus clean-narration plus graph-position remain the net. eval:prompts green.

**Risk:** Medium-high. Where consultant-vs-tour is won; danger is inventing ungrounded beats. Mitigation: facilitator only reorders/selects/inserts-dialogue over assembler-grounded beats; objection answers flow the trust gate.

### P4 - Live discovery router (signals re-shape the next screen)  ·  effort M
**Goal:** Un-skip discover() on walk turns (reverse graph.ts:325) so a buyer answer is captured AND ROUTES, re-ranking the next proof the facilitator picks, closing the last monologue gap. LAST: depends on the facilitator (P3) to consume the signal and continuous speech (P1) so a discovery turn does not reintroduce dead air.

**Deliverables:**
- graph.ts: a LIGHTWEIGHT discovery capture on walk turns (signal extract, not the full interrupt) feeding FacilitatorState.openConcerns.
- facilitator.ts re-rank step letting a concern bias which remaining grounded beat shows next (within the assembler set, never fabricated).
- recordDiscovery stays the audit sink; the signal now also updates in-session facilitator state (today a passive log).

**Reuses:** discover() plus recordDiscovery UNCHANGED as capture, the facilitator transition function (P3), the assembler grounded beat set, trust gate (re-ranked beats still gated).

**Flag gate:** `DISCOVERY_ROUTER (default OFF, discover stays skipped on walk turns). Composes on FACILITATOR (no-op if OFF).`  
**Demoable outcome:** Buyer-visible: a buyer raises month-end close and the next beat shown is the close-related grounded proof, not the canned slide. The walk visibly bends to the room.

**Eval strategy:** NEW eval:phase27: feed scripted signals; assert next-beat selection changes deterministically AND stays within the grounded set. recordDiscovery still writes. eval:phase24 net plus eval:prompts green.

**Risk:** Medium. Re-ranking risks the order-is-the-arc guarantee; mitigation: routing only PROMOTES an already-present grounded beat earlier, never injects or skips a required beat.

## Reuse / Evolve / Replace ledger

**KEEP (unchanged, load-bearing):**
- retrieval.ts trust gate (CONFIDENCE_THRESHOLD, gateForVector, chunkPassesGate): every spoken fact, repaired stream, objection answer, re-ranked beat flows through it unchanged.
- safety.ts execution modes plus fail-closed classifier: never fires a mutating action; clientNav read-only stays the buyer default.
- cost.ts telemetry: extended only with an optional source=fallback tag for repair calls.
- journey-assembler.ts zero-gap evidence-grounded assembly plus Gap Records: the runtime CONSUMES grounded beats, never generates assets.
- eval-prompts byte-golden invariant (20/20): the hard gate after every llm.ts edit; new prompts are intentionally recaptured cases.
- LangGraph one-loop brain plus checkpointer plus RC-02 graph-owned journeyStep: the runtime sits ABOVE it and mirrors its position.
- Shipped stop-the-bleed UI floor (autoWalk default true, panel collapse, ephemeral caption, header mic/kill): build on it. Do NOT touch LiveBrowser/TargetPicker; TourRunner stays superseded.

**EVOLVE (extend, don't rewrite):**
- llm.ts narrate/answerAs: expose completionStatus via an additive sibling (P0); add completeOrRepairStreaming (P1); disable thinking on interpret for the walk path (P2).
- voice-session.ts turn lifecycle: ttsChain/streamedThisTurn/replayPendingBargein into the per-session SpeechDriver (P0-P1).
- graph.ts navigateJourneyStep plus discover: position-indexed to facilitator-consulted arc (P3) plus routing capture (P4).
- journeys.ts journeyWalkPlan: per-step DB loop to Promise.all (P2); keep the WalkEntry contract.
- live-session.ts bootSession: serial cascade to parallel legs (P2); add SpeechDriver to SessionCtx (P0).

**REPLACE (the foundation that produces the failure):**
- Per-turn ttsChain reset (:171,227): the per-session driver chain.
- streamedThisTurn boolean (:61,140,162): the CompletionStatus enum (it cannot represent a partial/failed stream).
- replayPendingBargein plus pendingBargein stash (:59,200-204): SpeechDriver.hasPendingUtterance/barge.
- Operator-click journey_next as primary driver (:301-302) and the runtime.tsx dwell-timer (1490-1512): engine-owned auto-advance on chain-settle.
- Position-indexed arc as the runtime pacing source (journeys.ts:153-168): the executable FacilitatorState (the plan stays; its interpretation moves).

## Sequencing rationale

Leverage and dependency align. P0 first: the SpeechDriver/CompletionStatus seam is what every speech-and-pacing change attaches to; carving it with zero behavior change (flag-OFF parity plus the byte-golden) de-risks the XL P1 behind a tested boundary. P1 next: it is the single change that kills all three reported symptoms and is the first buyer-visible consultant moment; nothing downstream matters if speech still stalls. P2 (first-audio) is independent of P1 correctness but compounds felt quality and is cheap/reversible on its own flag. P3 (facilitator) must follow P1: an executable arc with dialogue beats only feels alive once speech is continuous; facilitation atop a stalling tour is just nicer captions on the same dead experience (the Wave A-D trap). P4 (router) is strictly last: it needs the facilitator to consume the signal and continuous speech so a discovery turn does not reintroduce dead air. Each phase is flag-gated, demoable, revertible; the legacy one-loop/chat/playlist path survives untouched as operator/eval substrate, a true strangler fig.

## Biggest risks

- Golden-prompt invariant is the highest-frequency tripwire: llm.ts is the most-edited file across P0/P1/P2; any system-prompt byte change breaks eval-prompts 20/20. Mitigation: every llm.ts change is param/return-shape only, never editing an rp()-spanned prompt; eval:prompts is a blocking gate.
- P1 is XL and rewrites the live turn/barge lifecycle, the least deterministically-covered area (barge replay out of phase24 scope); a regression is invisible to CI. Mitigation: SPEECH_DRIVER env-revertible, phase25 covers all non-TTS/mic logic, a scripted manual e2e voice run gates default-ON.
- Scope creep into the rejected foundation (record-and-replay, an enterprise platform, multi-agent split). Mitigation: a strangler fig of five small flags; facilitator/router are assembler-not-generator consumers; the one-loop brain and checkpointer are preserved.
- Facilitator (P3) and router (P4) could erode the zero-gap guarantee by inventing/skipping beats. Mitigation: reorder/select/insert-dialogue over assembler-grounded beats only; every line passes the trust gate, so the worst case degrades to today's playlist, not hallucination.
- Checkpointer-resume mid-demo (RC-A): the ephemeral driver loses its in-flight queue on resume. Mitigation by design: it holds transport only; the graph owns journeyStep (persisted via saveSessionState), so resume rebuilds the position and at worst replays the current beat; log a warning if pendingUtterances were dropped.

## The highest-leverage first increment

Ship P0: create src/core/speech-driver.ts (SpeechDriver class, CompletionStatus enum, SpeechBeat/PendingUtterance types) as a pass-through wrapper over the existing voice-session.ts ttsChain/say_chunk path, thread a computed completionStatus out of llm.ts narrate/answerAs via an additive sibling preserving the string contract, gated behind a default-OFF SPEECH_DRIVER env flag (mirroring ELEVENLABS_WS at voice-session.ts:41-45). Prove it with three blocking gates: eval:prompts 20/20 byte-identical (no prompt moved); a new eval:phase25 unit-testing the driver queue/barge/completion transitions deterministically (no TTS/mic, phase24 clientNav discipline); eval:phase24 6/6 with the flag ON and OFF (parity). Demoable as a green CI diff changing nothing the buyer sees, yet it is the seam the whole runtime hangs off, the highest-leverage safe first increment before the XL P1 rewrite.

---

## Appendix — Pillar 1 deep design: the Continuous-Speech Driver (the XL core of P0→P1)

**Current state.** Speech generation split across independent LLM streaming windows closed at phase boundaries: narrate() (graph.ts:263-284; llm.ts:399-429) and answerAs() (llm.ts:596-642) each complete inside their LangGraph node with independent streaming windows. Per-turn TTS chain reset at voice-session.ts:171,227; streamedThisTurn boolean (line 61,140,162) cannot represent partial/failed completion — on stream break, flag stays true and fallback suppressed. Auto-advance defaults OFF (runtime.tsx:1411) with dwell timer line 1488 gated off in voice path; journey_next waits for client click (voice-session.ts:301-302). Barge-in state scattered: utterance counter (line 62), interrupted flag (line 60), pendingBargein stash (line 59); replayPendingBargein (lines 200-204) fragile, suppresses turn_done (lines 186,246). Single graph.invoke per turn (live-session.ts:231) stateless; recentNarrations reset per-turn (graph.ts:302), losing walk continuity.

**Target state.** Continuous speech across beats: narration→answer→narration ONE logical monologue with no silence between phases. Auto-advance runtime default in buyer path (walk step completion auto-fires next step; operator/test can pause via flag). Streaming-failure recovery via completion enum (PENDING|COMPLETE|PARTIAL|FAILED); on PARTIAL/FAILED, speech driver async-calls completeOrRepairStreaming() fallback LLM. Single per-session TTS chain spans phases seamlessly. Utterance-scoped coherence: barged-in question marked with utteranceId; original in-flight answer discarded if newer utterance arrives; stashed question becomes source-of-truth. No dropped inputs, no half-answers from prior utterances.

**Exact seam.** NEW src/core/speech-driver.ts (~350 LOC): class SpeechDriver {utteranceId, currentBeat, pendingPhrase, ttsQueue, completionMarker, barged} with methods startBeat(label), feedPhrase(text,utteranceId,isPartial), completeBeat(status), barge(utteranceId), nextPhrase(), hasPendingUtterance(), currentUtterance. REPLACE src/core/llm.ts narrate/answerAs return Promise<{text,completionStatus:'complete'|'partial'|'failed'}>; onDelta gains (sentence,isPartial?)=>void; ADD completeOrRepairStreaming(partialText,context) fallback. REPLACE voice-session.ts line 47-48 instantiate speechDriver; line 138-156 say_chunk call feedPhrase; line 200-204 delete replayPendingBargein use hasPendingUtterance; line 275 mic_start call barge; line 301-302 auto-fire journey_next via nextStep when ttsChain settles; delete line 171,227 ttsChain reset. REPLACE graph.ts line 282-284 destructure completionStatus from narrate. REPLACE live-session.ts line 90-162 add speechDriver to SessionCtx; line 336-359 destructure completionStatus; line 433 await speechDriver.completeBeat(). REPLACE runtime.tsx line 1411 delete autoWalk; line 1488-1509 delete dwell timer; add speechPaused flag; line 1686 move pause toggle to Talk runtime.

**Reuse:**
- ttsChain promise-chain serialization (voice-session.ts:148-154) moved into SpeechDriver
- say_chunk streaming callback (llm.ts onDelta) with optional isPartial param
- utterance ID barge-in guard (RC-11, voice-session.ts:62,80,149) integrated into SpeechDriver.barge()
- WS streaming mechanics (openElevenWs, feed, abort) coordinated by speech driver
- audio playback routing (voice-client.ts:17-24) unchanged
- trust gate + execution mode (retrieval.ts, safety.ts) unchanged
- LangGraph checkpointer + RC-02 (graph.ts:456, journeyStep) unchanged
- cost telemetry (recordVoice) reused with optional source='fallback'
- per-turn tracing (graph.ts:44-68) unchanged

**Replace:**
- Per-turn ttsChain reset (voice-session.ts:171,227)
- streamedThisTurn boolean (line 61,140,162,171) replaced by completionStatus enum
- per-turn say_chunk accumulation (line 148-154)
- replayPendingBargein function (line 200-204)
- autoWalk + dwell timer (runtime.tsx:1411,1488-1509)
- pendingBargein stash (voice-session.ts:59)
- runVoiceTurn finally logic for turn_done (line 180-187,240-247)
- narrate/answerAs return type from Promise<string> to Promise<{text,completionStatus}>

**Add:**
- src/core/speech-driver.ts NEW (~350 LOC): SpeechDriver class, CompletionStatus enum, auto-advance state machine
- llm.ts completeOrRepairStreaming() NEW (~50 LOC) fallback LLM prompt 'The response was interrupted. Here is what was said: [partial]. Continue naturally...'
- voice-session.ts integration (~150 LOC): instantiate speechDriver, wire say_chunk, pending-barge check, journey_next auto-fire
- graph.ts + live-session.ts completionStatus threading (~100 LOC): destructure from narrate/answerAs, pass to speechDriver.completeBeat()
- runtime.tsx speechPaused flag + UI (~80 LOC): add toggle, remove dwell timer, delete autoWalk
- Type definitions: CompletionStatus enum, SpeechBeat, PendingUtterance

**Risks:**
- RC-A Checkpointer state loss: speech driver ephemeral; on resume, ttsChain/utterance queue lost. Mitigation: in-flight only, not decision state; graph owns journeyStep (RC-02); resumption rebuilds context; log warning if pendingUtterances exist.
- RC-B Incomplete thought on barge-in: narrate discarded mid-thought. Mitigation: fallback prompt explicitly reconstructs 'you were interrupted; finish the thought.'
- RC-C WS frame interleaving: barge-in aborts WS; in-flight frames queue with new utterance's TTS. Mitigation: utterance counter guards all TTS feed; speech driver enforces same on nextPhrase.
- RC-D Fallback latency: completeOrRepairStreaming adds 2-4s LLM round-trip. Mitigation: async-fired, does NOT block turn_done; buyer hears partial + silence; fallback composes in background.
- RC-E Auto-advance race with playback: journey_next fires before client audio finishes. Mitigation: journey_next idempotent (answering guard); duplicate signals hit busy and drop.
- RC-F Operator pause/resume: paused mid-TTS then resumed must not skip/replay. Mitigation: speechPaused flag orthogonal to utterance logic; when paused nextPhrase returns null; queue held.
- RC-G Gemini non-streaming: when selected, narrate doesn't stream; no say_chunk exposure. Mitigation: acceptable for now; mark TODO Phase 2 Gemini streaming.
- RC-H utterance ID wraparound: 32-bit number overflow after ~1 month continuous barge-ins. Mitigation: use BigInt or reset on session end; for 2-hour demo max ~7200 safe.

**Effort:** XL

## Appendix — Pillar 2 — Facilitation State Machine  ·  effort L

**Current state.** The walk is position-indexed and stateless about facilitation. journeyWalkPlan (journeys.ts:129-171) flattens story_flow into WalkEntry[] and assigns arcRole by POSITION (153-168: first=open, last=close, interior runs=transit) — there is no DISCOVER/OBJECTION/PROOF role and no branch. The assembler hard-codes the arc as ORDER only (journey-assembler.ts:117-155, comment 'arcRole computed downstream by POSITION'). navigateJourneyStep (graph.ts:237-307) reads state.journeyStep (a flat counter), narrates the pre-assembled caption via narrate() (263, 284), and advances {journeyStep: step+1} (245) with no notion of phase. discover() is SKIPPED on every walk turn (graph.ts:319-325: 'if (state.journeyAdvance) return ... skipped on a journey walk step') — so the AI never asks/listens/re-ranks DURING the walk; discovery only runs on off-script turns. Committee intelligence reaches speech ONLY off-script: live-session.ts:322-333 computes the matched committee objection+criteria ONLY when `!turn.advance` and `k==='objection'`, passed to answerAs (354) — a walk turn (turn.advance=true) emits out.explanation directly (graph.ts:264/301 → live-session.ts:291-293) and never touches answerAs/committee/ROI. ROI (outcomeMetric/baseline/target) is bound once at boot (live-session.ts:113-122) and only narrate's CLOSE beat states a number (graph.ts:258). buyer signals are recorded (discover→recordDiscovery, discovery.ts:16) but never re-rank the next screen. Position is in DemoState.journeyStep (state.ts:53, REPLACE reducer, checkpointed) + recentNarrations (state.ts:125, append/bounded). The walk is driven step-by-step by walkJourney/runWalkStep (live-session.ts:433-471) and voice runWalkStep (voice-session.ts:222-248) via journey_next; desktop reads journey_step events incl. arc (runtime.tsx:880-882).

**Target state.** A stateful facilitator. STATES: OPEN (frame the gap for the committee, no screen) → DISCOVER (ask ONE grounded question, LISTEN to the buyer's reply, ROUTE it: extract signals via the existing discover() and RE-RANK the remaining script's proof/screen branches so the next SHOW matches what the buyer just said) → SHOW (drive the live screen + narrate the turning point) → OBJECTION (when the buyer pushes back, answer AS the matched committee role with the overlapping authored objection + decision criterion + a real ROI number, then RESUME at the pre-objection phase/step) → PROOF (cite the validated chunk that answers the surfaced concern) → CLOSE (state the measurable result + how the committee judges it). TRANSITIONS are signal-driven, not index-driven: OPEN→DISCOVER auto after the opener; DISCOVER→SHOW when a buyer answer is captured (or operator Next with no answer); SHOW→OBJECTION when interpret.kind==='objection' on an off-script turn (the demo INTERRUPTS itself); OBJECTION→(resume prior phase) after the role-answer; SHOW→PROOF when a proof branch is queued for the active concern; any→CLOSE at the terminal step or operator close. discover() RUNS DURING the walk on DISCOVER/SHOW beats (listen+route), only the auto-narration beats skip it. Committee/ROI/screenFacts reach speech on the WALK path too (OBJECTION + PROOF beats route through answerAs with the matched committee+ROI, not just off-script). State threaded: facilitationPhase, openConcerns (committee concerns still unanswered), buyerSignals (rolling, re-ranks branches), recentNarrations, arc/step position — all in DemoState, REPLACE-reduced, checkpointed by MemorySaver and mirrored to the RC-30 snapshot for cross-process resume. Zero-gap + grounded preserved: the assembler still only REFERENCES real assets and still emits Gap Records; branches re-rank EXISTING script beats, never invent.

**Exact seam.** FLAG: new flag (e.g. PO_VIN_FACILITATION or a journeys.facilitation column) gates the whole machine; off = today's navigateJourneyStep byte-for-byte. (1) SCRIPT shape: extend WalkEntry (journeys.ts:108-116) with optional `phase: 'open'|'discover'|'show'|'objection'|'proof'|'close'` and `branchKey: string|null` (the concern/criterion this beat answers); add a parallel builder `facilitationScript(journeyId)` in journeys.ts beside journeyWalkPlan (~line 129) that maps the assembler's arc beats to phases — REUSE journeyWalkPlan's resolution (workflow node_sequence expansion 135-140, knowledge sourceText 141-147, speakableSource 120). Assembler: journey-assembler.ts story[] (134-155) already encodes pain/stakes/show/proof/close ORDER — tag each pushed StoryStep with its phase + branchKey (the painObjection/painCriterion at 132-133 become DISCOVER/OBJECTION branch keys; the scoredK proof chunks at 149-151 become PROOF branches keyed by the objection they overlap ≥2). No new asset writes (zero-gap intact). (2) STATE: add to DemoState (state.ts after :53) `facilitationPhase: Annotation<FacilPhase>` (REPLACE, checkpointed like journeyStep), `openConcerns: Annotation<string[]>` (REPLACE), `buyerSignals: Annotation<string[]>` (append/bounded like recentNarrations :125). (3) NODE: rename/branch navigate (graph.ts:310-316) — when facilitation flag on, dispatch to a new `facilitate(state, config)` beside navigateJourneyStep (graph.ts:237) that switches on state.facilitationPhase instead of bare step index; it sets the NEXT phase in its return (REPLACE reducer) and on a DISCOVER beat does NOT skip discover. (4) DISCOVER-DURING-WALK: change discover()'s guard (graph.ts:325) from `if (state.journeyAdvance) return skipped` to `if (state.journeyAdvance && state.facilitationPhase !== 'discover' && state.facilitationPhase !== 'show') return skipped` — so listen/route runs on those phases; route by feeding the captured d.painPoints/buyingSignals into buyerSignals and re-ranking the remaining script branches (reuse the assembler's overlap() token≥2, journey-assembler.ts:37). (5) OBJECTION/PROOF→SPEECH: today out.explanation (graph.ts:264/301) bypasses answerAs. On OBJECTION/PROOF beats, have facilitate() leave explanation null and set a flag so runTurn (live-session.ts:294 `else if (turn.advance)`) routes through the answerAs branch (309-364) WITH committee+ROI — REUSE the exact committee-matching block (live-session.ts:322-333) and the outcome/ROI binding (ctx.committee/outcomeMetric from boot, 130/122), lifting the `!turn.advance` constraint for these two phases only. (6) RESUME after objection: REUSE contextStack/currentPosition (graph.ts:218-220 pivot push, :362 resume) — push the pre-objection phase+step, pop on resume. (7) RUNNERS unchanged in shape: runWalkStep/walkJourney (live-session.ts:433-471) and voice runWalkStep (voice-session.ts:222-248) keep advancing via the graph-owned position (RC-02), now reading facilitationScript() instead of journeyWalkPlan() behind the flag; journey_step event (live-session.ts:435) gains `phase`; desktop ArcChip (runtime.tsx:880-882,920) maps phase→chip. (8) RESUME snapshot: add facilitationPhase to saveSessionState/loadSessionState seed (live-session.ts:152-157, 241-246) like journeyStep. (9) EVAL: extend eval-phase24.ts (drives walkJourney/runWalkStep at :39/:91) with a facilitation-on suite asserting phase progression, discover-during-walk, and OBJECTION→answerAs(committee+ROI)→resume; keep the flag-off path asserting byte-identical current behavior.

**Reuse:**
- journeyWalkPlan resolution internals (journeys.ts:135-147): workflow node_sequence expansion, knowledge sourceText resolution, speakableSource(120) — facilitationScript() wraps these, adding phase/branchKey only
- assembler's deterministic overlap()/sigWords token-≥2 matcher (journey-assembler.ts:37) — reused to RE-RANK proof/screen branches against live buyer signals during DISCOVER routing (same discipline that gates committee objections)
- the committee-matching + ROI block already in runTurn (live-session.ts:322-333, 348-354) and bound at boot (live-session.ts:122-136) — lifted onto the OBJECTION/PROOF walk path so authored objections + decision criteria + a real number finally reach speech on the walk, not only off-script
- existing discover() node + recordDiscovery/getDiscovery (graph.ts:319-344, discovery.ts:16-34) — becomes the LISTEN+capture half of DISCOVER instead of being skipped
- contextStack/currentPosition pivot-push + resume (graph.ts:218-220, 362-386) — the OBJECTION→resume mechanism (push pre-objection phase/step, pop after answering)
- DemoState REPLACE/append reducers + MemorySaver checkpointer + RC-30 snapshot resume (state.ts:53/125, graph.ts:456, live-session.ts:149-159, 241-246) — facilitationPhase/openConcerns/buyerSignals ride the SAME persistence, no new store
- runWalkStep/walkJourney shared stepper + voice runWalkStep + journey_next pacing (live-session.ts:433-471, voice-session.ts:222-248) and desktop ArcChip/journey_step plumbing (runtime.tsx:880-882) — unchanged in shape; phase is an additive field
- retrieval trust gate (retrieveAndGate/chunkPassesGate), safety classifyAction/permits, cost record(), prompt-golden rp()/answerAs/narrate builders — all preserved untouched

**Replace:**
- the position-indexed arc: replace journeyWalkPlan's POSITION-derived arcRole assignment (journeys.ts:153-168) with phase-tagged beats emitted by facilitationScript() (assembler tags phase at journey-assembler.ts:134-155); journeyWalkPlan stays as the flag-OFF fallback
- the discover-skip on every walk turn (graph.ts:319-325) — narrow the guard so discover() RUNS during DISCOVER/SHOW phases (listen + route), still skipping pure auto-narration beats
- static caption playback in navigateJourneyStep advancing a bare counter {journeyStep: step+1} (graph.ts:245, 264, 301) — replace with facilitate() that switches on facilitationPhase, sets the NEXT phase, and routes OBJECTION/PROOF beats through answerAs rather than emitting a pre-baked caption
- the off-script-ONLY committee/ROI channel: the `!turn.advance`/`turn.advance` fork in runTurn (live-session.ts:294, 323) that makes a walk turn bypass answerAs — OBJECTION/PROOF walk beats now route through the grounded answerAs path with committee+ROI

**Add:**
- FacilPhase type + DemoState channels facilitationPhase (REPLACE, checkpointed), openConcerns (REPLACE), buyerSignals (append/bounded) — state.ts
- facilitationScript(journeyId) builder in journeys.ts beside journeyWalkPlan: resolves story_flow to phase-tagged, branchKeyed beats (reuses existing resolution; invents nothing)
- facilitate(state, config) node in graph.ts beside navigateJourneyStep: the phase switch (OPEN/DISCOVER/SHOW/OBJECTION/PROOF/CLOSE), branch re-ranking from buyerSignals, phase transitions; navigate() dispatches to it under the flag
- phase + branchKey fields on WalkEntry/StoryStep, and phase tags emitted by the assembler (journey-assembler.ts story[] pushes) — additive, zero-gap preserved
- the flag (PO_VIN_FACILITATION env or journeys.facilitation column) gating the whole machine; off = byte-identical current walk
- phase added to the journey_step event + desktop phase→ArcChip mapping (live-session.ts:435, runtime.tsx)
- facilitationPhase added to the RC-30 snapshot seed/save (live-session.ts:152-157, 241-246)
- eval-phase24 facilitation-on suite: phase progression, discover-during-walk routing, OBJECTION→answerAs(committee+ROI)→resume, and a flag-off byte-identity assertion; eval-prompts byte-identity rerun if any prompt span touched

**Risks:**
- Two invokes racing the same MemorySaver thread: an off-script OBJECTION turn and a journey_next advance both mutate facilitationPhase/journeyStep. Mitigation: keep voice/desktop serialization via the `answering` mutex (voice-session.ts:170,224) and RC-02 graph-owned position; OBJECTION push/pop must be idempotent under the existing pivot logic
- Prompt-golden invariant: routing OBJECTION/PROOF through answerAs is reuse of an existing call, but if any answerAs/narrate prompt SPAN is edited the byte-identity eval (eval-prompts.ts 20/20) must rerun — design adds NO new prompt spans to keep the golden intact
- Branch re-ranking could desync the flat journeyStep counter the runners mirror (RC-02): facilitate() must keep journeyStep authoritative and express branch choice as phase/branchKey selection over REMAINING beats, never by rewriting indices mid-walk
- DISCOVER waiting on a real buyer answer can stall an auto-advance walk (the 'speaks one paragraph then stops' regression): need an operator-pace fallback (Next with no answer → SHOW) and bounded dwell, reusing autoWalk/turn_done pacing (runtime.tsx:1485-1508)
- Zero-gap discipline drift: phase tagging must stay in the assembler as metadata over REFERENCED assets — adding phases must not tempt invention of a missing proof/screen; a missing branch asset stays a Gap Record
- Resume-after-objection must restore the pre-objection phase AND the screen (currentPosition), or the walk silently skips a beat; cross-process resume (RC-30) must also carry facilitationPhase or a redeploy mid-objection loses the phase
- Flag-off regression: facilitationScript/facilitate must be fully bypassed when the flag is off so existing phase24 (6/6) and the live demo stay byte-identical

## Appendix — Pillar 3 — Mode-Aware Surface  ·  effort M

**Current state.** The Control Room (apps/desktop/src/runtime.tsx ControlRoom, line 1384) is chat-panel-first. `panelOpen` defaults true (1431) and `tab` defaults 'convo' (1432). RightPanel (219-248) renders UNCONDITIONALLY as a sibling of the stage in every engine/scripted mode (JSX at 1780-1785); its convo tab is the Convo message reducer (744-793) that paints EVERY `live.messages` entry as a bubble (map at 755-764) — so the spoken walk shows up as a transcript beside the webview. The mode boundary already exists in DATA but not in LAYOUT: `runtime: 'start'|'ask'|'talk'|'live'|'scripted'` (1387/1391) and the derived `isJourneyWalk = runtime==='talk' && !!target?.journeyId` (1489) only swap the walk HEADER (1697-1759) on/off and pace auto-advance (1490-1512) — they do NOT gate the primary surface. Stop-the-bleed already added: a FRAGILE one-shot `collapsedFor` useRef latch that fires setPanelOpen(false) once per journeyId (1519-1522); the ephemeral `liveCaption` over the stage (computed 1557, rendered 1774-1778, pointerEvents:none); and a proto-HUD walk header (mic/kill/Exit/Next/Auto-advance at 1731-1735/1704-1707 + the #34 teleprompter row 1739-1757 with ArcChip 920-923). The engine ALREADY streams every datum a consultant HUD needs: runWalkStep (src/core/live-session.ts:433-438) emits `journey_step` spreading walkStepView (src/core/journeys.ts:178-184) → `arc`, `narrated`, `caption`, `node`, and `next{caption,arc,narrated}`; plus `journey_start/_complete`, `message.who` (who is speaking), `listening`/`transcript` (barge-in state), `turn_done`, `cite`, `blocked`. reduceLive (854-889) already folds all of it into LiveState (836-852). VoiceClient (apps/desktop/src/voice-client.ts) already exposes the exact HUD verbs: next() (108), startMic/stopMic (72/96), setVoice (106), and close() via stopVoice (1427) for kill. Layout is flex: .cr-body (control-room.css:66) holds .cr-stagearea (flex:1, 67) + .cr-panel (fixed 372px, 86) as siblings.

**Target state.** A real MODE BOUNDARY drives the layout, not just header visibility. Two surfaces selected by a single derived `surface = isJourneyWalk ? 'consultant' : 'qa'` (no new global mode — reuse isJourneyWalk).

CONSULTANT surface (walk): product full-bleed — cr-stagearea fills cr-body, NO RightPanel and NO chat bubbles rendered by default. The voice is the channel; the ephemeral liveCaption (1774-1778) is the only persistent text over the product. A minimal facilitation HUD (the existing walk header, promoted to a first-class `<WalkHud>` component) reflects the Pillar-2 state machine via the events already on LiveState: current beat (journeyCaption + ArcChip journeyArc), who is speaking (message.who / activePersona), what is next (journeyNext peek), progress (journeyStep/journeyTotal), barge-in (toggleMic + listening + a live transcript chip from `live` transcript events), and kill (stop). Transcript is ON-DEMAND behind a tab: a single "Transcript" affordance in the HUD toggles a slide-over that reuses Convo (read-only) — opening it never reverts the surface; closing returns to clean full-bleed.

Q&A surface (ASK / Reel / Scripted / interactive Talk-without-journey): EXACTLY today's behavior — RightPanel + Convo + Transport, panel open, convo default. Untouched.

The fragile collapsedFor latch is deleted; full-bleed is now a pure function of `surface` (declarative), so a talk→ask→talk detour or re-entry is always correct with no stale ref. Barge-in/kill are guaranteed reachable because they live in the always-on HUD, not a collapsible panel.

**Exact seam.** All changes are confined to apps/desktop/src/runtime.tsx + apps/desktop/styles/control-room.css. NO engine, no core/*, no voice-client, no LiveBrowser/Stage/TargetPicker signature change.

1) Derive the surface (after line 1489): keep `isJourneyWalk`; add `const surface = isJourneyWalk ? 'consultant' : 'qa'`. (Optional flag gate: `&& flags.modeAwareSurface` read from a localStorage/env constant so the whole pillar is dark-launchable — strangler-fig.)

2) Promote the walk header to `<WalkHud>` — EXTRACT the JSX currently inline at 1697-1759 into a function component `WalkHud({ live, voiceState, autoWalk, setAutoWalk, advanceWalk, toggleMic, listening, onKill, onExit, onShowTranscript, vc })`. Behavior byte-identical to today; ADD one button "Transcript" calling onShowTranscript, and a small live `transcript`-event chip beside the mic (reduceLive already drops transcript today — add `transcript: string` to LiveState INIT 852 + a `case 'transcript'` in reduceLive 854-887 setting it, and clear on turn_done). This is the facilitation HUD.

3) Gate the primary surface (the body JSX at 1760-1786): replace the unconditional `<RightPanel .../>` (1780-1785) with `{surface === 'qa' && <RightPanel .../>}`. In consultant surface, render only cr-stagearea (full-bleed) + the ephemeral liveCaption (already there 1774-1778) + an on-demand transcript slide-over: `{surface==='consultant' && transcriptOpen && <TranscriptDrawer messages={live.messages} onClose={()=>setTranscriptOpen(false)} />}` where TranscriptDrawer is a thin wrapper that REUSES Convo (744) read-only (onAsk/canAsk undefined). Add `const [transcriptOpen,setTranscriptOpen]=useState(false)`.

4) Move the WalkHud render: it currently lives between the strip and cr-body (1697). Keep it there for both surfaces is wrong — render `{surface==='consultant' && <WalkHud .../>}`. The Transport (1789-1795) already excludes isJourneyWalk — leave as-is (it stays for qa).

5) DELETE the collapsedFor latch (1519-1522) entirely; full-bleed is now `surface==='consultant'` (declarative). panelOpen default (1431) stays true and only governs the qa surface.

6) CSS (control-room.css): add `.cr-body.consultant .cr-stagearea { flex: 1 1 100%; }` (already flex:1, so effectively no-op but explicit) and a `.cr-transcript-drawer` rule (position:absolute, right:0, top:0, bottom:0, width:372px, slide-in transform) reusing .cr-panel tokens. Add the class to cr-body: `<div className={`cr-body ${surface}`}>` (1760).

**Reuse:**
- Stage + LiveBrowser render (runtime.tsx 680-740, 485-620) — untouched; consultant surface just gives it 100% width via cr-body flex
- The ephemeral liveCaption over the product (computed 1557, rendered 1774-1778) — already the right consultant-mode text channel
- The walk header / #34 teleprompter + ArcChip (1697-1759, 920-923) — extracted verbatim into WalkHud, the facilitation HUD
- Convo (744-793) — reused READ-ONLY inside the on-demand TranscriptDrawer (onAsk/canAsk undefined)
- Engine events already carry the full HUD state: journey_step{arc,narrated,caption,node,next} via walkStepView (live-session.ts:435, journeys.ts:178), message.who, listening/transcript, turn_done — no new engine emits
- VoiceClient verbs next()/startMic/stopMic/setVoice/close (voice-client.ts 72-109) — the HUD's barge-in/next/kill bind to these as today
- reduceLive + LiveState (836-889) — already the single source of HUD truth; only +1 transcript field
- isJourneyWalk (1489) — the existing mode boundary, promoted to drive layout

**Replace:**
- The unconditional RightPanel render (1780-1785) → gated to `surface==='qa'` only
- The Convo-message-reducer-as-PRIMARY-surface during a walk → bubbles no longer render by default in consultant mode; transcript is on-demand behind the HUD Transcript tab
- The fragile one-shot collapsedFor useRef + setPanelOpen(false) effect (1519-1522) → DELETED; full-bleed becomes a pure declarative function of `surface` (no stale-ref re-entry bug)
- The inline walk-header JSX (1697-1759) → extracted to a reusable <WalkHud> component (same markup/behavior + Transcript button + transcript chip)
- panelOpen as the de-facto walk/no-walk switch → panelOpen now governs ONLY the qa surface; the walk no longer touches it

**Add:**
- <WalkHud> component (facilitation HUD reflecting Pillar-2 state: current beat, who-speaks, what-next, barge-in transcript chip, mic, kill, next, auto-advance) — extraction + Transcript button + live transcript chip
- <TranscriptDrawer> — thin slide-over wrapping read-only Convo, opened on demand from the HUD
- Derived `const surface = isJourneyWalk ? 'consultant' : 'qa'` (+ optional `flags.modeAwareSurface` constant for dark-launch)
- `const [transcriptOpen, setTranscriptOpen] = useState(false)`
- LiveState.transcript:string (INIT 852) + `case 'transcript'` in reduceLive (854-887), cleared on turn_done — to feed the HUD barge-in chip (event already arrives, just not stored)
- CSS: `.cr-body.consultant` modifier + `.cr-transcript-drawer` slide-over rule in control-room.css (reusing .cr-panel tokens)

**Risks:**
- Hidden coupling: a few effects read panelOpen indirectly; deleting collapsedFor must not strand the qa surface — keep panelOpen state, only stop the walk from writing it. Verify ASK/Reel/Scripted panels still open by default.
- Operators relying on seeing bubbles during a walk lose them by default — mitigated by the on-demand Transcript tab; gate behind flags.modeAwareSurface for a quiet rollout.
- Barge-in reachability: kill + mic MUST be in the always-on WalkHud (not the drawer) so a closed transcript never strands them — this is exactly the stop-the-bleed HIGH-2/MEDIUM concern; preserve it in the extraction.
- Transcript drawer reusing Convo must be forced read-only (onAsk/canAsk undefined) or it reintroduces a chat input into consultant mode — keep the mic/ask path solely through the HUD.
- PRESERVE invariants — all untouched here but assert in review: trust gate (retrieval.ts), execution-mode safety + the blocked-actions overlay (Stage 730-735) still render over the full-bleed product, cost telemetry (cite/cost events), zero-gap assembler, prompt-golden (no llm.ts edit — eval-prompts 20/20 unaffected since this is desktop-only).
- Talk-WITHOUT-journey stays qa (no journeyId) — confirm interactive voice Q&A still gets the chat panel; surface keys off isJourneyWalk which already requires target.journeyId.
- Eval coverage: this is UI-only (no engine), so eval:phase24 (walk events) is unaffected; add a desktop render smoke/snapshot for both surfaces since there's no UI eval harness today.

## Appendix — Pillar 4 — First-Word Latency  ·  effort M

**Current state.** First audio on a journey WALK launch is ~8-15s of dead air, gated behind a fully SERIAL cascade. Talk wiring: runtime.tsx StartExperience.launch ~1296-1300 → onApply(setTarget)+onLaunch(setMode('talk')); effect runtime.tsx:1479-1483 fires on tkey → startVoice (1416-1426) does an IPC voiceToken fetch THEN new VoiceClient + vc.connect() (WS open is the first network hop, only AFTER select). Engine startVoiceSession (voice-session.ts:47-74) runs bootSession SERIALLY (live-session.ts:103-159): products name query (103) → getJourneyById (119; its own LEFT-JOIN query journeys.ts:96-103) → getStakeholderRegistry (126) → createDemoSession (140) → loadSessionState (149). Then voice-session.ts:212 RE-RUNS journeyWalkPlan which RE-CALLS getJourneyById (journeys.ts:130) + per-workflow node_sequence query (136) + per-knowledge content query (144) — all serial, nothing pre-staged on select. Only THEN speakColdStartBridge() (voice-session.ts:256-261, audit #15) emits a templated no-LLM opener — the one fast beat today, but composed AFTER the whole boot+plan cascade, not aligned to select. Step 0 then runs runWalkStep→walkOneStep→runTurn(stream:true)→graph.invoke: whoSpeaks→interpret→retrieve→navigate→narrate. interpret (llm.ts:399-429) is the worst critical-path offender: currentModel() (Opus), NO thinking param so the SDK default ADAPTIVE thinking is on, blocking create() (no streaming), max_tokens 2048 — and its intent is THROWAWAY on a walk step (the journey forces the screen via targetLabel; retrieval relevance is ignored, graph.ts:314,450). retrieve (graph.ts:72-83) does a Voyage embed HTTP round-trip (embeddings.ts:23-29 via retrieval.ts:146) then pgvector ORDER BY embedding&lt;=&gt;$1 (retrieval.ts:69-83). navigateJourneyStep already does narration right: nodeNarrationFacts prelude + Promise.all([driveTo, narrate-streaming]) (graph.ts:281-285), narrate already has thinking OFF (llm.ts:624-655), answerAs streaming already disables thinking (llm.ts:591-608). Client audio is already pre-warmed (voice-client.ts:43-54, #15). Residual budget BEFORE: serial boot DB ~0.6-1.2s + journeyWalkPlan DB ~0.3-0.8s + WS-open-after-select + interpret-with-thinking ~3-6s + embed+pgvector ~0.3-0.6s — all BEFORE navigate/narrate begin → first grounded word ~8-15s.

**Target state.** First WARM word &lt;~1.2s from the select click, with grounded step-0 narration arriving moments later WITHOUT a silent gap. (1) On select (launch() click) fire a PREFETCH to the engine (/prewarm?journeyId=) that in PARALLEL: resolves product+journey+committee (the three independent boot reads), computes journeyWalkPlan ONCE, reads step-0 selectors/route + screenFacts + the step-0 knowledge chunk, and embeds the step-0 intent query — cached keyed by journeyId during the ~few-hundred-ms before the WS handshake settles. (2) The #15 cold-start bridge becomes the REAL first beat, emitted the INSTANT the WS is ready (before bootSession's non-essential reads finish), TTS'd from the pre-warmed AudioContext → first word ~0.6-1.2s after select; it still states only intent+'loading' (honest, no product claims, no number). (3) interpret is SKIPPED on a walk-advance turn (journeyAdvance=true; the journey owns the screen); when interpret IS needed (off-script turns) it runs thinking-DISABLED + first-token-fast (parity with narrate/answerAs). (4) The step-0 grounded narration (narrate, already streaming + no-thinking) composes from the PREFETCHED facts/selectors/embedding, so it begins the moment the bridge's last sentence flushes — the bridge buys exactly the time the grounded line needs. (5) client-nav stays default in the buyer path (driveTo clientNav branch graph.ts:123-145) so no server Playwright is on the first-word path. Budget AFTER: select→bridge first word ~0.6-1.2s; bridge→grounded step-0 narration ~1.5-2.5s (overlapped, no silence); per-step (steps 1..n) drops ~3-6s because interpret leaves the walk path and boot is amortized.

**Exact seam.** FOUR seams, all flag-gated (PREWARM_JOURNEY / WALK_SKIP_INTERPRET; default off → byte-identical to today), strangler-style, no rewrite. SEAM A (parallelize boot): live-session.ts bootSession 103-159 — wrap the three INDEPENDENT reads (products name 103, getJourneyById 119, getStakeholderRegistry 126) in one Promise.all; createDemoSession (140)+beginCostSession (141) stay after (need productId/Name); loadSessionState resume (149-159) is best-effort and can ride the same Promise.all. SEAM B (prefetch cache + dedupe): add module-level bounded TTL/LRU Map&lt;journeyId,{journey,plan,step0Facts,step0Selectors,step0Embedding}&gt; populated by a NEW exported prewarmJourney(journeyId,productId) in journeys.ts (extends journeyWalkPlan 129-171 to also resolve step-0 nodeNarrationFacts via graph-elements.nodeNarrationFacts + step-0 embedding via embeddings.embed); journeyWalkPlan (130) and navigateJourneyStep (graph.ts:238) READ the cache when present (hit = skip the duplicate getJourneyById at journeys.ts:130 and the duplicate plan build at voice-session.ts:212). Trigger from desktop on select: runtime.tsx StartExperience.launch ~1296-1300 fire-and-forget IPC/HTTP to /prewarm, AND/OR startVoiceSession (voice-session.ts:50) calls prewarmJourney before bootSession's non-essential reads. SEAM C (kill interpret on walk turns; stream off-script): graph.ts — in the interpret node / navigate path, when state.journeyId && state.journeyAdvance SHORT-CIRCUIT interpret (graph.ts:314 already gates the screen on journeyAdvance not interpretation); for off-script add a thinking-disabled + first-token-fast interpret variant in llm.ts:399-429 (mirror answerAs:591-597: pass thinking:{type:'disabled'} — interpret returns structured JSON so this is thinking-off + fast first token, not sentence streaming). SEAM D (bridge time-alignment): voice-session.ts:256-267 — emit speakColdStartBridge() right after send({type:'ready'}) (:74), BEFORE awaiting the non-essential boot reads, queued on ttsChain ahead of runWalkStep (already the :267 ordering) so its TTS overlaps the grounded compose. PRESERVE untouched: retrieval.ts gate (gateForVector 60-125, chunkPassesGate 132-142), safety.ts execution modes, cost.record/recordVoice (prewarm embed MUST go through embeddings.embed which already records), the assembler/journeyWalkPlan consume-only discipline (prewarm READS, invents nothing), and the prompt-golden invariant (interpret thinking-off is a request PARAM change, NOT a prompts.ts/rp() edit → eval-prompts.ts stays 20/20).

**Reuse:**
- audit #15 cold-start bridge (voice-session.ts:256-261) — becomes the REAL first beat, just emitted earlier + time-aligned, no wording change
- voice-client.ts #15 pre-warmed AudioContext (43-54) — already removes audio cold start; nothing to change
- narrate streaming + thinking-OFF path (llm.ts:624-655) and answerAs streaming + thinking-disabled path (llm.ts:591-608) — proven patterns to copy for the off-script interpret variant
- Promise.all([driveTo, narrate]) concurrency + nodeNarrationFacts static prelude in navigateJourneyStep (graph.ts:281-285) — already the right shape; prefetch just feeds it warm inputs
- journeyWalkPlan consume-only plan build (journeys.ts:129-171) — EXTENDED into prewarmJourney, not replaced
- embeddings.embed (embeddings.ts:23) — reuse for the prefetched step-0 vector so cost.record still fires
- launcher onApply/onLaunch select hook (runtime.tsx:1296-1300) — natural prefetch trigger point
- flushSentences sentence segmenter (llm.ts:352) for any streaming path

**Replace:**
- interpret default ADAPTIVE thinking + blocking create() (llm.ts:399-429): REMOVE interpret from the walk-advance critical path entirely; on off-script turns replace with thinking:{type:'disabled'} + first-token-fast
- SERIAL boot cascade (live-session.ts bootSession 103-159): replace sequential awaits of the independent reads with one Promise.all
- duplicate getJourneyById + full plan rebuild at voice-session.ts:212 (re-running journeys.ts:130-171 after boot already loaded the journey at 119): replace with a cache read populated by prewarmJourney
- bridge emit ordering (voice-session.ts:267, currently after the whole boot+plan): replace with an emit right after {type:'ready'} (:74), decoupled from non-essential boot reads

**Add:**
- prewarmJourney(journeyId,productId) in journeys.ts — resolves journey+plan+step-0 facts/selectors+step-0 embedding into a bounded TTL/LRU module-level cache keyed by journeyId, invalidated on journey edit
- a /prewarm engine route (apps/engine) the desktop hits fire-and-forget on select, OR startVoiceSession calling prewarmJourney before bootSession's non-essential reads
- PREWARM_JOURNEY / WALK_SKIP_INTERPRET env flags (default off → byte-identical to today) so the pillar ships dark and flips on after eval
- a thinking-disabled + first-token-fast interpret variant in llm.ts for the off-script path
- a first-word latency BUDGET + per-step latency assertion in the journey-aware eval (eval:phase24/phase22) measuring select→first say_chunk and step→first say_chunk
- a 'prewarm hit/miss' trace line so a cache miss degrades VISIBLY to today's path, never silently

**Risks:**
- Prompt-golden: interpret thinking-off must be PARAM-only — if sysInterpret/prompts.ts is edited the eval-prompts.ts 20/20 byte-identity breaks; keep prompt spans untouched (MEMORY: run eval-prompts after any llm.ts prompt edit)
- Skipping interpret on walk turns must NOT skip govern/explain/resume routing for off-script utterances — only journeyAdvance=true is throwaway; an off-script mic question still needs interpret (graph.ts:314 is the guard boundary)
- thinking-off interpret could degrade intent on the OFF-SCRIPT path; MEMORY notes phase1 saw Haiku intent mis-GATE a core question — eval that thinking-off Opus interpret doesn't regress the trust gate (it's a param not a model swap → lower risk, still test)
- Prefetch cache staleness: a journey edited between select and walk must invalidate (tie to updateJourney version bump or short TTL) or the walk drives a stale plan — degrade to live journeyWalkPlan on miss
- Cost telemetry: prefetched embed/LLM calls MUST flow through cost.record/recordVoice or per-session cost under-counts — route prewarm through embeddings.embed (already records), never a raw client call
- Honesty: the bridge now speaks before any retrieval — preserve the audit #15 discipline (intent+loading only, no fabricated claim/number)
- Promise.all boot must keep the early-return contract (unknown product/journey → null/degrade, live-session.ts:105) and not crash on a rejected member; getJourneyById/registry are already try/caught (117-138) — keep that
- Engine is long-lived: the module-level cache must be bounded (TTL/LRU) so it can't leak across many sessions

## Appendix — Pillar 5 — Migration / Strangler-Fig + Reuse Ledger  ·  effort XL

**Current state.** Today the "consultant" is a STATELESS one-LangGraph-loop Q&A engine (src/core/graph.ts buildGraph→MemorySaver) invoked once per turn via runTurn (src/core/live-session.ts:210). The journey WALK is bolted on: navigateJourneyStep (graph.ts:237) reads a position-indexed playlist (journeys.ts journeyWalkPlan→WalkEntry[], arcRole/narrated assigned by POSITION in the plan, lines 153-169) and emits ONE narrate() line per advance:true turn. The walk is OPERATOR-PACED by an external gate: desktop sends {type:'journey_next'} (voice-client.ts:108 next()) → voice-session.ts:222 runWalkStep → shared runWalkStep (live-session.ts:433); auto-advance is faked client-side by a content-aware setTimeout dwell keyed on turn_done (runtime.tsx:1490-1512), and barge-in is a stash-and-replay around the `answering` mutex (voice-session.ts:59,200). Speech is per-sentence TTS; first-word latency = full DB boot + first LLM narrate + nav + TTS, papered over by a templated cold-start bridge (voice-session.ts:256). Surface is chat-panel-first (RightPanel/Convo), collapsed for full-bleed walk. There is NO facilitation runtime: src/core/ has only driver.ts (browser adapters), no runtime/facilitation/speech module. Per-journey config lives in `journeys` (mig 0021/0025) + `demo_sessions.journey_id` (mig 0026); session state persists via mig 0029 (SessionStateSnapshot: journeyStep/currentPosition/sessionStatus). eval:phase24 (eval-phase24.ts) validates the SHIPPED runWalkStep + graph-owned journeyStep monotonicity in deterministic clientNav mode.

**Target state.** A dedicated AI-Consultant Runtime (continuous-speech, mode-aware, STATEFUL facilitation) runs ALONGSIDE today's walk, selected PER SESSION by a flag, falling back byte-for-byte to runWalkStep when off. The runtime owns its own facilitation state machine (greet→frame→demonstrate→handle-interrupt→prove→advance→close + paused/recover), drives continuous speech (it decides WHEN to speak/pause/yield, not an external journey_next gate), and self-paces (replacing the client setTimeout dwell). It still CONSUMES the same validated assets through the same seams: retrieveAndGate trust gate, classifyAction/permits safety, record() cost, the assembled journey plan as a facilitation SCRIPT (not a position-indexed playlist), and narrate/answerAs prompts unchanged. Migration target = the runtime is the demo path for flagged journeys/products; the old playlist+gate path is dead-code-eligible only after the runtime clears the same eval bar on all real products. Reached in independently-demoable, reversible increments — never a big-bang rewrite.

**Exact seam.** Single entry seam: runWalkStep (live-session.ts:433) and runTurn (live-session.ts:210) are the ONLY two functions both walk callers go through (voice-session.ts:13 imports runWalkStep as walkOneStep; eval-phase24.ts:13 imports both). Build the runtime BEHIND this seam: (1) New module src/core/consultant-runtime.ts exporting runConsultantStep(ctx, plan, stepIndex, emit, opts) with the SAME signature/return ({journeyStep,isComplete}) as runWalkStep — so voice-session.ts + the eval swap one import with zero call-site churn. (2) Flag selection in bootSession (live-session.ts:90-162): add runtimeMode:'walk'|'facilitation' to SessionCtx (live-session.ts:47) resolved from a new nullable journeys.facilitation column (mig 0030, default off) OR env PO_VIN_FACILITATION, defaulting to 'walk' → existing behavior unchanged when unset. (3) Inside runConsultantStep, REUSE ctx.graph.invoke (the same graph) for retrieve/navigate/safety/cost, but drive a facilitationState (new REPLACE-reducer channel in state.ts DemoState, persisted via mig 0029 SessionStateSnapshot extension in session.ts:69) instead of the bare journeyStep counter. (4) Plan stays journeyWalkPlan's WalkEntry[] initially; EVOLVE it by adding a facilitation-script projection beside walkStepView (journeys.ts:178) keeping arcRole but adding state transitions, computed from the assembler's dramatic arc (journey-assembler.ts:134-155) which ALREADY orders pain→stakes→show→proof→close. (5) Continuous speech reuses the existing onDelta sink threaded through runConfig (live-session.ts:230) + narrate/answerAs (llm.ts:596,635 flushSentences); TTS transport (voice-session.ts ttsChain/openTurnWs) is untouched. Desktop auto-advance setTimeout (runtime.tsx:1490) becomes a no-op when runtimeMode='facilitation' (runtime self-paces, emitting journey_step), gated on existing isJourneyWalk/autoWalk flags.

**Reuse:**
- TRUST GATE — retrieval.ts retrieveAndGate/gateForVector/chunkPassesGate + CONFIDENCE_THRESHOLD/RELEVANCE_MAX_DISTANCE (the 4-gate check); runtime calls graph.invoke which routes through the retrieve node (graph.ts:72)
- SAFETY — safety.ts classifyAction (fail-closed MUTATING regex) + permits (default-deny per mode), reached unchanged via driveTo→driver.scanActions (graph.ts:156); execution mode stays operator-selected per session (live-session.ts:45 SELECTABLE_MODES)
- COST — cost.ts record()/beginCostSession/sessionCost + recordVoice; per-call cost_events fire inside answerAs/narrate (llm.ts:603,641) and navigate (graph.ts:151) regardless of caller
- KNOWLEDGE + zero-gap assembler discipline — journey-assembler.ts assembleJourney stays a consume-only downstream scorer writing ONLY journey+gap_records; runtime never creates assets, only consumes the assembled plan
- GRAPH NODES for nav/retrieve — whoSpeaks/interpret/retrieve/navigate/driveTo/selectNavigation/discover/explain/resume/govern (graph.ts) reused verbatim; runtime invokes the SAME buildGraph()
- PROMPT-GOLDEN — llm.ts sysNarrate/sysAnswerAs via rp() (the 27 verbatim spans proven byte-identical by eval-prompts.ts 20/20); runtime composes speech ONLY through these, never new prompt text
- CHECKPOINTER + RC-30 resume — graph MemorySaver + session.ts saveSessionState/loadSessionState (mig 0029) for cross-process resume; runtime extends the same snapshot, not a new store
- journey_step/journey_complete EVENT contract + walkStepView teleprompter (journeys.ts:178) — desktop reducer (runtime.tsx:880) already consumes these; runtime emits the same events

**Replace:**
- OPERATOR-PACED GATE — {type:'journey_next'} (voice-client.ts:108) + the client setTimeout content-aware dwell (runtime.tsx:1490-1512): runtime self-paces and decides advance/pause/yield; journey_next becomes an OPTIONAL manual override, not the pacing engine
- POSITION-INDEXED ARC — arcRole/narrated assigned by plan POSITION in journeyWalkPlan (journeys.ts:153-169): replaced by facilitation-state transitions (a beat's role comes from the state machine + assembler arc, not its array index), so an off-script detour or skipped transit re-plans rather than mis-indexing
- PER-TURN STATELESS INVOKE as the demo driver — one graph.invoke per advance:true turn with only journeyStep persisted (live-session.ts:231): runtime holds facilitationState across turns (greeting/framing/proving done; open threads) so it doesn't re-narrate the opener or repeat (the audit's #1 repetition tell)
- CHAT-FIRST SURFACE as the conduit — RightPanel/Convo as the primary read (runtime.tsx:219): for a facilitation session product-full-bleed + ephemeral caption is primary, transcript secondary (the stop-the-bleed pass started this; finish it for the runtime path)
- STASH-AND-REPLAY barge-in around `answering` (voice-session.ts:59,200) AS the interruption model: superseded by a real handle-interrupt STATE (answer, mark thread open, resume the SAME facilitation state); the mutex stays for transport serialization but no longer defines facilitation semantics

**Add:**
- src/core/consultant-runtime.ts — runConsultantStep(ctx, plan, idx, emit, opts) with runWalkStep's exact signature; owns the facilitation state machine; calls ctx.graph.invoke for nav/retrieve/safety/cost; flag-gated, falls back to runWalkStep when runtimeMode!=='facilitation'
- state.ts DemoState — a REPLACE-reducer facilitationState channel (current state + done-flags + open threads), persisted via session.ts SessionStateSnapshot (mig 0029 jsonb-merge, RC-30 resume) — NO new store
- migration 0030 — nullable journeys.facilitation boolean (default false) so the runtime is opt-in PER JOURNEY; SessionCtx.runtimeMode (live-session.ts:47) resolved from it (or env) in bootSession
- journeys.ts facilitationScript projection beside walkStepView — maps the assembler's pain→stakes→show→proof→close arc (journey-assembler.ts:134-155) to state transitions; keeps WalkEntry as the asset reference, adds state edges (consume-only)
- src/core/eval-phase25.ts — DETERMINISTIC facilitation eval (clientNav, no TTS/mic, like phase24): (a) state-machine — drive a fixed transcript [advance, off-script Q, advance, pause, continue, advance], assert open→frame→demonstrate→handle-interrupt→resume→close with NO repeated opener, journeyStep monotonic, off-script consumes no step (mirrors phase24:69-100); (b) continuous-speech — capture onDelta/say_chunk order, assert sentences stream in order, narration clean (reuse phase24:50), a paused state emits no narration; (c) FIRST-WORD LATENCY — fake-clock the first emit, assert time-to-first-say_chunk is bounded (cold-start bridge or first streamed sentence fires before the first nav completes); recordEvalRun('phase25',...) (eval-record.ts:4)
- desktop runtimeMode awareness — when ctx.runtimeMode==='facilitation', disable the auto-advance setTimeout (runtime.tsx:1490) and show Pause/Resume instead of 'Next ▶' (runtime.tsx:1707); reversible by the same flag

**Risks:**
- DUAL-PATH DRIFT — runtime and runWalkStep diverge and eval validates only one (the walkJourney-vs-runWalkStep orphan bug the memory + journeys.ts:177 call out). DE-RISK: keep ONE shared body (runConsultantStep delegates to runWalkStep when flag off) and run BOTH phase24 (walk) + phase25 (facilitation) in CI on every real product; gate the engine deploy on both green
- SAFETY/TRUST BYPASS — a continuous-speech runtime could speak ungated facts or skip the compliance gate (live-session.ts:288). DE-RISK: route every spoken fact through graph.invoke→retrieve + answerAs/narrate (no new prompt text), preserving prompt-golden (eval-prompts.ts) + the compliance/escalation path; phase25 asserts no spoken line bypasses hasSource gating
- FIRST-WORD LATENCY REGRESSION — moving pacing into the runtime can stall before sentence 1 if state setup blocks. DE-RISK: reuse the concurrent onDelta streaming (live-session.ts:230) + cold-start bridge (voice-session.ts:256); phase25 bounds time-to-first-say_chunk so a regression fails CI deterministically
- FLAG-MATRIX BLOWUP — runtimeMode × execution-mode × clientNav × stream × barge-in is a large surface. DE-RISK: default OFF per journey (mig 0030), enable on ONE assembled PO.vin journey first, demo it, then widen; every increment reversible by flipping the column
- CHECKPOINTER DESYNC — adding facilitationState as an append vs REPLACE channel could double on RC-30 rehydrate (the contextStack/trace lesson, live-session.ts:148). DE-RISK: facilitationState MUST be a REPLACE reducer; only REPLACE channels are re-seeded (live-session.ts:152-157); phase25 round-trips it through save/loadSessionState like phase24:106-115
- OFF-SCRIPT RE-PLAN — the machine must resume the SAME state after an interrupt without re-narrating done beats (the repetition tell). DE-RISK: facilitationState carries done-flags + recentNarrations (already threaded, graph.ts:252); phase25 asserts no repeated opener across an interleaved off-script turn

---

## P1-VOICE-DARK — STAGING-SMOKE CHECKLIST (the real-audio un-gate)

**Why a checklist, not an eval:** the continuous-speech ON path (real audio out, mic in, the Anthropic SDK `.stream()` sentence transport) CANNOT run under local Node 26 — `.stream()` crashes with an uncatchable socket error there (NOT a prod bug; the deployed engine pins an older Node), and there is no audio device / Google STT-TTS creds locally. So the orchestration BRAIN is unit-proven here and the live AUDIO behavior is gated by this manual staging smoke.

**Already SHIPPED + verified (dark / flag-OFF byte-identical):**
- `SpeechDriver` (src/core/speech-driver.ts) — utterance coherence + barge stash + beat completion marker (the coherence consolidation target the staging migration adopts) + the PURE shipped decisions `shouldContinueWalk(...)` (the auto-advance guard the runtime calls) and `needsRepair(status)`. Unit: `eval:phase25` 24/24, `eval:phase29` 21/21 (needsRepair provider-parity; shouldContinueWalk every term incl. final-beat termination + the no-progress guard; barge/stash/TTL coherence; a faithful shipped-lifecycle continuous-walk sim).
- Repair BRAIN — `llm.repairStreaming()` + `onComplete(CompletionStatus)` on both providers. LIVE-verified by `eval:repair` 8/8 (real Anthropic API).
- AUTO-ADVANCE wiring — `voice-session.ts runWalkStep` finally: behind `SPEECH_DRIVER`, it calls `shouldContinueWalk({ stepOk, advanced, interrupted, replayed })` — auto-advancing only on a clean, NON-FINAL step that moved the position strictly FORWARD, with no barge-in and no replay (continuous walk). OFF (default) = operator/client-paced exactly as today (the branch never runs).

**Flags:** `SPEECH_DRIVER` (truthy = on; OFF/`0`/`false` = today). Interacts with `ELEVENLABS_WS` (word-level TTS) — test each independently first.

**Un-gate procedure (staging engine + a mic + an assembled PO.vin journey):**
1. **Baseline (flag OFF):** confirm the journey voice-walk runs exactly as today — operator/client `journey_next` per step. (Proves OFF is untouched.)
2. **Turn `SPEECH_DRIVER` on** for the staging engine. **CRITICAL:** turn the desktop's client-side `autoWalk` OFF first (runtime.tsx) — server-owned auto-advance + client auto-`journey_next` would double-advance/race.
3. **Auto-advance:** launch the journey; the walk should self-advance beat→beat with NO `journey_next` from the client. ✅ each beat plays once, in order; ✅ the walk reaches `journey_complete`; ✅ NO step skipped or doubled.
4. **First-word latency:** time launch → first audible word. Target ≲1.2s (cold-start bridge + parallel boot + concurrent `onDelta` streaming). ✅ no long dead-air before sentence 1.
5. **Continuous speech:** ✅ no two-burst stutter (bridge→silence→narration); audio is continuous across beats.
6. **Repair (forced cut-off):** force a `max_tokens`/truncated narration. ✅ the runtime speaks a short continuation (`repairStreaming`) instead of leaving half a sentence into silence. (Requires the repair-into-TTS wiring below.)
7. **Barge-in mid-beat:** speak over a beat (mic_start). ✅ TTS stops immediately; ✅ the question is answered (off-script, consumes no journey step); ✅ the walk RESUMES at the right step afterward; ✅ no stale audio from the superseded beat.
8. **No double-speech:** ✅ a streamed (`say_chunk`) line is never re-spoken as the full `message`.
9. **No leaked audio:** ✅ no audio frames arrive after `turn_done` / after a barge-in flush.
10. **Trust/cost intact:** ✅ the trust panel still cites sources; ✅ cost events still record STT/TTS. (The runtime routes every spoken fact through the same `graph.invoke`→retrieve→answerAs/narrate — no new prompt text; `eval-prompts` golden stays 24/24.)

**Remaining wiring to ACTIVATE before step 6 (repair-into-TTS — staging-gated, brain already shipped):** thread `onComplete(CompletionStatus)` from `narrate`/`answerAs` (llm.ts, already accepts it) through the per-invoke `GraphRunConfig` (graph.ts) into `voice-session.ts`, where on `needsRepair(status)` the runtime calls `llm.repairStreaming(partialText, kind)` and feeds the continuation into the SAME `ttsChain` (after the cut-off sentence, before the next beat). Additive + flag-gated like the auto-advance branch; it could not be unit-verified locally (needs the live `.stream()` transport), so it is specified here rather than shipped blind. The DECISION (`needsRepair`) and the brain (`repairStreaming`) are both already verified — only the stream-injection plumbing remains, to be landed + smoked together on staging.

**Rollback:** flip `SPEECH_DRIVER` off — instant return to operator/client-paced behavior (byte-identical). Every step above is reversible by the flag.

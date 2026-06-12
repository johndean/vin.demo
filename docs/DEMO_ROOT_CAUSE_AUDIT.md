# VIN AI DEMO — ROOT-CAUSE INVESTIGATION

**Date:** 2026-06-12 · **Method:** 6 parallel code-forensic investigators (planning/agentic, voice/verbosity, navigation/action, screen-awareness/state, knowledge/outcome, hallucination/recovery/UX), every finding traced to `file:line` in the live tree. Three load-bearing P0/P1 claims independently re-verified by direct read.

**Scope of evidence:** static code. Live spoken transcripts (`ai_calls`, mig 0027) and empirical run telemetry (`navigation_attempts`, mig 0019) were **not** queried — every latency/rate figure here is derived from call structure, `max_tokens`, and generation settings, and is labelled as such. Nothing was fabricated.

> **Note on the prior "demo 100% failure" fix.** The previous session fixed the *silence* (Studio→Neural2 voice + empty-audio fallback) and *bounded* the dropdown loop + GL mis-pick. Those fixes are real and live. This audit looks **underneath** them: why the experience is still slow, verbose, and fragile even when audio works and the loop is bounded. The earlier fixes treated symptoms on two of the surfaces below; the root causes are architectural.

---

## 1. EXECUTIVE SUMMARY

The demo's problems are **not primarily a voice problem.** Voice is the surface where three deeper architectural faults become audible. The single sentence that explains most of what the founder experienced:

> **There are two separate brains that do not share state — the brain that can *see* the live screen has no durable memory, and the brain that *has* memory never looks at the screen — and the spoken layer on top of both is generated in a mode (no-streaming, thinking-off, 900-token budget, mandatory per-step narration) that is verbose and slow by construction.**

Everything else is a consequence.

**The two brains (the keystone):**
- **Brain A — Conversational/Journey** (`graph.ts` + `DemoStateT`, LangGraph-checkpointed, threaded through `live-session.ts`). It has real, well-reduced state (lifecycle, breadcrumb, stakeholder, confidence) — but it **never reads the live DOM.** Its "current screen" is `out.navAction?.label ?? 'the relevant screen'` (`graph.ts:191`), and in client-nav mode it hardcodes `navigation.ok = true` (`graph.ts:126`) without ever checking the page loaded.
- **Brain B — Live-Drive** (`driveGoal` in `runtime.tsx` → `/agent/step` → `agentStep` in `llm.ts`). It is the **only** path that perceives the live page, and it is **stateless per call**: its entire memory is `goal + page snapshot + last 12 narration strings` (`llm.ts:89-100`, `index.ts:306`). No `DemoStateT`, no journey, no checkpointer, no field-completion plan.
- They share a `sessionId` — but it is only a **billing/audit tag** (`index.ts:320,368`), not a shared-state key. The journey, outcome, discovery, and breadcrumb that Brain A computes are invisible to Brain B.

**Why it's verbose/slow (independent of the two-brain split):**
- **No streaming.** Every spoken turn is a blocking `messages.create` (`llm.ts:410,443`); TTS cannot start until the *whole* reply is generated (`voice-session.ts:46-65`). Time-to-first-word = full LLM latency + first TTS round-trip, serialized.
- **Thinking is off.** No `thinking` field is set anywhere in `ClaudeProvider`. On Opus 4.8 that means the model **writes its reasoning into the visible (spoken) answer** — the documented behavior of disabled thinking on 4.8. This is the verbosity engine.
- **Essay-sized budget + mandatory narration.** `answerAs` allows `max_tokens: 900` (≈4-6 min of speech) while `agentStep` forces a spoken sentence on *every* action ("Always narrate `say`", `prompts.ts:208`).

**The product's hardest promise has a hole.** The read-only safety guarantee is enforced by a classifier — but **only for `click`** (`index.ts:334`). A mutating option committed through a combobox/`select` (`__vinCombo` fires real DOM events) is never classified or blocked, in any mode. **P0.**

**The deepest knowledge is invisible at demo time.** The platform painstakingly models every page's fields/buttons/actions/permissions (`demo_graph_node_elements` + `page_facts`, mig 0023) — and **no runtime path ever reads it.** `selectFromGraph` selects only label/route/locator/persona (`graph-lifecycle.ts:401-412`). The AI navigates to a screen it cannot describe.

**Net verdict on the headline claim "the Journey drives a live demo":** True for a clean, uninterrupted, voice-only happy path. It **desyncs the moment a buyer asks a question** (two journey-position counters, `walkStep` vs `state.journeyStep`, never reconciled — caption and screen drift apart), is **silently inert in ASK mode**, and the eval that certifies it (`phase24`) exercises a code path (`walkJourney`) that **the desktop never runs**. The navigation *primitives* are sound; the failure is concentrated in **state ownership**.

**Scores (qualitative, justified in §s below):**
- **Time-to-First-Value:** ~10-25s warm, longer cold — *not* reliably sub-30s, bottlenecked by live-product login + first (blocking, thinking-off) narration + TTS, and the gap is **unmasked** (static "Preparing the journey…").
- **Value Density:** LOW by construction — thinking-off reasoning leak + 900-token budget + mandatory step narration. Good brevity *instructions* exist (`prompts.ts:120-122`) but fight the generation config.
- **Demo Friction:** LOW-MEDIUM — structurally good launcher (one click, modes hidden, product-first, operator-paced), pulled up by connect dead-air and launchable-broken-journeys.
- **Demo Expert vs Documentation Reader:** **Demo-Expert only on the scripted journey walk**; a **Documentation Reader** on the off-script interactive path that decides real deals (no outcome/objection in `answerAs`; top-1-chunk; "answer and stop, no value-pitch").
- **Awareness:** REAL-but-shallow where it drives (affordances + headings + boolean `filled`, never values/content); FAKE where it talks.
- **State:** FRAGMENTED — coherent inside Brain A, effectively absent in Brain B, unshared between them.

**The good news, stated plainly:** the navigation selection engine (graph/workflow, self-healing locators), the safety classifier (for clicks), the confidence/trust gating on retrieval, the observation/telemetry layer, and the launcher UX are all genuinely sound. The fixes below are concentrated and mostly additive — this is a *wiring and configuration* problem far more than a *rebuild* problem.

---

## 2. ROOT CAUSES (evidenced)

IDs are stable and referenced by every category list below. I list the **42 genuinely-evidenced** root causes. I have **not** padded to 50 — the investigation constitution forbids generic observations, and 8 invented items would be exactly that. These 42 are real, each with a `file:line` anchor.

### P0 — Demo blockers

| ID | Root cause | Evidence |
|----|-----------|----------|
| **RC-01** | **Two disjoint brains, fragmented state ownership.** Conversational/journey brain (LangGraph + `DemoStateT`, checkpointed) and live-drive brain (`driveGoal`→`/agent/step`, stateless) do not share state; `sessionId` is only a billing/audit tag. | `llm.ts:89-100`; `index.ts:320,368`; `graph.ts:394`; `state.ts:38-113` |
| **RC-02** | **Dual journey-position counters desync on interruption.** The spoken caption is driven by `walkStep` (a WS closure var) while the on-screen node is driven by `state.journeyStep` (checkpointer); a third mirror `live.journeyStep` lives in the desktop reducer. No reconciliation → caption and screen drift apart after the first off-script question. | `voice-session.ts:92,108,110` vs `graph.ts:223,228`; `runtime.tsx:1547` |
| **RC-03** | **No streaming on spoken turns.** Every utterance is a blocking `messages.create`; TTS can't begin until the whole reply is generated. Dominant cause of "slow." | `llm.ts:410,443`; `voice-session.ts:46-65`; `segmenter.ts:4` |
| **RC-04** | **Thinking disabled on Opus 4.8 → reasoning leaks into spoken text.** No `thinking` field anywhere in `ClaudeProvider`; on 4.8 this produces longer visible answers — which are spoken verbatim. Dominant cause of "verbose." | `llm.ts` (no `thinking`/`adaptive`/`effort`); spoken at `live-session.ts:230`→`voice-session.ts:63-65` |
| **RC-05** | **`select`/`type` bypass the mutation classifier.** Only `click` is gated; a mutating option committed via combobox/`select` fires real DOM events with no `classifyAction`/`permits` check in any mode. Breaches the read-only guarantee. *(Re-verified by direct read.)* | `index.ts:334` (gate); `index.ts:382` (telemetry only); `runtime.tsx:394` (`__vinClickOpt`) |
| **RC-06** | **Per-element knowledge model is write-only at demo time.** `demo_graph_node_elements` + `page_facts` (fields/buttons/actions/permissions) are populated by seed/autogen but never read by any runtime path. | `graph-lifecycle.ts:379,401-412` (no element join); grep: `page_facts` absent from `graph.ts`/`live-session.ts`/`llm.ts` |
| **RC-07** | **Live-drive loop is stateless by design.** `AgentStepContext` = goal + page + last-12 narration prose. No plan, no field-completion map, no `DemoStateT`. The 32-step cap + repeat-counter are band-aids for missing working state. | `llm.ts:89-100`; `index.ts:306`; `runtime.tsx:1462` |
| **RC-08** | **Perception captures affordances, not content.** `PAGE_SNAPSHOT_JS` returns interactive elements + h1-h3 only; for inputs it captures a **boolean `filled`**, never the actual value, and no body text/table/banner/active-filter. | `runtime.tsx:251-284` |

### P1 — Severe degradation

| ID | Root cause | Evidence |
|----|-----------|----------|
| **RC-09** | **`answerAs` `max_tokens: 900`** — essay-sized spoken budget (~600-700 words) on the most-used spoken path; only prose instruction limits length. `narrate` (160) shows the codebase knows better. | `llm.ts:412` vs `445` |
| **RC-10** | **Mandatory per-step narration.** `agentStep` requires a spoken `say` on every action ("Always narrate `say` in ONE concise sentence"); narrates obvious clicks. | `prompts.ts:208`; `llm.ts:106-107,386` |
| **RC-11** | **Coarse barge-in.** Interruption is a single boolean checked only between sentences; no utterance-cancel handshake → AI keeps talking for a beat over the user. | `voice-session.ts:48,52,128-129,143-145` |
| **RC-12** | **The tested walk path is an orphan.** `walkJourney` (the named keystone, exercised by `eval:phase24`) is **not** what the desktop runs; production uses voice `runWalkStep`. The "6/6 green" validates a path no buyer hits. | `live-session.ts:294` vs `voice-session.ts:100`; `eval-phase24.ts:38` |
| **RC-13** | **Journey-drive is a property of the voice transport only.** ASK/interactive sessions receive `journeyId` but never set `journeyAdvance:true` → a pinned journey is silently inert; typed input is hijacked by `driveGoal`. | `interactive-session.ts` (no journey wiring); `graph.ts:257`; `runtime.tsx:1517,1450` |
| **RC-14** | **No Execution Engine.** The real engine selects a *navigation node*; everything *inside* a screen is per-step LLM value-guessing with no field model. Values are LLM-invented or explicitly "best guess." | `graph-lifecycle.ts:399-433`; `prompts.ts:169,173-174`; `driver.ts:20-25` (no fields) |
| **RC-15** | **Client-side resolvers still guess.** `__vinChoose` empty-want → `opts[0]`; `__vinNative` fires first-enabled fallback **unconditionally** even after a specific want fails. The "return null" fix wasn't mirrored here. *(Re-verified.)* | `runtime.tsx:377,392` |
| **RC-16** | **Journey narration is generative + ungrounded.** `narrate` receives only caption+outcome+audience, **no retrieved content**; null-caption knowledge beats → free improvisation; the journey-advance graph edge skips the confidence gate. Spoken, in the flagship path. | `graph.ts:232,240,388`; `llm.ts:450`; `journeys.ts:119,121` |
| **RC-17** | **Outcome→Committee chain never reaches the interactive answer.** `AnswerContext` has no outcome/objection; `gatherRoom` doesn't read `business_outcomes` or stakeholder `objections`/`decision_criteria`. Outcome injection exists only on the `narrate` walk path. | `llm.ts:54-69`; `live-session.ts:112-138,216-226`; (`narrate` has it: `llm.ts:452`) |
| **RC-18** | **Conversational screen-awareness is FAKE.** "Current screen" is derived from the graph node label; `clientNav` hardcodes `navigation.ok = true` and never observes whether the click landed or what rendered. | `graph.ts:117-131,191`; `live-session.ts:222`; `state.ts:90-91` |
| **RC-19** | **Dropdown "committed?" is a CSS-class heuristic.** The selected value is never read; `filled` is guessed from sibling/container classes. The bounded retry now converts the infinite loop into a **premature hand-back on a correctly-set field**, and the prompt asks the model to "trust your narration over the screen." | `runtime.tsx:263-280`; `llm.ts:357`; `prompts.ts:203-204`; `runtime.tsx:1503-1505` |
| **RC-20** | **Filter-by-code / match-by-want mismatch + 80-row cap.** Typeahead is filtered by the code token but matched against the full want; the option collection is capped at 80 with no virtualized-list scroll → name-only wants and long (e.g. 302-account) lists still mis-pick or no-match. | `runtime.tsx:372,404,406-409` |
| **RC-21** | **Ask→drive handoff has no shared continuity.** `sessionId` doesn't load `DemoStateT` into the drive loop; the journey/outcome the conversation just established is invisible to the drive. | `runtime.tsx:1478`; `index.ts:320-321,368`; `session.ts:10-15,59-64` |
| **RC-22** | **Drive continuity is reconstructed from prose with unstable refs.** `data-vin-ref` is re-stamped every snapshot, so `ref 7` differs across turns, yet stuck-detection keys on `action:ref:value` and history refers to elements by prose. | `runtime.tsx:260,1497`; `index.ts:306`; `llm.ts:373` |
| **RC-23** | **No multi-chunk synthesis.** `answerAs` is grounded in `retrieved[0]` only; chunks [1..3] are discarded. A two-fact question gets a half-answer. | `retrieval.ts:81`; `live-session.ts:165,221` |

### P2 — Significant

| ID | Root cause | Evidence |
|----|-----------|----------|
| **RC-24** | **No runtime plan object.** Goal/strategy/sequence/success-criteria are not held in state; `successCriteria` is read nowhere at runtime; `journeyWalkPlan` is re-fetched every turn instead of planned once. | `state.ts:38-113`; `journeys.ts` (successCriteria stored, never consumed); `graph.ts:221` |
| **RC-25** | **No post-action verification (open-loop actuation).** `clickRefJs` returns `true` before the click fires (behind a 400ms timeout); driver click-strategy returns `ok:true` on any non-throw. Stuck-detection is the *only* feedback signal. | `runtime.tsx:424`; `driver.ts:176`; `runtime.tsx:1497-1499` |
| **RC-26** | **Mid-walk unreachable node degrades to a silent narration beat.** `navigateJourneyStep` advances and narrates even on a `noMatch`; no live gap event to the operator. | `graph.ts:237-248`; `journeys.ts:113-124` |
| **RC-27** | **Broken journey is launchable.** The "N broken" `cr-jcard` button is not disabled; launch pins it anyway → silent degrade to free-roam in front of the buyer. | `runtime.tsx:1274,1279-1280` |
| **RC-28** | **Connecting/login dead-air, unmasked.** During WS-connect + live-product login + first narration, the strip shows only a static "Preparing the journey…"; `voiceState='connecting'` isn't surfaced. | `runtime.tsx:1326,1554` |
| **RC-29** | **Narration emitted before stuck-detection.** `say(res.say)` fires every iteration before the repeat counter trips → buyer hears up to 3 identical lines before the graceful hand-off. *(Re-verified.)* | `runtime.tsx:1480` (say) before `1497-1504` (dedup/break) |
| **RC-30** | **No cross-process durable state.** `DemoStateT` lives in an in-process `MemorySaver`; the DB row persists only `{id,productId,mode,journeyId,status}`. Redeploy/crash mid-demo resets position/journey/discovery. | `graph.ts:394`; `session.ts:53-57` |
| **RC-31** | **Verified-graph authority is advisory, not enforced.** `knownScreens` is a hint the LLM may ignore; client-nav records `ok:null` so graph-divergent navigation is invisible (no drift detection). | `index.ts:322-327`; `llm.ts:374`; `graph.ts:124` |
| **RC-32** | **Path-A label navigation = shortest-substring match.** "Approve" matches "Approvals"/"Approve & Pay"; shortest-wins is an arbitrary tiebreak with no role/route corroboration; the graph's ordered locators are stripped to id/class on the client path. | `runtime.tsx:531-534`; `graph.ts:120-121` |
| **RC-33** | **Opus 4.8 (highest-latency tier) is the default on the spoken path; no per-function model routing.** Latency-critical `answerAs`/`narrate` use the same model as build-time harvesters. | `settings.ts:36,43`; `llm.ts` (single `currentModel()`) |
| **RC-34** | **Live answer grounding is prompt-enforced, never output-verified.** Build-time harvest has `verifyFaithful`; the live `answerAs` has no equivalent post-check. | `llm.ts:50-53`; `prompts.ts:227-233` (build-time only) |
| **RC-35** | **`agentStep` can act beyond modeled knowledge.** It fills fields from the DOM with "realistic demo values"; the modeled field `detail` (required/validation/visibleTo) is never supplied to it. | `llm.ts:354-405`; `prompts.ts:161-209` |
| **RC-36** | **No data-model and no first-class business-process knowledge category.** Categories are fixed (`docs/faq/sop/release_note/competitor`); process lives only implicitly in workflow `node_sequence`; no entity/relationship store. | `0001_entity_model.sql:65`; `retrieval.ts:38-44` |

### P3 — Optimization

| ID | Root cause | Evidence |
|----|-----------|----------|
| **RC-37** | Speaking rate fixed at 1.0 (executives even slower); MP3 per-sentence decode adds latency. | `profiles.ts:12,14-17`; `tts-google.ts:23` |
| **RC-38** | Temporal stuck-detector exemption is a no-bail trap on custom (non-native) date widgets. | `runtime.tsx:1503,293`; `__vinSetTemporal` native-only |
| **RC-39** | Journey card shows no step count / duration estimate before launch. | `runtime.tsx:1274-1283` |
| **RC-40** | `convo.ts`/`demo.ts` invoke the graph with no journey channels — safe today, fragile as the default (RC-13 came from exactly this pattern). | `convo.ts:35`; `demo.ts:35` |
| **RC-41** | ASK chat panel defaults open during a voice walk, drawing the eye from the product. | `runtime.tsx:1340` |
| **RC-42** | `__vinCombo` "clear query → take any option" comment misstates the now-correct behavior — a re-regression trap. | `runtime.tsx:406` |

---

## 3. TOP ARCHITECTURAL FLAWS

1. **Two brains, one product, no shared state** (RC-01) — the central flaw; everything downstream inherits it.
2. **The brain that sees has no memory; the brain that remembers can't see** (RC-07, RC-08, RC-18) — perception and state are in different processes.
3. **Walk position has three owners and no reconciliation** (RC-02) — `walkStep` / `journeyStep` / `live.journeyStep`.
4. **Safety is bolted to a verb (`click`), not to the resolved DOM target** (RC-05) — mutpotency is a property of the element.
5. **The element knowledge model is write-only at demo time** (RC-06) — deep modeling, zero runtime read path.
6. **Spoken text is generated in a verbose-by-construction mode** (RC-03, RC-04, RC-09, RC-10).
7. **No Execution Engine** — "doing" is navigation + blind field-guessing (RC-14); the graph stops at the screen boundary.
8. **Open-loop actuation** — actions are fired without verifying their effect (RC-25); stuck-detection is the only feedback.
9. **Outcome→Committee→Journey authority terminates at the scripted walk** (RC-16, RC-17) — the off-script path was never wired to the outcome registry.
10. **Journey-drive is a transport property, not a brain property** (RC-13) — only voice sets `journeyAdvance`.
11. **The tested path ≠ the shipped path** (RC-12) — eval confidence is misplaced.
12. **Grounding discipline stops at the engine boundary** (RC-15) — the injected executors re-introduce guesses.
13. **"Current screen" is dead-reckoned, never observed** (RC-18) — narration decoupled from reality.
14. **Continuity reconstructed from prose with unstable identifiers** (RC-22) — refs re-stamped each snapshot.
15. **No durable session state** (RC-30) — process-lifetime-scoped.
16. **No runtime plan/goal/success-criteria object** (RC-24) — the agent reacts; it does not plan-then-check.
17. **Verified-graph authority is advisory, not enforced, on the live drive** (RC-31).
18. **Per-element validation/permission knowledge isn't fed to the executor** (RC-35).
19. **Single-chunk grounding instead of synthesis** (RC-23).
20. **Filter token ≠ match token; option collection capped** (RC-20).

*(20 evidenced architectural flaws; remaining RCs are instance-level rather than distinct architectural defects.)*

---

## 4. TOP UX FAILURES

1. **Connect/login dead-air with no progress affordance** — static "Preparing the journey…" during the multi-second login gap (RC-28). **P2.**
2. **Broken journeys are launchable and silently degrade to free-roam** (RC-27). **P2.**
3. **Buyer sees up to 3 repeated narration lines before the graceful hand-off** (RC-29). **P2.**
4. **Ask→drive feels like two different assistants** — no shared continuity (RC-21). **P1.**
5. **Off-script answers read like a doc-bot, not a consultant** — no outcome/objection framing (RC-17). **P1.**
6. **The AI narrates obvious clicks** ("Now I'll open the form…") (RC-10). **P1.**
7. **Long, unhurried spoken turns the user can't easily cut off** — verbosity (RC-04/09) + coarse barge-in (RC-11). **P1.**
8. **Journey card gives no step/duration cue before committing in front of a buyer** (RC-39). **P3.**
9. **ASK chat transcript defaults open during a voice walk** (RC-41). **P3.**
10. **Time-to-first-value not reliably sub-30s, and the wait is unexplained** (RC-03 + RC-28). **P1/P2.**

*Strengths (kept honest):* one-click launch, modes correctly hidden behind the ⚙ gear, product-first full-frame stage, operator-paced default with opt-in auto-advance, collapsible (non-competing) side panel. The launcher itself is good enterprise UX.

---

## 5. TOP VOICE-EXPERIENCE FAILURES

1. **No streaming → long dead air before first word** (RC-03). **P0.**
2. **Thinking-off → the AI speaks its reasoning** (RC-04). **P0.**
3. **900-token spoken budget on the main Q&A path** (RC-09). **P1.**
4. **Mandatory per-step narration of mechanical actions** (RC-10). **P1.**
5. **Coarse barge-in — keeps talking over the user** (RC-11). **P1.**
6. **Ungrounded spoken narration on knowledge/note beats** (RC-16). **P1.**
7. **Highest-latency model on the spoken path; no per-function routing** (RC-33). **P2.**
8. **Fixed 1.0 speaking rate; MP3 per-sentence decode latency** (RC-37). **P3.**
9. **(Resolved, keep watch)** Studio voices muted the demo; reverted to Neural2 + empty-audio fallback — confirm Studio enablement before re-trying.

*Value-Density verdict:* **VERBOSE by construction.** The brevity instructions are well-written but fight the generation config. `narrate` (160 tokens, tight) is the model for how a spoken turn should be sized; `answerAs` (900) is not.

---

## 6. TOP NAVIGATION FAILURES

1. **Path-A label nav picks the shortest substring match** → wrong control (RC-32). **P2.**
2. **Client path strips the graph's ordered locators to id/class** (RC-32) — self-healing value doesn't reach the live pane. **P2.**
3. **Verified-graph authority is advisory; LLM may ignore `knownScreens`** (RC-31). **P2.**
4. **Client-nav records `ok:null`** → navigation success uncaptured, drift undetected (RC-31). **P2.**
5. **Conversational nav never verifies the click landed** (`navigation.ok=true` hardcoded) (RC-18). **P1.**
6. **Mid-walk unreachable node → silent skip** (RC-26). **P2.**
7. **No post-navigation success assertion on the click-strategy branch** (RC-25). **P2.**
8. **`__vinChoose`/`__vinNative` can navigate/select a wrong or arbitrary option** (RC-15, RC-20). **P1.**

*Capability matrix:* open/switch page & route-based menu nav & open-first-record = **reliable** (Path A `gotoNode` is genuinely self-healing); search/filter/menu-by-label = **fragile**; create/edit/save/multi-step = **fragile**, degrading as form length/value-specificity rise.

---

## 7. TOP KNOWLEDGE GAPS

1. **Field knowledge** — modeled (`demo_graph_node_elements`), never read at runtime (RC-06). **P0.**
2. **Button knowledge** — same (RC-06). **P0.**
3. **Action knowledge** — same (RC-06). **P0.**
4. **Permission knowledge** — `permissions_required` + element `visibleTo` never SELECTed at runtime (RC-06). **P1.**
5. **Screen/page-fact knowledge** — `page_facts` never read (RC-06). **P0.**
6. **Business-outcome knowledge missing from the interactive answer** (RC-17). **P1.**
7. **Committee/objection knowledge missing from the interactive answer** (RC-17). **P1.**
8. **Multi-fact synthesis** — top-1 chunk only (RC-23). **P2.**
9. **Data-model knowledge** — no entity/relationship store at all (RC-36). **P3.**
10. **Business-process knowledge** — no first-class category; implicit in workflows only (RC-36). **P3.**
11. **Quantified outcome narrative** — journey carries a free-text goal, not metric/baseline/target the model reasons over (RC-16/journey-assembler note). **P2.**

---

## 8. TOP STATE-MANAGEMENT FAILURES

1. **Live-drive loop has no durable state** (RC-07). **P0.**
2. **Two brains share `sessionId` but no state** (RC-01, RC-21). **P0/P1.**
3. **Dual/triple journey-position counters, no reconciliation** (RC-02). **P0.**
4. **Outcome / plan / remaining-actions / dependencies not in `DemoStateT`** (RC-24). **P2.**
5. **`successCriteria` read nowhere at runtime** (RC-24). **P2.**
6. **No cross-process durable state** (RC-30). **P2.**
7. **Drive continuity reconstructed from prose; unstable refs** (RC-22). **P1.**
8. **`journeyWalkPlan` re-fetched every turn instead of held** (RC-24). **P2.**

*What `DemoStateT` does track well (kept honest):* lifecycle status, breadcrumb/context-stack, active stakeholder, confidence band, blocked mutations — all correctly reduced and persisted via the checkpointer within Brain A.

---

## 9. TOP ORCHESTRATION FAILURES

1. **Journey-drive only on the voice transport; ASK silently free-roams** (RC-13). **P1.**
2. **Tested walk path (`walkJourney`) ≠ shipped path (`runWalkStep`)** (RC-12). **P1.**
3. **Two walk implementations diverge** (RC-12). **P1.**
4. **`journeyAdvance` decided per-caller at the edge, not centrally** (RC-13, RC-40). **P1/P3.**
5. **Drive loop bypasses the LangGraph entirely** (RC-01) — no shared orchestration. **P0.**
6. **Confidence/compliance gate skipped on journey-advance turns** (RC-16). **P1.**
7. **No reconciliation between verified-graph nav and live-DOM nav** (RC-31). **P2.**

### Agentic component map

| Component | Status | Anchor |
|---|---|---|
| Goal Manager | **DISCONNECTED** | journey `businessGoal`/`successCriteria` stored, not in state; `successCriteria` unused (RC-24) |
| Planner | **PARTIAL** | static authored sequence re-fetched per turn; no free-roam planner (RC-24) |
| Navigator | **EXISTS** | `driveTo`/`pickNode`/`selectFromGraph` — sound |
| Screen Interpreter | **EXISTS (drive path only, shallow)** | `PAGE_SNAPSHOT_JS` — affordances only (RC-08) |
| Execution Engine | **MISSING (as an engine)** | navigation + blind field-fill (RC-14) |
| State Engine | **PARTIAL** | coherent in Brain A; absent in Brain B; duplicated walk counter (RC-01,02,07) |
| Memory Engine | **PARTIAL** | session memory real; no cross-session; drive memory = 12 prose lines (RC-07) |
| Recovery Engine | **PARTIAL** | excellent on graph/engine; reactive + visible seams on drive (RC-25,29) |
| Validation Engine | **PARTIAL** | confidence/compliance gates real; `successCriteria`/live-answer faithfulness unchecked (RC-24,34) |
| Observation Engine | **EXISTS** | trace, audit, cost, nav telemetry, journey runs — sound (though client-nav `ok:null`) |

---

## 10. TOP DEMO-PLANNING FAILURES

1. **No plan object in runtime state** (RC-24). **P2.**
2. **`successCriteria` never checked — the demo can't self-assess its own outcome** (RC-24). **P2.**
3. **Walk plan re-derived each turn rather than planned once** (RC-24). **P2.**
4. **Quantified before/after outcome argument not available to narration** (RC-16). **P2.**
5. **Broken journey launches without pre-flight enforcement** (RC-27). **P2.**
6. **No pre-flight reachability verify against the active graph** (RC-26) — deferred P5 work. **P2.**
7. **Free-roam (the default when no journey) has no plan at all** (RC-24) — reactive `pickNode`. **P2.**

---

## 11. TOP ACTION-ENGINE FAILURES

1. **No Execution Engine; field values are LLM-guessed** (RC-14). **P1.**
2. **`select`/`type` skip the safety classifier** (RC-05). **P0.**
3. **No post-action success verification** (RC-25). **P2.**
4. **Dropdown commit unreadable → premature hand-back** (RC-19). **P1.**
5. **Filter/match token mismatch + 80-row cap → wrong/no pick on long lists** (RC-20). **P1.**
6. **Empty-want → `opts[0]`; native unconditional first-enabled fallback** (RC-15). **P1.**
7. **No field/validation model fed to the executor** (RC-35). **P2.**
8. **Temporal no-bail trap on custom date widgets** (RC-38). **P3.**

*Action behavior (qualitative):* success high for navigation, moderate-to-low for form completion; failures now mostly *honest* (return null / pick='') on coded values, residual *silent-wrong* on name-only wants and native selects; retries bounded (1/2/32-cap); recovery honest but **reactive and visible**, not verified.

---

## 12. TOP SCREEN-AWARENESS FAILURES

1. **Snapshot captures affordances + headings only — no content/values/banners/active-filters** (RC-08). **P1.**
2. **`filled` is a boolean heuristic; the selected value is never read** (RC-08, RC-19) — root of the dropdown loop. **P1.**
3. **Conversational "current screen" is FAKE (graph-label-derived)** (RC-18). **P1.**
4. **`clientNav` hardcodes `navigation.ok=true` — never confirms the page** (RC-18). **P1.**
5. **The rich element model the snapshot *could* be reconciled against is never loaded** (RC-06). **P0.**
6. **Refs re-stamped each snapshot → no stable element identity across turns** (RC-22). **P1.**
7. **The drive prompt instructs "trust your narration over the screen"** because the screen read is unreliable (RC-19). **P1.**

*Verdict:* REAL-but-shallow where it drives; FAKE where it talks. A stronger model cannot recover a value the snapshot never captured.

---

## 13. TOP AI-HALLUCINATION RISKS

1. **`__vinChoose` empty-want → `opts[0]`** (RC-15) — buyer-visible arbitrary pick. **P1.**
2. **`__vinNative` unconditional first-enabled fallback** (RC-15) — wrong-but-plausible native select. **P1.**
3. **Ungrounded journey narration on knowledge/note beats** (RC-16) — spoken, flagship path, gate-skipped. **P1.**
4. **Live `answerAs` grounding is prompt-only, never output-verified** (RC-34). **P2.**
5. **Confident narration over an unverified/failed screen** (RC-18). **P1.**
6. **Name-only dropdown wants → single-word match picks wrong sibling** (RC-20). **P1.**
7. **`agentStep` fills fields with guessed "realistic values," no validation model** (RC-35). **P2.**
8. **`__vinCombo` "take any option" comment — re-regression trap** (RC-42). **P3.**

*Correctly closed (verified):* `pickNode` enum-constrained + returns `''` off-domain (no bogus nav); `navigateFreeRoam`/`resume` honor `noMatch`; `agentStep` JSON enum-constrained, refusal→`done`; mutating **clicks** gated by a real server-side classifier (not prompt).

---

## 14. TOP RECOVERY FAILURES

1. **Narration emitted before stuck-detection** → repeated lines reach the buyer (RC-29). **P2.**
2. **Premature hand-back on a correctly-set dropdown** (RC-19). **P1.**
3. **No post-action verification → recovery fires a step late, after a visible stall** (RC-25). **P2.**
4. **Broken journey degrades silently to free-roam** (RC-27). **P2.**
5. **Temporal no-bail trap (custom date widgets) grinds to the 32-cap** (RC-38). **P3.**
6. **Mid-walk gap not surfaced live** (RC-26). **P2.**
7. **No cross-process resume** — redeploy mid-demo can't recover position (RC-30). **P2.**

*Strength (honest):* the engine/graph never *pretends* success — every failure hands back in plain language with the breadcrumb intact. Recovery is genuinely good; its **buyer-facing seams** are the problem, not its logic.

---

## 15. PRIORITIZED REMEDIATION ROADMAP

Sequenced so each wave is independently shippable and verifiable. Respects: do-not-touch LiveBrowser/TargetPicker/TourRunner; prod migrations + deploys need per-run authorization; no Gemini key exposure; execution-mode settings unchanged.

### WAVE 0 — Safety & truth (do first; small, high-stakes)
- **RC-05 (P0):** Extend the `/agent/step` gate to classify `select` (and option-committing `type`): resolve the chosen option text + field label through `classifyAction`/`permits`. Server-side in `index.ts`. *Closes the read-only breach.*
- **RC-15 (P1):** `__vinChoose` empty-want → return `null` (or only auto-pick non-required "pick any"); `__vinNative` guard the first-enabled fallback with `if(pick<0 && !w)`. `runtime.tsx` injected constants only.
- **RC-29 (P2):** In `driveGoal`, suppress `say(res.say)` when `sig === lastSig` (dedup narration before emitting).
- **RC-27 (P2):** Disable / confirm-gate the `cr-jcard` launch button when `missingCount > 0`.

### WAVE 1 — Voice experience (the "slow + verbose" cure; mostly config)
- **RC-03 (P0):** Stream `answerAs`/`narrate` (`client.messages.stream`), feed sentences to TTS as each boundary is crossed; have `voiceEmit` accept partial-sentence events. Collapses time-to-first-word.
- **RC-04 (P0):** Set `thinking:{type:'adaptive'}` on spoken-turn calls (or add a final-answer-only instruction to the `answerAs`/`narrate` spans). **Re-run `eval-prompts.ts` (20/20 byte-identity) after any `prompts.ts` edit.**
- **RC-09 (P1):** Lower `answerAs` `max_tokens` to ~200-280.
- **RC-10 (P1):** Change `agentStep.forms` from "Always narrate" to a salience gate; suppress empty/duplicate `say`.
- **RC-11 (P1):** Utterance-id barge-in: increment id on `mic_start`/`interrupt`, drop non-current synth/sends, send client a `flush`.
- **RC-33 (P2):** Route `answerAs`/`narrate` to a faster tier (Sonnet 4.6) while keeping Opus for build-time. **RC-37 (P3):** bump default rate to ~1.05-1.1.

### WAVE 2 — Screen awareness & the dropdown (perception)
- **RC-08 / RC-19 (P0/P1):** Extend `PAGE_SNAPSHOT_JS` to emit the **resolved selected value** of native selects and resolved comboboxes, plus active tab/filter and visible banner/validation text and a bounded main-content digest; surface them on `PageElement`/`AgentStepContext`. Then drop the "trust your narration" prompt clause.
- **RC-22 (P1):** Make refs stable (hash of a durable attribute or a persistent ref↔element map); key stuck-detection on stable-ref + observed-value-changed.
- **RC-25 (P2):** Have `clickRefJs`/`typeRefJs`/`comboPickJs` capture a before/after page signature and return `{changed,url}`; assert post-click change on the driver click-strategy branch.
- **RC-20 (P1):** Verify the chosen option contains the code token before committing; raise/eliminate the 80-row cap or scroll the virtualized listbox while polling.

### WAVE 3 — State unification (the keystone)
- **RC-01 / RC-21 (P0/P1):** Give the drive loop shared working state — either route `/agent/step` through the LangGraph (a `drive` node fed the live snapshot, inheriting `DemoStateT`), or load a minimal shared context (currentPosition, goal, outcome, fields-done) into `/agent/step` from the session.
- **RC-07 (P0):** Carry a structured per-goal plan + per-field completion map in `AgentStepContext` (`fieldsDone[]`, `fieldsRemaining[]`, `currentScreen`), updated from the snapshot each step — not re-parsed from prose.
- **RC-02 (P0):** Single-owner journey position — delete `walkStep`; have `runWalkStep` read the authoritative index back from graph state and speak the **same entry** the graph drove. Add an interleave eval.
- **RC-12 (P1):** Collapse to one walk engine (`runWalkStep` delegates to the shared stepper `walkJourney` uses); point `eval:phase24` at the **shipped** path + add the off-script-interleave + caption-node-alignment assertions.
- **RC-13 (P1):** Make journey-drive a property of the session, not the transport — add a `journey_next`-equivalent to the interactive path (reuse the scripted `/session/advance` pattern), or explicitly scope journeys to Talk in the UI.

### WAVE 4 — Knowledge → the live brain (turn the doc-bot into a consultant)
- **RC-06 (P0):** Add an element-aware read path — fetch `getNodeElements(node.id)` (or join in `selectFromGraph`) for the navigated node; thread a compact `screenFacts` (buttons/actions/required-fields/permissions) into `AnswerContext`/`agentStep`. *Unlocks the deepest existing knowledge.*
- **RC-17 (P1):** Extend `AnswerContext` with `outcome` + `activeStakeholderConcern`; load the pinned `business_outcomes` row and the active stakeholder's `objections`/`decision_criteria` in `gatherRoom`; soften `answerAs.style` to "answer, then connect to {outcome} when relevant."
- **RC-16 (P1):** Resolve knowledge-step chunk content in `journeyWalkPlan` and pass it to `narrate` as grounded source ("paraphrase ONLY this; else show the screen"); stop free-generating null-caption beats.
- **RC-23 (P2):** Pass top-N non-gated chunks to `answerAs`. **RC-35 (P2):** feed node element `detail` to `agentStep`. **RC-34 (P2):** run `verifyFaithful` on high-stakes answer turns.

### WAVE 5 — Reliability & resilience
- **RC-26 (P2):** Emit a live gap event + visible operator beat on a mid-walk `noMatch`; pre-flight `journeyWalkPlan` against active-graph navigable labels (the deferred P5 verify).
- **RC-28 (P2):** Surface `voiceState` + "Logging into {host}…" progress in the journey strip.
- **RC-30 (P2):** Persist a `DemoStateT` snapshot per turn; rehydrate on `bootSession`.
- **RC-31/RC-32 (P2):** Prefer direct route `loadURL` when a goal maps to a known screen; pass full ordered locators to the navAction matcher; rank label matches by role/container, not string length; record divergence.
- **RC-24 (P2):** Hold the resolved plan + `businessGoal` + `successCriteria` in state once at journey start; emit an outcome-check at `journey_complete`.
- **P3 cleanup:** RC-38 (cap temporal retries when still EMPTY), RC-39 (step/duration on cards), RC-40 (centralize `journeyAdvance`), RC-41 (collapse chat in voice walk), RC-42 (fix misleading comment).

### Verification gates
- `eval-prompts.ts` 20/20 after any `prompts.ts` edit; `eval:phase24` rebuilt to drive the **shipped** path with interruption; regressions `eval:phase1/6/7/12`; root + `apps/web` `tsc`; desktop bundle build; mig (if any) on prod with explicit authorization; smoke one journey end-to-end (voice + live walk + one mid-walk question).

---

### One-line bottom line
**The demo isn't failing because the AI can't talk — it's failing because two brains don't share state, the speaking brain can't see and the seeing brain can't remember, and the voice on top is configured to ramble. Fix Waves 0-3 and the demo stops being slow, verbose, and fragile; Waves 4-5 turn it from a documentation reader into the consultant it was designed to be.**

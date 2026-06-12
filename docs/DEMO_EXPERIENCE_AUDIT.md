# VIN AI DEMO — EXPERIENCE FORENSIC AUDIT ("indistinguishable from a human expert")

**Date:** 2026-06-12 · **Method:** 5 parallel forensic lenses (conversation+human-likeness, latency+voice-UX, cognitive-load+flow+storytelling, product+screen-by-screen, executive-buyer+future-state). Grounded in the **live code** *and* **60 real `ai_calls` transcripts** (mig 0027). Read-only. Adversarial posture: assume flaws remain; do NOT credit today's fixes uncritically.

**Scope vs the earlier audit.** `DEMO_ROOT_CAUSE_AUDIT.md` was *architectural* (does it work, is it safe, does state cohere) — and that backlog is now largely shipped. **This audit is *experiential*: does the demo FEEL like a world-class human SE?** Different question, different — and worse — answer.

---

## 1. EXECUTIVE SUMMARY

**The architecture now works; the *felt experience* does not yet pass.** Every fix this session made the demo function — safe, stateful, streaming, perceptive. None of it made the demo *sound human* on the paths a buyer actually experiences. Three measured tells dominate, all evidenced in live transcripts:

1. **It sounds scripted (repetition).** Across **61 live narration lines, 97% orbit the same 3 ideas**; 18/61 open "Here's where", 20/61 say "one place", with near-verbatim duplicate sentences in a *single* walk. A human never restates one value prop 18 times. → narration is **stateless** (never sees its own prior lines) and is handed the **same outcome string every step** over **empty captions**, so it paraphrases the goal forever.

2. **It sounds like a doc-bot (verbosity + dead air).** Q&A answers run **76 words / 4 sentences average, 5–6 sentences on 4/7 recent answers** — throat-clear ("Good question" ×3 verbatim), screen-reading, outcome-padding, an unsolicited tour, and a provenance footnote nobody asked for. And every spoken answer is preceded by **multi-second silence**: **adaptive thinking (shipped today) re-serializes the very latency streaming was meant to hide** — on Opus 4.8 the thinking block gates the first visible token, so streaming delivers ~zero first-word benefit — *on top of* three serial Opus round-trips (interpret→embed→pickNode) before the answer LLM even starts.

3. **It's a feature tour, not a sales narrative (no arc, no ROI, no tailoring).** The journey assembler **concatenates relevance-scored assets** — no problem→stakes→show→payoff→ROI. One workflow **explodes into 6+ narrated screens** (death by screen-tour). The richly-authored **committee objections + decision criteria are never read by any live path** — the instant a CFO speaks, the consultant becomes a single-chunk doc reader. The **measurable ROI (baseline→target) is authored, assembled into the closing beat, then flattened to a title and improvised away** — the demo never states a number. And the committee the journey is *built for* is **invisible in voice walks** (no room seeded → the anti-fabrication guard suppresses all role framing).

**The headline, and the good news:** *the intelligence is built — it's just mute.* The committee objections, the outcome baseline/target, the per-screen `page_facts`/`screenFacts`, the walk position — **all exist and are validated; none of it reaches the spoken layer.** Every lens independently concludes: **none of the fixes require an architectural rebuild.** They are prompt edits, context-threading, orchestration-ordering, and one model-config flag. This is a wiring problem, not a redesign.

**Brutal one-liner:** today the demo is a *polished, well-paced, architecturally-sound screen-reader that happens to drive the real product* — not yet a consultant. The gap is concentrated in (a) what it says, (b) how fast it says the first word, and (c) whether it tells a story for the room. All three are tractable.

---

## 2. CRITICAL DEFECTS (evidenced, deduped across lenses)

35 distinct, transcript- or code-evidenced defects. I have **not** padded to "Top 50" — the constitution forbids generic filler; these 35 are real, each with a root cause + fix.

### P0 — kills the human illusion / demo-blocker
| # | Defect | Evidence | Root cause | Fix | Effort |
|---|---|---|---|---|---|
| 1 | **Q&A answers are 5–6-sentence doc-bot monologues** | live `answerAs` avg 76w/4 sent; "Good question. Per the product material…" + role list + outcome pad + tour + provenance (227 tok) | `answerAs.style` concision is a soft clause losing to the heavy persona overlay + `navHint` (licenses tour) + **RC-17 outcomeHint** (pads outcome every turn) + provenance span; no hard cap, max_tokens 1024 | Make concision DOMINANT + quantified in `sysAnswerAs`; gate nav/outcome/provenance/tour behind explicit triggers; slim persona overlay on this path; ≤2-sentence post-trim | M |
| 2 | **Narration pathologically repetitive (97% same 3 ideas)** | 61 narrate lines: "one place" 20/61, "Here's where" 18/61, near-verbatim dupes | narrate **stateless** (no prior-lines memory) + `outcome` injected EVERY step (graph.ts:252/260) + node steps carry no `sourceText` | Thread last 3-4 spoken lines + "do not reuse openers/value phrases" into `NarrateContext`; inject outcome only on open/close beats; ban the stock openers | M |
| 3 | **Stuck dropdown loops the same action 6+ times / 24s dead air** | 8 identical "set line item to Asset" in `agentStep`, 24.2s | stuck-detection exempts `select`/dropdown + relies on comboPick self-reporting failure; a combo that returns ok-but-ineffective trips neither guard | After 2 identical sigs of ANY kind, verify the ref's filled/value next snapshot; if still empty → stop + hand back; treat still-EMPTY select as non-resolving | M |
| 4 | **Adaptive thinking reintroduces multi-second pre-speech pause** (every spoken Q&A) | `answerAs` `thinking:{type:'adaptive'}` (llm.ts:494) + streaming on the same call; on Opus 4.8 thinking gates the first text delta | model-config in the latency chain: streaming keys off first text delta, thinking emits an omitted block first → streaming benefit ≈ 0 | **Disable thinking on the streaming voice `answerAs` path**; add a final-answer-only line to keep reasoning out of speech | S |
| 5 | **3 serial Opus round-trips before the answer LLM starts** | graph: interpret (Opus, 2048 tok) → Voyage embed + pgvector → pickNode (Opus) → THEN answerAs | orchestration: pre-answer pipeline is 3 serial cloud round-trips on the slowest tier, none parallel/downgraded | Move interpret+pickNode to Haiku; embed concurrently with interpret; skip pickNode on a pinned-journey on-screen question | M |
| 6 | **No narrative arc — journey is a flat node-list** | journey-assembler.ts:118-126 fixed template (frame→workflows→"Evidence"→close); grep problem/stakes/wow/roi = 0 hits | assembler models a journey as relevance-scored asset refs, not a dramatic structure | Arc template: pain (committee objection)→stakes (outcome baseline)→ONE show→payoff (target)→proof; add `arcRole` to steps | M |
| 7 | **One workflow → 6+ narrated screen-beats (death by screen-tour)** | journeys.ts:127 expands node_sequence 1 beat/node; povin 6-node PO lifecycle → 6 narrated screens, no cap | journeyWalkPlan conflates the NAVIGATION path (complete, for self-heal) with the STORY sequence (sparse, climactic) | Drive interior nodes SILENTLY; narrate only first/inflection/last (~3 per workflow); add `keyNodes` | M |
| 8 | **Walk narration is NOT product-aware** (screenFacts never reaches narrate) | `NarrateContext` has no screenFacts field; RC-06 wired it to `answerAs` only; walk uses narrate | orchestration: RC-06 product-awareness bypasses the exact path the demo runs on | Add `screenFacts` to `NarrateContext` + sysNarrate hint (mirror sysAnswerAs); pass `d.screenFacts` at graph.ts:260 | S |
| 9 | **Committee objections + decision criteria reach no spoken word** | `product_stakeholders` objections/criteria exist; grep on live path = 0 reads; `gatherRoom` reads only thin session fixture | knowledge seam: committee registry built as console/assembler artifact; answerAs never given an objection channel | Add `committee` to AnswerContext; load registry at boot; on objection match, inject that role's objection+criterion → answer it head-on | M |
| 10 | **ROI (baseline→target) authored everywhere, spoken nowhere** | `business_outcomes` has metric/baseline/target; bootSession loads only the TITLE; close note has `sourceText:null` → improvised | knowledge seam: outcome flattened to a title string at boot; the one quantified beat degrades to generic narration | Load full outcome row at boot; ground the close note + ROI answers on metric/baseline/target/success-indicators | M |

### P1 — severe
| # | Defect | Evidence | Fix | Effort |
|---|---|---|---|---|
| 11 | **explainWhy speaks route slugs + "detected intent" telemetry** | 10/10 explainWhy say a route slug ("po.vin/queue/manager"); 7/10 "detected intent" | Rewrite explainWhy to 1 plain sentence about what the screen does for them; strip URLs/scores/jargon from the trace it's fed | S |
| 12 | **agentStep narrates obvious form-fills/clicks** | "Let's set the department…", "I'll enter the vendor name…" — routine clicks | Relocate "default `say` empty" to top of `agentStep.intro` + 2 few-shot pairs; drop sub-milestone `say` client-side | S |
| 13 | **Journey walk waits for full navigation before narrating** | graph.ts:256 `await driveTo` THEN `await narrate` — silent screen change, then talk | Run `narrate()` + `driveTo()` concurrently (text depends on the known node label/caption/source, not the live DOM) | M |
| 14 | **EL WS open awaited (≤6s) before the brain turn** | voice-session.ts:154 `await openTurnWs()` before `runTurn` | Fire `openTurnWs()` concurrently with `runTurn`; await it only before the first feed | S |
| 15 | **Cold-start (connect→login) is silent dead air** | startVoice serial: voiceToken→WS→bootSession→narrate→TTS; only tiny text labels | Speak a cached opener ("one second, bringing up the demo") on WS-ready; warm AudioContext on the launch click | M |
| 16 | **Narration beats stateless — can't build/back-reference** | `NarrateContext` has no stepIndex/priorNarration/arcRole | Thread stepIndex/total + arcRole + last 2-3 lines (walkStep already tracks position) | M |
| 17 | **Walk not personalized to the committee** (audience null in live walk) | graph.ts:246 audience = activeStakeholder?.role; live walks seed no room → null | Resolve `journey.stakeholderRefs` → a `framedFor` committee summary; pass to narrate; frame by role w/o fabricating presence | M |
| 18 | **Off-script answers are top-1-chunk doc readers, no outcome/criteria framing** | answerAs.source = `retrieved[0]` only; "answer and stop — no value-pitch" | Permit ONE grounded outcome/criterion clause when it's the active concern; feed top-2 chunks | M |
| 19 | **Certified walk path ≠ desktop path; desyncs on interruption** | eval-phase24 drives `walkJourney`; desktop runs `runWalkStep` mirror counter | One driver both call; desktop reads journeyStep from the engine event as sole truth; add interruption eval | M |
| 20 | **Unresolved node narrates as if shown (confident wrongness)** | graph.ts:260 narrate + advance regardless of `ok`; only an operator trace line | On `!ok`, switch narrate to recovery ("let me bring that up another way"); surface the gap live; gate the spoken claim on the achieved screen | M |

### P2 — significant
| # | Defect | Fix | Effort |
|---|---|---|---|
| 21 | Throat-clear openers ("Good question" 4/7) | "Lead with the answer; no acknowledgment filler" in answerAs.style | S |
| 22 | Empty scaffolding captions ("Evidence"/"Context: X") | Assembler writes buyer-facing intent captions from objections/outcome (data in scope) | S |
| 23 | Heavy persona preamble fights concision on narrate+answerAs | Slim identity+voice+limits variant for narrate/routine-answer; full overlay only for deep-dive/objection turns | M |
| 24 | Per-sentence Google TTS serial round-trips + inter-sentence gaps | Pipeline sentence N+1 while N plays; prefer EL-WS default; consider Google streaming synth | M |
| 25 | Gemini provider blocking → model switch reintroduces whole-reply dead air | Stream the Gemini answerAs (SSE) → onDelta; or gate voice to streaming-capable models w/ AI Control warning | M |
| 26 | Fixed settle/sample timers (1500/1400/1800ms) add unconditional latency | Event-driven readiness (did-stop-loading/did-navigate) with the constants as upper bounds | M |
| 27 | No transition/bridge beats between workflows | Assembler inserts a 1-line `note` bridge (why we're pivoting) from business_purpose/objection | S |
| 28 | open/close `note` beats are thin templates (generic finale) | Compose from outcome metric/target + committee decision_criteria | M |
| 29 | Honesty markers (dead_ui/unwired) never surface in walk narration | Once screenFacts reaches narrate, flag not-live elements proactively | S |
| 30 | ASK vs TALK feel like two assistants, no shared memory | Persist driveGoal history/fields to the snapshot; load into runTurn priorContext; long-term unify ASK/TALK | L |
| 31 | Auto-advance flat 1.8s pacing (no content-aware dwell) | Scale dwell by narration length + stepKind/arcRole (fly through transit, dwell on payoff) | S |

### P3 — polish
| # | Defect | Fix | Effort |
|---|---|---|---|
| 32 | No instant verbal ack covering thinking latency | Emit one varied micro-ack ("Sure—") on turn start (or just disable thinking per #4) | S |
| 33 | Client per-frame MP3 decode jitter on WS path | Accumulate small frames into ~250ms windows, or AudioWorklet PCM pipeline | M |
| 34 | Operator strip is a bare step counter, not a teleprompter | Render current+next beat caption + arc markers (journey_step already carries kind/node) | S |
| 35 | narrate gets bare lowercase intent label, told not to read it → nothing to say | Pass the node's display `screenName` + `purpose` (page_facts) instead of the routing key | S |

---

## 3. HUMAN-LIKENESS AUDIT
The demo fails the "forgot I was talking to AI" bar on the paths a buyer hits most. Tells, ranked: **repetition** (#2 — 97% same-theme narration, the single clearest "scripted" signal), **verbosity** (#1 — doc-bot monologues), **dead air** (#4/#5/#13 — silence before speech, navigate-then-talk), **mechanical self-narration** (#11 explainWhy reads its own telemetry; #12 narrates obvious clicks; #3 loops a stuck field aloud). A human SE: 1–2 sentences, talks while clicking, never restates a value prop, never reads a URL, sets a field once and notices if it didn't take. The scripted *uninterrupted* walk is closest to human; **every interruption and every off-script question collapses the illusion.**

## 4. CONVERSATION AUDIT
**Value density is low by construction.** answerAs: ~76 words / 4 sentences where 1–2 is the standard; openers are filler ("Good question" ×3 verbatim); answers recite lists aloud, pad the outcome, volunteer a tour, and footnote provenance unprompted. Controlling code: `answerAs.style` concision is a lone soft clause vs the heavy persona overlay (persona.ts:153-191 "This MUST materially shape your wording and length"), `navHint`, RC-17 `outcomeHint`, and the provenance span — concision loses every tug-of-war (defects #1, #6 root, #21, #23). narrate is repetitive and content-starved (#2, #22, #35). explainWhy is a system log read aloud (#11). **Fixes #1, #2, #11, #12, #21, #23 + the Conversation Blueprint (§12).**

## 5. LATENCY AUDIT
Per-interaction Expected vs Actual vs Cause:
- **Off-script spoken answer:** human ~0.7–1.5s to first word. Actual: multi-second. Causes: **adaptive thinking gates first token (#4)** + **3 serial Opus/Voyage round-trips (#5)** + per-sentence Google synth (#24) + no streaming on Gemini (#25). 
- **Journey walk step:** human talks *while* navigating. Actual: navigate-then-silence-then-talk — **narrate awaits full driveTo (#13)** + EL WS awaited up front (#14) + fixed 1500/1800ms settles (#26).
- **Cold start:** several silent seconds, only tiny text (#15); AudioContext not warmed.
- **WS path:** per-frame MP3 decode jitter (#33).
**Fixes #4 (P0,S — biggest single win), #5, #13, #14, #15, #24, #25, #26 + the Latency Blueprint (§13).** Net target: first word < ~1.5s; walk narrates as it drives.

## 6. COGNITIVE LOAD AUDIT
Load spikes from **screen-tour overload** (#7 — 6 interchangeable screens narrated in a row), **stateless beats with no build** (#16 — every step re-orients from zero), **no bridges between sections** (#27 — hard scene-cuts), and **flat metronome pacing** (#31 — no breathing room on payoff, no acceleration through transit). The buyer is asked to absorb every screen equally with no signal of what matters. **Fixes #7, #16, #27, #31, #34.**

## 7. STORYTELLING AUDIT
**The story being told:** "frame → here's screen 1 … screen 6 → 'Evidence' → close." **The story that should be told:** open on the committee's own pain → quantify the stakes → show the ONE turning point → land the payoff with a number → prove with one cited fact → close on the measurable result + a forward question. The assembler emits structure labels, not talking points (#22); there's no arc (#6), no compression (#7), no quantified payoff (#10), no tailoring (#9/#17), and the bookend beats — the highest-stakes moments — are the most generic lines (#28). **Fixes #6, #9, #10, #22, #28 + the Demo Flow Blueprint (§14).**

## 8. PRODUCT EXPERIENCE AUDIT
The per-screen model is genuinely rich (RC-06 `screenFacts`, `page_facts`, the seeded sitemap with per-node `purpose`/honesty markers) — **and almost none of it reaches the buyer's ears on the walk.** screenFacts goes to answerAs only, never narrate (#8); workflow screens 2-N narrate with null caption + no source (#2/#7 root); honesty markers are computed and consumed by nothing at demo time (#29). The product's real screens are presented as silent transitions + vague lines rather than consequential beats. **Fixes #8, #2, #29, #35.**

## 9. SCREEN-BY-SCREEN AUDIT (PO.vin, the live demo path)
For each driven screen — *intended purpose vs actual experience vs missed value:*
- **New Purchase Request (wizard):** the write surface / where a request is born. Today: narrated generically, with the **stuck-dropdown loop (#3)** living here. Missed: "this is where a request becomes structured data the moment it's raised."
- **Manager / Owner / Accounting / Receive queues (4 screens):** the lifecycle stages. Today: 4 near-identical filler lines as the AI clicks through (#7). Missed: each is a *distinct stakeholder's moment* (manager decision, owner self-approval block, finance close, goods receipt) — the heart of the approval story, flattened to a click-through.
- **Purchase Order Detail:** single-PO workspace + audit trail + routing. Today: narrated as a label. Missed: "everything about this PO + the full audit trail one tab over" — the controller's separation-of-duties story.
**Redesign:** narrate only the inflection screens, each with its grounded `purpose` + the committee role it serves (#8, #7, #17).

## 10. ROOT-CAUSE MATRIX
| Surface symptom | Conversation cause | Latency cause | Data/knowledge cause | AI/model cause | Orchestration cause |
|---|---|---|---|---|---|
| Doc-bot monologue (#1) | concision loses to overlay+hints | — | — | no hard cap, max_tokens 1024 | nav/outcome/provenance fire every turn |
| Repetition (#2) | "vary phrasing" w/o memory | — | empty captions, outcome-every-step | stateless generation | no prior-lines threaded |
| Dead air before speech (#4,#5) | — | thinking gates token + 3 serial round-trips | — | Opus tier on spoken path | no parallelization/downgrade |
| Feature-tour, no story (#6,#7) | — | — | assembler = relevance scoring | — | nav-path used as story-path |
| Can't handle the room (#9,#18) | terse, no connective tissue | — | committee registry unread at runtime | — | answerAs has no objection channel |
| No ROI spoken (#10) | — | — | outcome flattened to title at boot | — | close beat ungrounded |
| Walk not product-aware (#8) | — | — | screenFacts→answerAs only | — | narrate path never given the field |
| Drift/desync (#19,#20) | — | — | — | — | two walk drivers; narrate intent not achieved-screen |

## 11. RECOMMENDED FUTURE-STATE EXPERIENCE
A single buyer-aware brain across voice/ASK/walk, with the committee + ROI + per-screen facts available to *every* spoken function. The walk opens on the room's pain, shows ONE turning point (narrating only inflections, talking while it drives), lands a quantified payoff, proves it with a cited fact, and closes on the number + a forward question — sub-1.5s to first word, 1–2 sentences a turn, varied pacing, no repetition, graceful recovery on any unreachable screen. (Full architecture: §18.)

## 12. IDEAL CONVERSATION BLUEPRINT
- **Narration:** ONE sentence (rarely two) per beat, naming ONE concrete fresh thing on THIS screen; outcome tie only on open/close. Given the last 3-4 lines + "advance, don't restate." Banned openers: "Here's where", "everything in one place", "For those of you". *e.g.* "This is the manager's queue — and notice a PO they raised themselves can't self-approve; it routes to a peer."
- **Q&A (answerAs):** lead with the answer in 1–2 sentences, no throat-clear, no list-reading (give the count, offer detail), no unsolicited tour/outcome/provenance. *e.g.* "Six — requester through admin, plus accounting. Want me to add one?" Provenance only on a trust question; tour only on "show me"; ONE outcome/criterion clause only when it's the active buyer's concern.
- **Why-this (explainWhy):** one plain sentence about what the screen does for them; never URLs/intent/scores. *e.g.* "Because that's where the self-approval block actually kicks in."
- **Driving (agentStep):** `say` defaults empty; speak only at a milestone/direction-change/blocker; after 2 ineffective attempts, stop and hand back warmly.

## 13. IDEAL AI-BEHAVIOR BLUEPRINT
First audio < ~1.5s (no adaptive thinking on the spoken path; interpret/pickNode on Haiku; embed ∥ interpret; instant micro-ack covers any gap). Talks while it navigates (narrate ∥ driveTo). Slim persona overlay on terse paths; full strategy/playbook only on deep-dive/objection turns. Bidirectional buyer awareness: matches a question to the committee member's authored objection and answers it against their criterion, in voice. Grounded everywhere — never invents a number or a screen claim.

## 14. IDEAL DEMO FLOW BLUEPRINT
~5–7 beats per journey: **(1) Open on pain** (committee's top objection, no screen yet) → **(2) Stakes** (outcome baseline/metric — "why now") → **(3) Show** (ONE workflow, ~3 narrated inflection screens, interior driven silently) → **(4) Payoff** (tied to outcome.target, dwell ~3s) → **(5) Proof** (one cited fact closing the top objection) → **(6, optional) Second act** only for a distinct objection, preceded by a one-line bridge → **(7) Close** on the number + a forward question. Pacing varies by arcRole. Operator strip becomes a teleprompter (current + next + arc position).

## 15. IMPLEMENTATION ROADMAP
**Wave A — Latency & speech feel (mostly S, biggest perceived jump):** #4 disable thinking on streaming answerAs · #14 EL WS concurrent · #13 narrate∥driveTo · #5 Haiku for interpret/pickNode + parallel embed · #21/#1 concision-dominant + no filler openers. → first word sub-1.5s, talks while driving, answers land in 1–2 sentences.
**Wave B — Kill the scripted feel (M):** #2 stateful anti-repetition narration · #8 screenFacts→narrate · #7 silent interior nodes (~3 beats/workflow) · #35 screenName+purpose to narrate · #16 stepIndex/arcRole threading. → the walk progresses instead of looping.
**Wave C — The room & the case (M):** #9 committee objections+criteria→answerAs · #10 load+speak grounded ROI · #17 framedFor committee in walk · #18 top-2 chunks + one grounded consultative clause · #6 arc-template assembler + #22/#27/#28 real captions/bridges/bookends. → handles executives, makes a quantified case, tailors to the room.
**Wave D — Robustness & polish:** #19 one walk driver + interruption eval · #20 graceful recovery on unreachable screen · #3 harden stuck-detection · #26/#31 event-driven + content-aware pacing · #11/#12 de-jargon explainWhy + empty-say default · #15 cold-start spoken bridge · #34 operator teleprompter · #25/#33 Gemini streaming + WS audio smoothing · #30 ASK/TALK shared memory (L).

## 16. QUICK WINS (S effort, high impact)
#4 (disable thinking on streaming answerAs) · #21 (drop filler openers) · #14 (EL WS concurrent) · #8 (screenFacts→narrate) · #35 (screenName+purpose to narrate) · #11 (de-jargon explainWhy) · #12 (empty-say default) · #22 (real captions) · #34 (operator teleprompter) · #17/#3-quick.

## 17. HIGH-IMPACT CHANGES
#1 (concision-dominant answers) · #2 (anti-repetition narration) · #5 (Haiku + parallel pre-answer) · #6 (arc-template assembler) · #7 (silent interior nodes) · #9 (committee objections into answers) · #10 (speak grounded ROI) · #13 (narrate∥driveTo) · #19 (unified walk driver).

## 18. ZERO-GAP FUTURE-STATE ARCHITECTURE
1. **One buyer-aware brain, every surface.** Voice, ASK, walk share one orchestration + durable working state. The committee registry (objections/criteria/authority per role) and the full business_outcome (metric/baseline/target/indicators) load at boot and are available to answerAs, narrate, AND the drive loop. Tailoring and ROI are properties of the brain, not one path.
2. **The room is modeled and addressed by role.** A journey resolves `stakeholderRefs` into a `framedFor` committee (distinct from live `inTheRoom`). Questions match authored objections and are answered against the buyer's criterion, in voice. The objection playbook is the demo's spine, not console decoration.
3. **Every demo makes a quantified case.** The close is grounded in baseline→target with success indicators as the citable source. No journey ends without "here's the number we move and how you'll measure it."
4. **Consultative brevity, not terseness.** 1–2 sentences; sub-1.5s first word; ONE grounded outcome/criterion clause when it's the active concern.
5. **One walk driver, bulletproof under interruption.** Desktop walk and the certifying eval share the driver + a single authoritative journeyStep. Off-script never desyncs caption↔screen. Unreachable screen → graceful recovery, never confident wrongness.
6. **Content-aware pacing + presenter-grade narration.** Dwell scales with weight; narration is stateful, arc-aware, product-grounded, and personalized; routine navigation is silent.

**Closing note:** none of §18 requires a rebuild. The committee, the ROI numbers, the per-screen facts, the walk position — all already exist in the system; they are simply not threaded into the spoken layer. This audit is a wiring-and-prompt program, sequenced in §15, that converts a sound architecture into an experience an executive will champion.

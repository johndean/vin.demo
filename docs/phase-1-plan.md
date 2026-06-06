# Phase 1 — Walking skeleton (plan)

**Goal (plan §5):** the approval-delegation scenario end-to-end, real but thin — a single LangGraph loop on the entity model, with the "accept now" gaps wired through. This is the production rebuild of the Phase 0 spike (which stays throwaway in `src/spike/`).

## Status
- [x] Entity model schema (`db/migrations/0001_entity_model.sql`) — spine + trust metadata.
- [x] **Increment 1 code** (`src/core/`): pluggable embedding provider (Voyage default; Gemini/Vertex registered swaps), pg DB layer, LangGraph loop with **interpret → retrieve** nodes (confidence/staleness gate), idempotent PO.vin seed, migration runner. Type-clean. Scripts: `npm run migrate | seed | loop`.
- [x] Increment 1 **live** on Railway/pgvector + Voyage (`npm run migrate | seed | loop`): in-scope answers cited, off-topic/stale/unvalidated/irrelevant all gate.
- [x] **Adversarial review applied** (13 confirmed findings): 4-gate trust check (confidence · validation-status · time-staleness · relevance + null-distance), robust LLM structured-output parsing (refusal/empty/malformed), embedding dim guard, transactional+idempotent migration runner with `schema_migrations`, ivfflat dropped for exact scan, UNIQUE indexes (`0002`).
  - **Deferred (tracked, not bugs blocking):** (a) finding [4] strict-TLS-with-CA for the Railway Postgres proxy — using `rejectUnauthorized:false` for the demo DB; revisit before any non-demo data lands. (b) finding [9] tighten relevance threshold to ~0.35 — **rejected**: measured in-scope distances are 0.38–0.47, so 0.35 would gate real in-scope questions; keeping the empirically-calibrated 0.65, recalibrate with a labeled set as the KB grows.
- [x] **Increment 2 — navigate node (live, review-hardened).** DemoGraph-driven, persona-aware, self-healing, with the production **action classifier** (`src/core/safety.ts`) enforcing execution mode. New: `src/core/driver.ts` (PO.vin adapter), DemoGraph seeded.
  - **Adversarial review applied (19 findings).** Biggest: the classifier was rewritten **fail-closed** — unknown/empty/icon-only/aria-masked/GET-mutating/synonym controls now default to `mutating` (blocked) instead of slipping through (the old allowlist failed *open*). Plus: classify all name sources + href + role/container, classify the route-recovery and row-open, broadened+uncapped-with-log scan, positive login assertion, navigate-node try/catch, role/mode threading. Report splits **confirmed mutating** (verb/href match) from **defensive holds** (fail-closed) so it's honest. Live: self-heal → `/queue/manager`, blocks 7 confirmed mutating (+13 held) of 59 scanned; navigation unaffected.
- [ ] Increment 3 — router + context-stack + interrupt/resume (mid-flight pivot) + explain ("why?") + tracing + cost events.

## The single LangGraph loop (one loop, not many agents — §4)
Nodes, each thin:
1. **interpret** — stakeholder utterance → intent (+ is-question/objection/curiosity); writes to session state.
2. **retrieve** — pgvector query over `knowledge_chunks` returning content **with** trust metadata; confidence/staleness gate here.
3. **plan** — pick the `demo_graph_node` for the intent (persona-aware label, ordered locator strategies).
4. **navigate** — Playwright drives the real UI; self-heal via the node's locator strategies; **read-only execution mode** enforced by the action-classifier (the spike's text guard, upgraded to element/intent-aware).
5. **explain** — narrate grounded in the cited chunk; answer "why did you show this?" from the plan trace.
6. **recover / interrupt** — pause/stop governance; survive an interruption and return to context.

State (survives interrupts) carries the **stakeholder collection (F)** and **discovery fields (E)**; everything persists on `demo_sessions` and friends.

## Cross-cutting
- **Tracing** (LangSmith / OpenTelemetry) on every node.
- **Per-demo cost events (J)** — emit a `cost_events` row on each LLM/embedding/nav call, tagged to the session.
- **LLM provider interface** — build cloud-only (Claude, `claude-opus-4-8`) behind a narrow interface; the spike's `llm.ts` is the seed.
- **Interaction-layer interface** — Playwright/web only built; the spike's navigator is the seed.

## What this phase does NOT do (deferral discipline)
Active discovery *behavior* (E, → P2), multi-stakeholder *exercised* (F, → P2), competitive *content* (D), product-lifecycle *engine* (B, → P3), billing (A), `execution` mode (G). Fields/seams exist; behavior is deferred.

## Open scope decisions (need founder input before building the loop)
1. **Provision Railway Postgres now?** I can apply the migration and seed PO.vin as a `product` + `environment` (`is_production=true`, per ADR-0003) so the loop has real rows to run against.
2. **LangGraph in TS** (matches the Node/TS stack) vs Python. Stack says Node/TS — confirm.
3. **Embedding provider** for `knowledge_chunks.embedding` (Voyage vs OpenAI vs other) — sets the vector dim.
4. **Scope of this pass:** build the whole loop now, or land it node-by-node (interpret+retrieve first, then navigate, then explain/recover) with an eval at each step?

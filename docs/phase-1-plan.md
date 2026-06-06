# Phase 1 — Walking skeleton (plan)

**Goal (plan §5):** the approval-delegation scenario end-to-end, real but thin — a single LangGraph loop on the entity model, with the "accept now" gaps wired through. This is the production rebuild of the Phase 0 spike (which stays throwaway in `src/spike/`).

## Status
- [x] Entity model schema (`db/migrations/0001_entity_model.sql`) — spine + trust metadata.
- [x] **Increment 1 code** (`src/core/`): pluggable embedding provider (Voyage default; Gemini/Vertex registered swaps), pg DB layer, LangGraph loop with **interpret → retrieve** nodes (confidence/staleness gate), idempotent PO.vin seed, migration runner. Type-clean. Scripts: `npm run migrate | seed | loop`.
- [ ] Increment 1 **live eval** — pending `DATABASE_URL` (Railway) + `VOYAGE_API_KEY`: apply migration, seed PO.vin, run `npm run loop`.
- [ ] Increment 2 — navigate node (DemoGraph-driven self-heal + action classifier).
- [ ] Increment 3 — explain + recover/interrupt; tracing + cost events.

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

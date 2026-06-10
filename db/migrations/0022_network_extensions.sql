-- 0022: Network extensions (V5 Guided Experience Platform, Phase 3 — extend specialist/environment/knowledge
-- with REAL telemetry). Additive + idempotent.
-- RECONCILIATION (Rule #2 — code wins): the plan's `specialist_participation` and `knowledge_links` tables are
-- OMITTED on purpose — Phase 2 already models the real edges, so adding them would be DECORATIVE (Rule #3):
--   • specialist ↔ journey  → already journeys.specialist_rules (0021); specialist ↔ workflow → demo_graph_workflows.persona_type.
--   • knowledge ↔ journey   → already expressible as a story_flow step (kind='knowledge', 0021);
--     knowledge ↔ node      → already demo_graph_nodes.source_chunk_id (0018).
--   • specialist metrics     → a ROLLUP from events that ALREADY exist (persona_handoff_events /
--     persona_escalation_events / audit_turns). No new instrumentation.
--   • knowledge usage        → counted from audit_turns.knowledge_used (already persisted) per product.
-- The one genuinely-missing thing is the EXECUTION CONTEXT on an environment — turning a config row into a
-- first-class, gated execution context (a readiness gate that mirrors the shipped graph authorityReadiness).
ALTER TABLE environments
  ADD COLUMN IF NOT EXISTS certification_status text NOT NULL DEFAULT 'uncertified',  -- uncertified | in_review | certified
  ADD COLUMN IF NOT EXISTS seed_version       text,
  ADD COLUMN IF NOT EXISTS data_version       text,
  ADD COLUMN IF NOT EXISTS readiness_state    text,    -- operator-stated (e.g. staging | ready | degraded)
  ADD COLUMN IF NOT EXISTS verification_state text,    -- unverified | verified | stale
  ADD COLUMN IF NOT EXISTS last_verified      timestamptz,
  ADD COLUMN IF NOT EXISTS known_issues       jsonb NOT NULL DEFAULT '[]';  -- [{title, detail?}] surfaced to the operator

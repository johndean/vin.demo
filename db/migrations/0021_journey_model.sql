-- 0021: Journey Layer (V5 Guided Experience Platform, Phase 2 — the keystone). Additive + idempotent
-- (mirrors 0013/0020). The Journey is the ORCHESTRATION object that was wholly missing: it REFERENCES the
-- existing assets by id (workflows, tours, knowledge, plus narrative notes) and ties them to a business
-- outcome + the buying committee + participating specialists. It ORCHESTRATES; it never replaces or
-- duplicates workflows/tours/REEL/graph/knowledge/specialists. Nothing existing is touched.
--   • journeys       — first-class, product-scoped, versioned, soft-archive. story_flow is an ORDERED list of
--                      {kind, refId, caption} where kind ∈ workflow|tour|knowledge|note (refId resolves to a
--                      REAL asset; note = a caption-only narrative beat). stakeholder_refs → product_stakeholders
--                      ids; specialist_rules → which personas participate. Reference integrity is checked at
--                      read time (src/core/journeys.ts resolveStoryFlow) — a dangling ref is FLAGGED, never dropped.
--   • journey_events — mutation audit (mirrors graph_events / outcome_events; denormalized; best-effort).
--   • journey_runs   — run telemetry (the basis for Phase 5 journey-success metrics). demo_session_id is
--                      DENORMALIZED (no FK) so the trail survives a session delete — same posture as
--                      navigation_attempts. Runs are 0 until a journey is actually walked (telemetry-gated;
--                      the console shows "0 runs" honestly, never a fabricated number).

-- ── Journeys (first-class orchestration object) ──
CREATE TABLE IF NOT EXISTS journeys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                text NOT NULL,
  business_goal       text,
  business_outcome_id uuid REFERENCES business_outcomes(id) ON DELETE SET NULL,  -- the governed outcome it advances
  environment_id      uuid REFERENCES environments(id) ON DELETE SET NULL,        -- compatible environment (optional)
  story_flow          jsonb NOT NULL DEFAULT '[]',   -- ordered [{kind:workflow|tour|knowledge|note, refId, caption}]
  stakeholder_refs    jsonb NOT NULL DEFAULT '[]',   -- product_stakeholders ids (the committee this journey is for)
  specialist_rules    jsonb NOT NULL DEFAULT '[]',   -- [{personaId, personaName, note}] — who participates
  success_criteria    text,
  status              text NOT NULL DEFAULT 'draft',  -- draft | active | deprecated | archived
  version             int  NOT NULL DEFAULT 1,
  owner               text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz,
  archived_at         timestamptz,
  archived_by         text,
  CONSTRAINT journey_status_valid CHECK (status IN ('draft','active','deprecated','archived'))
);
CREATE INDEX IF NOT EXISTS idx_journeys_product ON journeys(product_id) WHERE archived_at IS NULL;

-- ── Journey mutation audit (mirrors graph_events / outcome_events; denormalized ids; best-effort writes) ──
CREATE TABLE IF NOT EXISTS journey_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id  uuid,
  product_id  uuid,
  action      text,                               -- create | edit | publish | deprecate | archive | link
  actor       text,
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_events_journey ON journey_events(journey_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_product ON journey_events(product_id, occurred_at DESC);

-- ── Journey run telemetry (Phase 5 success metrics build on this; runs are 0 until a journey is walked) ──
CREATE TABLE IF NOT EXISTS journey_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id      uuid,                            -- denormalized (no FK) — trail survives a journey/session delete
  product_id      uuid,
  demo_session_id uuid,
  status          text NOT NULL DEFAULT 'running', -- running | completed | aborted
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT journey_run_status_valid CHECK (status IN ('running','completed','aborted'))
);
CREATE INDEX IF NOT EXISTS idx_journey_runs_journey ON journey_runs(journey_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_runs_product ON journey_runs(product_id, started_at DESC);

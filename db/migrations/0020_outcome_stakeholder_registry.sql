-- 0020: Business Outcome Registry + Stakeholder Registry (V5 Guided Experience Platform, Phase 1).
-- Additive + idempotent (mirrors 0011/0012/0018). Forges the TOP of the authority chain
-- (Stakeholder → Business Outcome → … → Workflow). NOTHING existing is rebuilt:
--   • business_outcomes — the first-class object the platform mandates. Until now "outcome" lived only as
--     FREE TEXT scattered on demo_graph_nodes (0018 business_purpose/business_outcome), demo_graph_workflows
--     (0013 business_purpose/success_criteria) and session_discovery (0001 business_objective). Those columns
--     STAY; they simply gain an optional FK link to a real, governed outcome (the seam, never a rewrite).
--   • product_stakeholders (0012 — the per-product buying committee) is EXTENDED, not replaced, with the
--     decision-criteria / goals / objections / questions the platform asks for, plus version + authorship.
--   • stakeholder_relationships — the influence graph (edges between committee members) that did not exist.
-- outcome_events mirrors graph_events / knowledge_events EXACTLY (denormalized ids, best-effort audit).

-- ── Business Outcome Registry (first-class; product-scoped; versioned; soft-archive) ──
CREATE TABLE IF NOT EXISTS business_outcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title            text NOT NULL,                  -- e.g. "Reduce approval delays"
  description      text,
  metric           text,                           -- how it's measured (free text — auto-measurement deferred)
  baseline         text,                           -- where they are today (operator-stated, optional)
  target           text,                           -- where they want to be (operator-stated, optional)
  stakeholder_type text,                            -- the committee role this outcome matters most to (optional)
  status           text NOT NULL DEFAULT 'active',  -- draft | active | deprecated | archived
  version          int  NOT NULL DEFAULT 1,
  owner            text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text,
  updated_at       timestamptz,
  archived_at      timestamptz,                     -- soft-archive (0009 posture): keep history, drop from active
  archived_by      text,
  CONSTRAINT business_outcome_status_valid CHECK (status IN ('draft','active','deprecated','archived'))
);
CREATE INDEX IF NOT EXISTS idx_business_outcomes_product ON business_outcomes(product_id) WHERE archived_at IS NULL;

-- ── Outcome mutation audit (mirrors graph_events / knowledge_events; denormalized ids; best-effort writes) ──
CREATE TABLE IF NOT EXISTS outcome_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_id  uuid,
  product_id  uuid,
  action      text,                               -- create | edit | deprecate | archive | link
  actor       text,
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outcome_events_outcome ON outcome_events(outcome_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_events_product ON outcome_events(product_id, occurred_at DESC);

-- ── Link existing free-text intent to a real outcome (ADDITIVE — the text columns stay; this is the seam) ──
ALTER TABLE demo_graph_workflows ADD COLUMN IF NOT EXISTS business_outcome_id uuid REFERENCES business_outcomes(id) ON DELETE SET NULL;
ALTER TABLE session_discovery    ADD COLUMN IF NOT EXISTS business_outcome_id uuid REFERENCES business_outcomes(id) ON DELETE SET NULL;

-- ── Stakeholder Registry: EXTEND the per-product buying committee (0012) — never rebuild its governance ──
ALTER TABLE product_stakeholders
  ADD COLUMN IF NOT EXISTS decision_criteria jsonb NOT NULL DEFAULT '[]',  -- what THIS person evaluates on
  ADD COLUMN IF NOT EXISTS goals             jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS objections        jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS questions         jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS version           int   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by        text,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz;

-- ── Influence graph: edges between committee members (who reports-to / influences / defers-to / blocks whom) ──
CREATE TABLE IF NOT EXISTS stakeholder_relationships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_stakeholder_id uuid NOT NULL REFERENCES product_stakeholders(id) ON DELETE CASCADE,
  to_stakeholder_id   uuid NOT NULL REFERENCES product_stakeholders(id) ON DELETE CASCADE,
  relation            text,                       -- reports_to | influences | defers_to | blocks
  weight              text,                       -- low | medium | high
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  archived_at         timestamptz,                -- soft-archive (0009 posture)
  archived_by         text
);
CREATE INDEX IF NOT EXISTS idx_stakeholder_rel_product ON stakeholder_relationships(product_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stakeholder_rel_from ON stakeholder_relationships(from_stakeholder_id) WHERE archived_at IS NULL;

-- 0025: Journey ASSEMBLER outputs — first-class Gap Records + assembler metadata on journeys.
-- Additive + idempotent (mirrors 0020/0021/0024). The Journey Assembler (src/core/journey-assembler.ts) is a
-- downstream CONSUMER of validated VIN intelligence: given org/industry/product/outcome/committee it
-- DISCOVERS existing assets (workflows, tours, validated knowledge, personas, environment), SCORES relevance,
-- DETECTS coverage gaps, ASSEMBLES a DRAFT journey (refs to existing assets only), and SCORES confidence.
-- It is HARD-PROHIBITED from creating any upstream artifact (product/screen/workflow/knowledge/persona/
-- outcome/committee/experience-map node). Every missing dependency becomes a Gap Record here instead.
-- The assembler writes ONLY: one journey (0021) + N gap_records (this table). Nothing else.

CREATE TABLE IF NOT EXISTS gap_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid REFERENCES products(id) ON DELETE CASCADE,
  journey_id   uuid REFERENCES journeys(id) ON DELETE SET NULL,    -- the assembled journey that surfaced it (nullable)
  outcome_id   uuid REFERENCES business_outcomes(id) ON DELETE SET NULL,
  kind         text NOT NULL,        -- MISSING upstream artifact: workflow|tour|knowledge|persona|environment|committee|outcome|screen
  title        text NOT NULL,        -- what's needed (e.g. "No workflow demonstrates outcome 'Reduce approval delays'")
  detail       text,                 -- why it's needed / which target it blocks / where to fill it
  severity     text NOT NULL DEFAULT 'weakens',   -- blocks | weakens
  status       text NOT NULL DEFAULT 'open',      -- open | resolved | dismissed
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by  text,
  resolved_at  timestamptz,
  archived_at  timestamptz,
  archived_by  text,
  CONSTRAINT gap_severity_valid CHECK (severity IN ('blocks','weakens')),
  CONSTRAINT gap_status_valid   CHECK (status IN ('open','resolved','dismissed'))
);
CREATE INDEX IF NOT EXISTS idx_gap_records_product ON gap_records(product_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gap_records_journey ON gap_records(journey_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gap_records_open    ON gap_records(product_id, status) WHERE archived_at IS NULL AND status = 'open';

-- Assembler metadata on the journey it produced (additive; manually-built journeys leave these null).
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS confidence       int;     -- 0..100 assembler confidence (coverage-based)
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS assembled_inputs jsonb;   -- {organization, industry, outcomeId, committee[], assets{}} the run consumed

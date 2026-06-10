-- Guided demo TOURS (record-and-replay). The human-authored, click-through demo model that replaces the
-- node-graph for SCRIPTED demos: a tour is an ordered list of STEPS performed on the REAL product (recorded
-- by driving it in the desktop's embedded browser), each step an ACTION + a caption:
--   steps: [{ kind: 'navigate'|'click'|'note', url?, selector?, label?, caption? }]
--     navigate → load a URL · click → click an element (selector or visible label) · note → caption only.
-- Recorded + replayed entirely client-side in the embedded browser (no server browser, no LLM) — this is
-- the deterministic "click-to-present" path. The Demo Graph stays for the autonomous AI; tours are separate.
-- Additive + idempotent. Org/Site scoping deferred (1-of-each today).
CREATE TABLE IF NOT EXISTS demo_tours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  steps       jsonb NOT NULL DEFAULT '[]',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,          -- soft-archive (0009 posture)
  archived_by text
);
CREATE INDEX IF NOT EXISTS idx_demo_tours_product ON demo_tours(product_id) WHERE archived_at IS NULL;

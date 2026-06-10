-- Demo Graph hardening — first-class workflows, per-node verification, graph versioning + status, and a
-- graph mutation audit. Additive + idempotent (mirrors 0009/0010/0011/0012). The Demo Graph becomes the
-- AI's navigation TRUTH: every node carries a verification_status (driven by recon against the real DOM),
-- graphs are versioned (edit = new version; archive-not-delete), and the autogen pipeline
-- (graph-autogen.ts) seeds DRAFT nodes/workflows derived from the VALIDATED knowledge base, promoted to
-- 'verified' only when the real screen resolves. Scoped to PRODUCT + ENVIRONMENT + VERSION; a `sites`
-- table and organization_id denormalization are DEFERRED until a product gains a 2nd site / a 2nd org
-- exists (see the plan's Deferred table) — environment_id is the real scoping seam today.

-- ── Graph: environment scoping + version + status + verification + computed coverage + soft-archive ──
ALTER TABLE demo_graphs
  ADD COLUMN IF NOT EXISTS environment_id       uuid REFERENCES environments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS graph_version        int  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('draft','active','deprecated','archived')),
  ADD COLUMN IF NOT EXISTS verified_by          text,
  ADD COLUMN IF NOT EXISTS verified_at          timestamptz,
  ADD COLUMN IF NOT EXISTS coverage_score       real,             -- computed by graph-verify (never hand-entered)
  ADD COLUMN IF NOT EXISTS last_navigation_test timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at          timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by          text;
-- One row per (product, name, version) — makes the publish/version-bump flow idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_demo_graphs_pnv ON demo_graphs(product_id, name, graph_version);
CREATE INDEX IF NOT EXISTS idx_demo_graphs_active ON demo_graphs(product_id) WHERE status = 'active' AND archived_at IS NULL;

-- ── Node: real screen metadata + verification (draft until recon confirms the real DOM resolves it).
-- route = existing screen_route; selectors = existing locator_strategies; persona = existing persona_labels. ──
ALTER TABLE demo_graph_nodes
  ADD COLUMN IF NOT EXISTS screen_name          text,
  ADD COLUMN IF NOT EXISTS screen_type          text,
  ADD COLUMN IF NOT EXISTS verification_status  text NOT NULL DEFAULT 'verified'
                             CHECK (verification_status IN ('draft','pending_review','verified','broken')),
  ADD COLUMN IF NOT EXISTS last_verified        timestamptz,
  ADD COLUMN IF NOT EXISTS permissions_required jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS page_version         text;

-- ── Workflow as a first-class entity (today the console's "workflows" count is just COUNT(demo_graphs)).
-- A workflow is an ordered, persona/stakeholder-tagged journey through a graph's nodes. ──
CREATE TABLE IF NOT EXISTS demo_graph_workflows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_graph_id       uuid NOT NULL REFERENCES demo_graphs(id) ON DELETE CASCADE,
  workflow_name       text NOT NULL,
  business_purpose    text,
  stakeholder_type    text,                          -- CEO|COO|CFO|Procurement|HR|… (audience this path is optimized for)
  persona_type        text,                          -- employee|manager|executive|finance|compliance|security|…
  node_sequence       jsonb NOT NULL DEFAULT '[]',   -- ordered intent_labels / node ids the journey traverses
  success_criteria    text,
  verification_status text NOT NULL DEFAULT 'draft'
                        CHECK (verification_status IN ('draft','pending_review','verified','broken')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,                   -- soft-archive (0009 posture)
  archived_by         text
);
CREATE INDEX IF NOT EXISTS idx_dg_workflows_graph ON demo_graph_workflows(demo_graph_id) WHERE archived_at IS NULL;

-- ── Graph mutation audit (mirrors knowledge_events). graph_id/node_id/workflow_id are DENORMALIZED (no FK)
-- so the trail survives a hard-delete — same posture as knowledge_events.chunk_id / audit_turns.persona_name. ──
CREATE TABLE IF NOT EXISTS graph_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id    uuid,
  node_id     uuid,
  workflow_id uuid,
  product_id  uuid,
  action      text NOT NULL CHECK (action IN ('create','edit','validate','verify','drift','deprecate','archive','publish')),
  actor       text,
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_graph_events_graph ON graph_events(graph_id);
CREATE INDEX IF NOT EXISTS idx_graph_events_product_at ON graph_events(product_id, occurred_at);

-- ── Backfill (one-shot; this migration runs once via schema_migrations). Existing seeded graphs/nodes are
-- REAL and drive live demos today, so: graphs → 'active' and nodes → 'verified' (the column DEFAULTs above
-- fill existing rows). Bind each existing graph to its product's environment, and give each a first-class
-- "primary" workflow built from its seeded nodes so the console's workflow count stays truthful (not 0). ──
UPDATE demo_graphs g SET environment_id = (
  SELECT e.id FROM environments e WHERE e.product_id = g.product_id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1
) WHERE g.environment_id IS NULL;

INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, business_purpose, node_sequence, verification_status)
SELECT g.id, g.name, 'Primary demo workflow (backfilled from seeded nodes)',
       COALESCE((SELECT jsonb_agg(n.intent_label ORDER BY n.intent_label) FROM demo_graph_nodes n WHERE n.demo_graph_id = g.id), '[]'::jsonb),
       'verified'
FROM demo_graphs g
WHERE NOT EXISTS (SELECT 1 FROM demo_graph_workflows w WHERE w.demo_graph_id = g.id);

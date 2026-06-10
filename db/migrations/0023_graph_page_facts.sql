-- 0023: Per-page detail model for the Demo Graph — a node can now carry 100% of a page's UX surface
-- (function, fields, buttons, actions, forms, errors, FAQs), not just a route + selectors. Additive +
-- idempotent (mirrors 0013/0022). The element table is the NORMALIZED source of truth (queryable);
-- page_facts is the DENORMALIZED render snapshot written alongside it (re-derivable via
-- graph-elements.assemblePageFacts) so Node Studio renders the full page without N joins. The two never
-- drift because the seed/autogen write both in the same pass.
-- TRUTH/FIREWALL: element labels + detail are BUSINESS-FACING only — RPC names (fn_*), file names (*.ts),
-- and SQL are kept out of anything the demo AI can read (the seed strips them). implementation_status
-- preserves the docs' honesty markers (dead_ui / unwired / unknown) instead of pretending everything works.

-- ── Node: a denormalized snapshot of the page (purpose/layout/counts/faqs) for fast render. ──
ALTER TABLE demo_graph_nodes
  ADD COLUMN IF NOT EXISTS page_facts jsonb NOT NULL DEFAULT '{}';

-- ── Per-node element registry: the real UX surface of a screen, one row per field/button/action/etc.
-- Soft-archive (0009 posture); denormalized source_chunk_id (no FK — survives a chunk delete, same posture
-- as graph_events). ──
CREATE TABLE IF NOT EXISTS demo_graph_node_elements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id               uuid NOT NULL REFERENCES demo_graph_nodes(id) ON DELETE CASCADE,
  element_type          text NOT NULL
                          CHECK (element_type IN ('field','button','action','tab','section','error','faq','workflow_interaction','note')),
  label                 text NOT NULL,
  detail                jsonb NOT NULL DEFAULT '{}',   -- typed bag: {description, visibleTo, enabledWhen, triggers, audit, required, validation, default_value, source, recovery, …}
  implementation_status text NOT NULL DEFAULT 'live'
                          CHECK (implementation_status IN ('live','partial','dead_ui','unwired','unknown')),
  sort_order            int  NOT NULL DEFAULT 0,
  source_chunk_id       uuid,                          -- provenance: the knowledge chunk that grounds this element
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text,
  updated_at            timestamptz,
  archived_at           timestamptz,
  archived_by           text
);
CREATE INDEX IF NOT EXISTS idx_dg_node_elements_node  ON demo_graph_node_elements(node_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dg_node_elements_type  ON demo_graph_node_elements(node_id, element_type) WHERE archived_at IS NULL;
-- One row per (node, element_type, label) — makes the seed/autogen upsert idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dg_node_elements ON demo_graph_node_elements(node_id, element_type, lower(label)) WHERE archived_at IS NULL;

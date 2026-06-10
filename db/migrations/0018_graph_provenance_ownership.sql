-- 0018: Demo Graph provenance + ownership/authorship + node soft-archive (V3.2 Experience-Registry
-- observability). Additive + idempotent (mirrors 0013). Surfaces, from STORED data, WHY a node exists
-- (the faithfulness-gated knowledge sentence that grounded an autogen node + its source chunk), WHO
-- created/changed it, HOW it was last verified, and lets a node be ARCHIVED (never hard-deleted) so the
-- operator can safely override the graph. No behavior change: existing rows get NULL ("not recorded")
-- rather than a fabricated authorship timestamp (truth discipline — never invent).
ALTER TABLE demo_graph_nodes
  ADD COLUMN IF NOT EXISTS business_purpose    text,
  ADD COLUMN IF NOT EXISTS business_outcome    text,
  ADD COLUMN IF NOT EXISTS derived_evidence    text,                                            -- knowledge sentence(s) that grounded an autogen node (faithfulness-gated)
  ADD COLUMN IF NOT EXISTS source_chunk_id     uuid REFERENCES knowledge_chunks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_source text,                                            -- how last verified: autogen-recon | recon | manual | active-node
  ADD COLUMN IF NOT EXISTS created_by          text,
  ADD COLUMN IF NOT EXISTS created_at          timestamptz,                                     -- nullable: existing nodes pre-date authorship tracking ("not recorded")
  ADD COLUMN IF NOT EXISTS updated_by          text,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at         timestamptz,                                     -- soft-archive (0009 posture) — never hard-delete a node
  ADD COLUMN IF NOT EXISTS archived_by         text;
CREATE INDEX IF NOT EXISTS idx_demo_graph_nodes_source_chunk ON demo_graph_nodes(source_chunk_id);

-- Workflows already carry created_at + approved_at/by (0013/0015). Add the remaining authorship/version axis.
ALTER TABLE demo_graph_workflows
  ADD COLUMN IF NOT EXISTS version    int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

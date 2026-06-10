-- Workflow authoring + editorial gate (Demo Graph Workflow Builder).
-- Separates two axes that 0013 conflated into verification_status:
--   • TECHNICAL  (verification_status: draft|pending_review|verified|broken) — are the workflow's nodes
--     reachable on the live site? Machine-owned (node roll-up during validation).
--   • EDITORIAL  (approved_at/approved_by) — is this a journey WE want the consultant to actually use?
--     Human-owned. Autogen creates workflows as SUGGESTIONS (approved_at NULL); the operator approves the
--     ones worth demoing. The live loop now selects by APPROVAL (see selectFromGraph), so an unreviewed
--     autogen suggestion never silently drives a demo.
-- Additive + idempotent (mirror 0009/0013/0014).
ALTER TABLE demo_graph_workflows
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS sort_order  int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dg_workflows_approved ON demo_graph_workflows(demo_graph_id) WHERE approved_at IS NOT NULL AND archived_at IS NULL;

-- Backfill: any workflow already TECHNICALLY verified/pending at migration time was a real, hand-seeded or
-- recon-promoted journey (0013 backfilled the seeded demos to 'verified') — treat those as operator-approved
-- so nothing the AI relied on regresses the moment the approval gate turns on. Pure autogen suggestions are
-- left unapproved (they default to 'draft'). The cross-graph RE-HOMING of stranded approved workflows onto
-- the current ACTIVE graph is done by graph-reconcile.ts (it needs node-label remapping logic, not SQL).
UPDATE demo_graph_workflows
   SET approved_at = COALESCE(approved_at, now()), approved_by = COALESCE(approved_by, 'migration:0015')
 WHERE verification_status IN ('verified', 'pending_review') AND approved_at IS NULL;

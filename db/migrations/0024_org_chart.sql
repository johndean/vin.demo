-- 0024: Org Chart — the REAL organization (imported from a BambooHR export): real people + reporting lines.
-- Additive + idempotent (mirrors 0012/0020). This is DISTINCT from product_stakeholders (the per-product,
-- role-based buying committee): org_people is the actual headcount of an organization, with a reporting tree.
-- The shared export carries names + reporting structure but NO job titles — the operator assigns roles in the
-- console editor (job_title), so we never fabricate a person's role. supervisor_source_id mirrors the source's
-- SupervisorID for a self-referential reporting tree resolved by source_person_id within the same organization.

CREATE TABLE IF NOT EXISTS org_people (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,   -- whose org chart (nullable until linked)
  source_person_id     text,                          -- source system id (BambooHR PersonID) — import idempotency + tree links
  name                 text NOT NULL,
  supervisor_source_id text,                           -- source SupervisorID → resolves to another org_people row's source_person_id
  job_title            text,                           -- the ROLE — operator-assigned in the editor (NOT imported; never fabricated)
  department           text,                           -- operator-assignable
  location             text,
  photo_url            text,                            -- optional (source photo; signed URLs may expire — cosmetic)
  sort_order           int  NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_by           text,
  updated_at           timestamptz,
  archived_at          timestamptz,                    -- soft-archive (0009 posture): keep history, drop from active
  archived_by          text
);
CREATE INDEX IF NOT EXISTS idx_org_people_org ON org_people(organization_id) WHERE archived_at IS NULL;
-- idempotent import: one row per (organization, source person id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_people_source ON org_people(organization_id, source_person_id) WHERE source_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_people_supervisor ON org_people(organization_id, supervisor_source_id) WHERE archived_at IS NULL;

-- Optional seam: link an org person to a per-product buying-committee seat (operator can promote a real person
-- onto a product's committee later). ADDITIVE — product_stakeholders is untouched; this is just a back-reference.
ALTER TABLE product_stakeholders ADD COLUMN IF NOT EXISTS org_person_id uuid REFERENCES org_people(id) ON DELETE SET NULL;

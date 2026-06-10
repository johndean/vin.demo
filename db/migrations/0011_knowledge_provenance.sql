-- Knowledge provenance, lifecycle, and mutation audit. Additive + idempotent (mirrors 0009/0010).
-- Makes every chunk traceable to a real SOURCE (owner / type / verified date) so the AI can state its
-- provenance in dialogue ("per <source>, owned by <owner>, validated by <X> on <date>") instead of citing
-- a bare string. Source is scoped to PRODUCT — one demo target per product today; a `sites` table is
-- deferred until a single product gains a 2nd distinct deployment (see the plan's Deferred table).

-- ── Source as a first-class, governed entity (today `knowledge_chunks.source` is just a free-text string) ──
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_version_id uuid REFERENCES product_versions(id) ON DELETE SET NULL,
  title              text NOT NULL,
  source_type        text NOT NULL DEFAULT 'doc'
                       CHECK (source_type IN ('doc','faq','sop','release_note','competitor_positioning','recon','manual')),
  uri                text,
  owner              text,
  source_quality     real NOT NULL DEFAULT 0.7,   -- 0..1 trust weight of the source class (feeds computeConfidence)
  review_cycle_days  int,                          -- how often this source should be re-verified
  last_verified      date,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  archived_by        text,
  UNIQUE (product_id, title)
);
CREATE INDEX IF NOT EXISTS idx_ksources_product ON knowledge_sources(product_id);

-- ── Chunk provenance + 5-state lifecycle + soft-archive (the archive posture from 0009, now for chunks) ──
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS source_id         uuid REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_state   text NOT NULL DEFAULT 'validated'
                             CHECK (lifecycle_state IN ('draft','pending_review','validated','deprecated','archived')),
  ADD COLUMN IF NOT EXISTS validated_by      text,
  ADD COLUMN IF NOT EXISTS validated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS validation_method text,   -- human_review | multi_source | product_owner | automated
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by       text;
CREATE INDEX IF NOT EXISTS idx_kchunks_source ON knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_kchunks_lifecycle ON knowledge_chunks(lifecycle_state);

-- ── Knowledge mutation audit (create/edit/validate/deprecate/archive/reindex). chunk_id is DENORMALIZED
-- (no FK) so the trail survives a chunk hard-delete — same posture as audit_turns.persona_name. ──
CREATE TABLE IF NOT EXISTS knowledge_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id    uuid,
  source_id   uuid,
  product_id  uuid,
  action      text NOT NULL CHECK (action IN ('create','edit','validate','deprecate','archive','reindex')),
  actor       text,
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kevents_chunk ON knowledge_events(chunk_id);
CREATE INDEX IF NOT EXISTS idx_kevents_product_at ON knowledge_events(product_id, occurred_at);

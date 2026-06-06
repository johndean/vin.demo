-- VIN Demo — entity model (Phase 1 spine)
-- Per handoff §6 / plan §4: build the tables & relations now; defer the FEATURES
-- that hang off them (billing, lifecycle automation, self-service onboarding).
-- The "accept now" gaps are baked into the schema: trust metadata (C), typed
-- knowledge categories (D), discovery fields (E), stakeholder collection (F),
-- execution mode (G), demo environment (H), cost events (J).

CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (default retrieval; Pinecone deferred)
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ── Tenancy spine ────────────────────────────────────────────────────────────
CREATE TABLE organizations (              -- the vendor running demos (your customer)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
  -- DEFERRED: billing/metering hangs here (Gap A) — trigger: pricing validated + first paying customer
);

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'operator',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

-- ── Product & knowledge ──────────────────────────────────────────────────────
CREATE TABLE products (                    -- a product VIN Demo can demonstrate (e.g. PO.vin)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_versions (            -- Gap B: present as a field; lifecycle ENGINE deferred
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version_label  text NOT NULL,            -- e.g. "v2 · Flowint SSOT"
  status         text NOT NULL DEFAULT 'active',   -- active | deprecated | retired
  released_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, version_label)
);

CREATE TABLE knowledge_bases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL
);

-- Gap C (trust metadata) + Gap D (typed categories incl. competitor_positioning),
-- baked in from day one — cheap field-level seam, brutal to retrofit.
CREATE TABLE knowledge_chunks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id   uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  product_version_id  uuid REFERENCES product_versions(id) ON DELETE SET NULL,
  category            text NOT NULL DEFAULT 'docs',  -- docs|faq|sop|release_note|competitor_positioning|...
  content             text NOT NULL,
  embedding           vector(1536),                  -- dim is provider-configurable
  confidence          real NOT NULL DEFAULT 0.0,     -- 0..1
  source              text NOT NULL,
  last_verified       date,
  validation_status   text NOT NULL DEFAULT 'unverified', -- validated|unverified|stale
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_chunks_kb_idx ON knowledge_chunks (knowledge_base_id);
-- ANN index (cosine). Tune lists/ef per data size; placeholder for Phase 1.
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- DemoGraph: intent-targets the navigator heals to (Phase 0 finding #4).
CREATE TABLE demo_graphs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL
);
CREATE TABLE demo_graph_nodes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_graph_id      uuid NOT NULL REFERENCES demo_graphs(id) ON DELETE CASCADE,
  intent_label       text NOT NULL,        -- e.g. "approvals queue"
  screen_route       text,                 -- e.g. "/queue/owner"
  locator_strategies jsonb NOT NULL DEFAULT '[]',  -- ordered fallbacks (id→role→text→semantic)
  persona_labels     jsonb NOT NULL DEFAULT '{}'   -- per-role label map (Manager→"Review Queue", ...)
);

-- Gap H: demo environment is a modeled entity; default routing is NEVER production.
CREATE TABLE environments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name             text NOT NULL,
  connection_target text NOT NULL,         -- URL / tenant
  seed_dataset     jsonb,
  reset_mechanism  text,                    -- script | snapshot | api | manual
  refresh_cadence  text,
  is_production    boolean NOT NULL DEFAULT false,  -- pointing here requires explicit, audited opt-in
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personas (                     -- delegated specialist definitions
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  definition    jsonb NOT NULL DEFAULT '{}'
);

-- ── Customer → demo session → stakeholders ───────────────────────────────────
CREATE TABLE customers (                    -- the prospect being demoed to
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL
);

-- Gap G: execution mode is a first-class, default-deny control on the session.
CREATE TABLE demo_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_version_id  uuid REFERENCES product_versions(id) ON DELETE SET NULL,
  environment_id      uuid REFERENCES environments(id) ON DELETE SET NULL,
  persona_id          uuid REFERENCES personas(id) ON DELETE SET NULL,
  execution_mode      text NOT NULL DEFAULT 'read-only',  -- read-only|safe|approval|execution
  status              text NOT NULL DEFAULT 'active',     -- active|paused|stopped|done
  started_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_mode_valid CHECK (execution_mode IN ('read-only','safe','approval','execution'))
);

-- Gap F: stakeholders are a COLLECTION, not a singular — per-stakeholder tracking.
CREATE TABLE stakeholders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_session_id  uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  name             text,
  role             text,                    -- CFO|IT|Ops|Procurement|Compliance|...
  interests        jsonb NOT NULL DEFAULT '[]',
  open_items       jsonb NOT NULL DEFAULT '[]',
  is_active        boolean NOT NULL DEFAULT false
);

-- Gap E: discovery FIELDS now (pain-point/buying-signal); active behavior deferred to P2.
CREATE TABLE session_discovery (
  demo_session_id  uuid PRIMARY KEY REFERENCES demo_sessions(id) ON DELETE CASCADE,
  pain_points      jsonb NOT NULL DEFAULT '[]',
  buying_signals   jsonb NOT NULL DEFAULT '[]',
  business_objective text
);

-- Gap J: per-demo cost events tagged to the session, queryable from day one.
CREATE TABLE cost_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_session_id  uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  type             text NOT NULL,           -- llm|embeddings|storage|compute|navigation
  tokens           bigint,
  amount_usd       numeric(12,6),
  meta             jsonb NOT NULL DEFAULT '{}',
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cost_events_session_idx ON cost_events (demo_session_id);

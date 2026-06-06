-- 0002 — drop the Phase-0 ivfflat index (exact scan is correct at this scale)
-- and add UNIQUE indexes so the seed upserts have real integrity (finding 10/11).

DROP INDEX IF EXISTS knowledge_chunks_embedding_idx;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_uniq      ON organizations (name);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_org_name_uniq     ON workspaces (org_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS products_ws_name_uniq        ON products (workspace_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_bases_prod_name_uniq ON knowledge_bases (product_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS environments_prod_name_uniq  ON environments (product_id, name);
-- product_versions already has UNIQUE (product_id, version_label) from 0001.

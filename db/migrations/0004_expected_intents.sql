-- 0004 — coverage scoring (P2.4): a small per-product list of intents the knowledge
-- base is expected to answer. Coverage = % of these that retrieve an ungated, trusted
-- chunk (a reported metric, not a gate). UNIQUE so the seed upsert is idempotent.
CREATE TABLE IF NOT EXISTS expected_intents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  intent      text NOT NULL,
  UNIQUE (product_id, intent)
);

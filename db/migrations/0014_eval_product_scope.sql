-- Per-product eval scoping (small win). Tag an eval run with the product it measured, so the console can
-- show per-PRODUCT eval status (a product-specific suite / coverage run vs the global infra suites).
-- Additive + idempotent. product_id is NULLABLE: cross-product / infra suites (phase3 adapter-contract,
-- the fixture-based phase7-12, phase13 isolation) stay GLOBAL (NULL); product-specific runs (coverage per
-- product, phase1=PO.vin) tag it. Org/Environment/Site scoping is DEFERRED — 1-of-each today (same
-- faked-multiplicity discipline as the graph/safety work; trigger: a real 2nd env/site/org).
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_eval_runs_product ON eval_runs(product_id, suite, ran_at DESC);

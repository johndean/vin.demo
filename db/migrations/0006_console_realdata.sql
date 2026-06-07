-- 0006 — console real-data support.
-- Presentation metadata for products/departments (brand mk/color/tagline, segment/stage —
-- real config, not fabricated metrics) and a persisted eval-run history so the console's
-- Eval Harness shows real results instead of mock numbers. (Data fixes — Flowint label
-- cleanup, metadata + persona seeding — run in src/core/seed-console-meta.ts.)

ALTER TABLE products  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS eval_runs (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite   text NOT NULL,                 -- phase1 | phase2 | phase3 | phase4 | coverage
  passed  int  NOT NULL,
  total   int  NOT NULL,
  detail  jsonb NOT NULL DEFAULT '{}',
  ran_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_runs_suite_idx ON eval_runs (suite, ran_at DESC);

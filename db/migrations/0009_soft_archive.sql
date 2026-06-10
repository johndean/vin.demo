-- Soft archive everywhere (no hard deletes — auditability). Active rows have archived_at IS NULL;
-- the console filters Active / Archived / All. archived_by records who archived it.
ALTER TABLE personas      ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE products      ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE customers     ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE environments  ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by text;

-- Product lifecycle status (Draft → Processing → Ready → Failed → Archived) so a product is only
-- "active" once its knowledge is indexed (real onboarding pipeline gates this).
ALTER TABLE products ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';

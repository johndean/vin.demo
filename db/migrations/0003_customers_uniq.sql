-- 0003 — customers uniqueness (increment-3 review, finding [1]).
-- 0002 added UNIQUE (…, name) indexes to the other spine tables for upsert
-- integrity but missed `customers`, so session.ts's
--   INSERT … ON CONFLICT (workspace_id, name) …
-- had no matching constraint: it raised 42P10 on every run and fell through to a
-- catch that swallowed all errors. Add the index that the upsert assumes.
--
-- Defensive de-dupe first so the index applies even over rows the old
-- fall-through path may have written. `customers` has no created_at, so order by
-- id (deterministic). demo_sessions.customer_id is ON DELETE CASCADE, so re-point
-- sessions onto the kept customer BEFORE deleting the duplicates.
UPDATE demo_sessions ds
   SET customer_id = m.keep_id
  FROM (
    SELECT id, first_value(id) OVER (PARTITION BY workspace_id, name ORDER BY id) AS keep_id
      FROM customers
  ) m
 WHERE ds.customer_id = m.id AND m.id <> m.keep_id;

DELETE FROM customers c
 USING (
    SELECT id, first_value(id) OVER (PARTITION BY workspace_id, name ORDER BY id) AS keep_id
      FROM customers
  ) m
 WHERE c.id = m.id AND m.id <> m.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS customers_ws_name_uniq ON customers (workspace_id, name);

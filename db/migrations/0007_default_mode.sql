-- Per-site DEFAULT execution mode for the demo target (read-only | safe | approval | execution).
-- The desktop Control Room initializes its mode picker from this; the operator can still override it
-- per session. Default 'read-only' (safe) so nothing starts able to write until explicitly set.
ALTER TABLE environments ADD COLUMN IF NOT EXISTS default_mode text NOT NULL DEFAULT 'read-only';

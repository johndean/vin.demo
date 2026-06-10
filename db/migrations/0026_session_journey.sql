-- 0026: bind a demo session to the journey it is walking (V5 Journey-driven runtime).
-- The live runtime now READS the journey and walks its story_flow, instead of ignoring it and
-- dropping into free-form ASK. Additive + idempotent. Nullable: ad-hoc/interactive sessions
-- (no pinned journey) keep journey_id NULL and behave exactly as before.
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS journey_id uuid REFERENCES journeys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS demo_sessions_journey_idx ON demo_sessions(journey_id) WHERE journey_id IS NOT NULL;

-- 0029: cross-process DURABLE demo state (RC-30). state_snapshot holds a small resumable slice of the
-- LangGraph DemoState (REPLACE-reducer channels only: journeyStep/currentPosition/sessionStatus/journeyId)
-- so an engine redeploy/crash mid-demo can re-seed the in-process checkpointer and resume coherently.
-- Additive + idempotent (safe to re-run); written/read best-effort and NULL on brand-new sessions.
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS state_snapshot jsonb;

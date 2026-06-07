-- Personas become RUNTIME specialists, not decorative cards. The flexible specialist config
-- (system_prompt, expertise, retrieval_filters, hard_guardrails, allowed/prohibited_actions,
-- escalation_rules, confidence_threshold, voice_profile_id) lives in personas.definition (jsonb) —
-- editable in the console. Here we add only what we QUERY/GATE/AUDIT:
--   • status — lifecycle gate (only 'approved' personas can be activated in a demo).
--   • persona_handoff_events — the real hand-off log behind the metrics (replaces the fake count).
ALTER TABLE personas ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
-- Stable identity per workspace so the specialist roster upserts idempotently (lead + 9 specialists).
CREATE UNIQUE INDEX IF NOT EXISTS personas_ws_name ON personas(workspace_id, name);

CREATE TABLE IF NOT EXISTS persona_handoff_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_session_id uuid REFERENCES demo_sessions(id) ON DELETE CASCADE,
  from_persona_id uuid REFERENCES personas(id) ON DELETE SET NULL,
  to_persona_id   uuid REFERENCES personas(id) ON DELETE SET NULL,
  trigger         text,                       -- 'operator' | 'ai-suggested' | 'auto'
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_handoff_session ON persona_handoff_events(demo_session_id);
CREATE INDEX IF NOT EXISTS idx_handoff_to ON persona_handoff_events(to_persona_id, occurred_at);

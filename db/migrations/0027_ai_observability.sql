-- 0027: AI observability + control.
-- ai_calls = the "AI Conversation History": every LLM call's PROMPT -> REPLY, so the operator can see exactly
-- how the AI is being led. Additive; written best-effort by the LLM provider (never blocks a demo).
CREATE TABLE IF NOT EXISTS ai_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_session_id uuid REFERENCES demo_sessions(id) ON DELETE SET NULL,
  fn text NOT NULL DEFAULT 'llm',          -- which AI function (interpret, answerAs, narrate, …)
  model text,
  system_prompt text,                       -- the system prompt actually sent
  user_prompt text,                         -- the user message(s) actually sent
  reply text,                               -- the model's reply text
  input_tokens int,
  output_tokens int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_session_idx ON ai_calls(demo_session_id, created_at);
CREATE INDEX IF NOT EXISTS ai_calls_fn_idx ON ai_calls(fn, created_at DESC);

-- prompt_overrides = operator edits to the system's DEFAULT AI prompts. The prompt registry default is the
-- fallback; an override here is what the engine actually uses (resolved at call time).
CREATE TABLE IF NOT EXISTS prompt_overrides (
  prompt_key text PRIMARY KEY,
  text text NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

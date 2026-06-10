-- Governance hardening: four auditable control layers around the one loop. Additive + idempotent.
-- Identity governance is a queryable column set (version/owner/approver/approval_date) beside the
-- existing `status` lifecycle gate; behavior rules + citation policy stay in personas.definition (jsonb).

-- ── Identity governance (persona provenance — who owns/approved it, and at which version) ──
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS version       int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS owner         text,
  ADD COLUMN IF NOT EXISTS approver      text,
  ADD COLUMN IF NOT EXISTS approval_date timestamptz;

-- ── Stakeholder governance (who carries influence / risk / decision authority in the room) ──
ALTER TABLE stakeholders
  ADD COLUMN IF NOT EXISTS influence          text,   -- low | medium | high
  ADD COLUMN IF NOT EXISTS risk_level         text,   -- low | medium | high
  ADD COLUMN IF NOT EXISTS decision_authority text;   -- none | influencer | approver | economic_buyer

-- ── Escalation governance (every escalation recorded — mirrors persona_handoff_events) ──
CREATE TABLE IF NOT EXISTS persona_escalation_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_session_id        uuid REFERENCES demo_sessions(id) ON DELETE CASCADE,
  source_persona_id      uuid REFERENCES personas(id) ON DELETE SET NULL,
  destination_persona_id uuid REFERENCES personas(id) ON DELETE SET NULL,
  trigger                text,   -- 'guardrail' | 'out-of-scope' | 'low-confidence' | 'operator'
  reason                 text,
  occurred_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalation_session ON persona_escalation_events(demo_session_id);
CREATE INDEX IF NOT EXISTS idx_escalation_at ON persona_escalation_events(occurred_at);

-- ── Meeting audit trail (one row per turn — everything reconstructable) ──
CREATE TABLE IF NOT EXISTS audit_turns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_session_id    uuid REFERENCES demo_sessions(id) ON DELETE CASCADE,
  persona_id         uuid REFERENCES personas(id) ON DELETE SET NULL,
  persona_name       text,                         -- denormalized so the trail survives persona deletion
  prompt_version     int  NOT NULL DEFAULT 1,
  utterance          text,
  intent             text,
  knowledge_used     jsonb NOT NULL DEFAULT '[]',  -- [{source, confidence, product_version, validation_status}]
  citations          jsonb NOT NULL DEFAULT '[]',
  confidence_band    text,                         -- high | medium | low | very_low
  actions_considered jsonb NOT NULL DEFAULT '[]',
  actions_rejected   jsonb NOT NULL DEFAULT '[]',
  handoff            jsonb,                         -- {fromPersona, toPersona} when one occurred
  escalation         jsonb,                         -- {trigger, reason, toPersona} when one occurred
  compliance         jsonb NOT NULL DEFAULT '{}',  -- {ok, action, violations:[{layer, rule, detail}]}
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_turns(demo_session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_persona ON audit_turns(persona_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_turns(occurred_at);

-- 0028_app_settings.sql — generic runtime key/value settings, changeable from the web console without a
-- redeploy. First use: 'ai_model' — the Claude model the demo brain runs on (settings.ts). Additive +
-- idempotent (safe to re-run). The web "AI Control" page reads/writes it through the engine's RBAC proxy.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per-product SCRIPTED demo room. Additive + idempotent (mirrors 0009/0010/0011).
-- The multi-stakeholder "room" (a CFO + a Procurement lead the AI tailors to) is a SCRIPTED-demo device:
-- the reel/convo address named people by name. Until now those names were HARDCODED in stakeholders.ts
-- (Dana/Morgan) and seeded into EVERY session — so a LIVE interactive demo, with one real operator, made
-- the AI address two people who don't exist. The fix splits the two modes: live sessions seed NO room;
-- scripted sessions seed FROM this per-product roster (so each product's demo addresses the RIGHT buyer
-- personas — a Finance Controller for expense.vin, a CE Director for ce.vin, …), editable in the console.
-- Empty roster → the code DEFAULTS still apply, so the reel keeps working until a product is configured.

CREATE TABLE IF NOT EXISTS product_stakeholders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name               text NOT NULL,
  role               text,
  interests          jsonb NOT NULL DEFAULT '[]',   -- what this person cares about (the AI weighs these)
  influence          text,                          -- low | medium | high
  risk_level         text,                          -- low | medium | high
  decision_authority text,                          -- none | influencer | approver | economic_buyer
  sort_order         int  NOT NULL DEFAULT 0,        -- display + seed order (first = opening active speaker)
  created_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,                   -- soft-archive (0009 posture): remove from the room, keep history
  archived_by        text
);
CREATE INDEX IF NOT EXISTS idx_product_stakeholders_product ON product_stakeholders(product_id) WHERE archived_at IS NULL;

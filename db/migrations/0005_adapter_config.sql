-- 0005 — config-as-data (P4.1, self-service onboarding). The per-product interaction
-- adapter config (ProductWebConfig) lives on the product's environment, so onboarding a
-- new product becomes a DATA operation (no code). getAdapter() prefers this column; the
-- in-code registry stays as a fallback for the originally hand-configured products.
ALTER TABLE environments ADD COLUMN IF NOT EXISTS adapter_config jsonb;

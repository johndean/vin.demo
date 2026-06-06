# Database — entity model

Postgres + **pgvector** (Railway-hosted). The schema is the Phase 1 spine from handoff §6 / plan §4.

## Apply

```bash
psql "$DATABASE_URL" -f db/migrations/0001_entity_model.sql
```

`DATABASE_URL` is a Railway Postgres connection string (keep it in the gitignored `.env`). Requires the `vector` and `pgcrypto` extensions (the migration creates them).

## What's modeled now vs deferred

**Built now (tables + relations):** the full spine `Organization → Workspace → {User, Product → {Version, KnowledgeBase, DemoGraph, Environment}, Persona, Customer → DemoSession → {StakeholderGraph, Discovery, CostEvents}}`, plus the "accept now" gaps baked into columns:

| Gap | Where |
|---|---|
| C — trust metadata | `knowledge_chunks.{confidence, source, last_verified, validation_status, product_version_id}` |
| D — competitive as a category | `knowledge_chunks.category` (`competitor_positioning` is just a value) |
| E — discovery fields | `session_discovery.{pain_points, buying_signals, business_objective}` |
| F — stakeholder collection | `stakeholders` (one row per stakeholder, `is_active` flag) |
| G — execution mode (default-deny) | `demo_sessions.execution_mode` default `read-only` + CHECK |
| H — demo environment | `environments` (incl. `is_production` guard, `reset_mechanism`) |
| J — cost events | `cost_events` per session |

**Deferred (NOT built — see [../docs/deferral-register.md](../docs/deferral-register.md)):** billing/metering (hangs off `organizations`), product-lifecycle automation (a `status` field exists on `product_versions`; the engine is deferred to P3), self-service onboarding.

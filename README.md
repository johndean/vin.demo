# VIN Demo

An **Autonomous AI Solution Consultant** that demonstrates software products to stakeholders — intent-driven, never script-driven.

> ⚠️ **Unconfirmed:** whether "VIN" is a rebrand of this concept or a specific product/domain. Confirm with the founder before any product-specific content.

## Status

**Phase 0 — not yet started.** First task is to stand up a demo environment (seed data + reset script), then prove the core loop on one web app, web-only, in read-only mode. See [docs/plans/](docs/plans/).

## Operating rules (the two that override everything)

1. **No "zero-redesign" over-engineering.** Cheap change at clean seams + every deferral tracked. Target is *zero untracked gaps*, never a completeness score.
2. **Intent-driven, never script-driven.** Questions interrupt the planned demo.

Read [CLAUDE.md](CLAUDE.md) (the handoff brief) before contributing.

## Key documents

- [CLAUDE.md](CLAUDE.md) — handoff brief / operating guidance (start at §5)
- [docs/plans/VIN-Demo-Implementation-Plan-v2.md](docs/plans/VIN-Demo-Implementation-Plan-v2.md) — full architecture & phase plan
- [docs/adr/](docs/adr/) — architecture decision records (no posture deviation without an ADR)
- [docs/deferral-register.md](docs/deferral-register.md) — every deferred item + its revisit trigger

## Stack (target)

React/TS/Next.js · Node/TS · PostgreSQL (+pgvector) · Redis · LangGraph · Playwright · LangSmith · OpenTelemetry · GitHub · Railway → AWS later. **No Electron yet** (web only through P4). Pinecone deferred.

## Repos & hosting

- **Dev:** https://github.com/vin-swe/vin.demo (git remote `origin`)
- **Production:** https://github.com/johndean/vin.demo (git remote `production`)
- **Hosting:** Railway (if/when required)

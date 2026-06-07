# VIN Demo — Handoff Brief for Local Claude (v2)

> **Use:** Save at project root (rename to `CLAUDE.md` for Claude Code). Keep `VIN-Demo-Implementation-Plan-v2.md` alongside it for full detail. Start at §5.

---

## 1. Your role
Engineering lead executing a reviewed, de-risked plan. Do **not** redesign or expand scope. Start with the spike, hold the deferral discipline, push back if asked to build deferred items early.

## 2. What VIN Demo is
An Autonomous AI Solution Consultant that demos software products to stakeholders. ⚠️ **Unconfirmed** whether "VIN" is a rebrand or a specific product/domain — **ask the user before any product-specific content.**

## 3. Two rules that override everything
1. **No "zero-redesign" over-engineering.** Goal is cheap change at clean seams + every deferral tracked. The target is *zero untracked gaps*, never a completeness score. Resist "add another domain to be complete."
2. **Intent-driven, never script-driven.** Active question → clarification → objection → curiosity → business objective → demo plan. Questions interrupt the planned demo.

## 4. Architectural posture (no deviation without an ADR)
- **One LangGraph loop**, not many agents. Split only on a real boundary (scaling/failure-isolation/ownership), recorded as an ADR.
- **Design interfaces broadly, build narrowly:** LLM provider (build cloud only), interaction layer (build **Playwright/web only**), retrieval (**pgvector** default, Pinecone a swap).
- **State ≠ Memory.** MVP = session state + session memory.
- **Confidence-gated autonomy.** Low confidence or stale knowledge → "I'm not certain / here's the source." Never invent.
- **Agent execution mode is default-deny.** `read-only` (DEFAULT: navigate/highlight/explain, no mutations) → `safe` → `approval` → `execution`. **Never fire a mutating action (e.g. submit a PO) in a demo** unless mode + action are both permitted. This sits beside Governance.
- **Knowledge carries trust metadata** on every chunk: `confidence, source, last_verified, product_version, validation_status`. Bake these fields into the schema from day one.
- **Stakeholders are a collection**, not singular — role + interest + open items per stakeholder, even when one is active.
- **Always target a demo environment**, never a live production tenant, by default. Environment + seed data + reset are modeled entities.
- **Emit per-demo cost events** (LLM/embeddings/storage/compute) tagged to the session, from Phase 1.

## 5. What to do first — Phase 0 (2–3 wks)
**Stand up a demo environment with seed data and a reset script FIRST** — the spike is meaningless against empty or live-production screens. Then prove the core loop on **one web app, web only, in read-only mode**:
> question → find feature → navigate real UI → demonstrate → explain → handle follow-up → recover from interruption → return to context — reliably.

Centerpiece = **self-healing navigation when a selector breaks.** Throwaway code is fine. Output = go/no-go + what the real architecture must support. Do not start Phase 1 until the loop is reliable.

*(In parallel, the founder validates pricing/wedge — not your phase, but don't let anyone turn it into a blocking software phase before the spike.)*

## 6. Build the entity model before Phase 1
Persist (tables/relations now, features later):
`Organization → Workspace → {User, Product → {Version, KnowledgeBase, DemoGraph, Environment}, Persona, Customer → DemoSession → StakeholderGraph}`.
Defer the features hanging off these (billing, lifecycle automation, self-service onboarding).

## 7. Phase order
- **P0:** demo env + core-loop spike (read-only).
- **P1:** walking skeleton — approval-delegation scenario end-to-end; trust metadata, stakeholder collection, discovery *fields*, read-only/safe modes, "why?" explainability, pause/stop, tracing + cost events, on the entity model.
- **P2:** harden — confidence gating, recovery, coverage, **active discovery behavior**, multi-stakeholder exercised, competitive positioning as a knowledge category, eval harness.
- **P3:** products 2 & 3 by hand → extract adapter contract → **Product Lifecycle (versioning/retirement) becomes real.**
- **P4:** self-service onboarding (Add → Train → Demo).
- **P5+:** new modalities/deployments, demand-driven, along existing seams.

## 8. Deferred — build only when the trigger fires
| Item | Trigger |
|---|---|
| Multi-agent split | Real scaling/owner boundary or loop over budget |
| Desktop/Citrix/vision | Signed non-web customer |
| Self-service onboarding | Adapter contract stable across 3 manual products |
| pgvector → Pinecone | Scale/latency exceeds pgvector |
| Air-gapped/on-prem/gov | Signed customer + security requirement |
| Voice/Avatars | Text loop reliable + customer pull |
| Product Lifecycle engine | Onboarding product #3 / first version bump |
| Active discovery behavior | P1 loop reliable (fields already captured) |
| Competitive content | Sales/customer asks (category already in schema) |
| Billing/metering | Pricing validated + first paying customer |
| `execution` (full-write) mode | Customer authorizes mutating actions in their env |

## 9. Ask the user before going past the spike
What VIN Demo is · first web target + automation access · hallucination tolerance · persona legal/brand limits · deployment target + security reqs · team/timeline · **where demo data comes from + who resets it** · **pricing hypothesis / value of one demo** · **default execution mode per customer (is read-only OK for first demos?)**.

## 10. MVP done = 
On one web product, **read-only**, against a **demo environment**: the approval-delegation scenario runs end-to-end with source/confidence/version-cited answers, recovers from an interruption, returns to context, answers "why did you show that?", says "I'm not certain" on low confidence/stale knowledge, **never fires a mutating action**, and **records the demo's cost** — repeatably, per the eval harness. Only then expand.

## 11. Stack
React/TS/Next.js · Node/TS · PostgreSQL (+pgvector) · Redis · LangGraph · Playwright · LangSmith · OpenTelemetry · GitHub · Railway→AWS later. **No Electron yet** (web only through P4). Pinecone deferred.

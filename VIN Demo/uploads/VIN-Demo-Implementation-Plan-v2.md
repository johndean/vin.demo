# VIN Demo — Architecture & Implementation Plan (v2)

*Incorporates the second-round gap review (Gaps A–J). Supersedes the v1 revised plan.*

---

## 0. Standing assumptions (unchanged)

- **VIN Demo** = an Autonomous AI Solution Consultant that demonstrates software products to stakeholders. Still **unconfirmed** whether "VIN" is a rebrand of this concept or a specific product/domain — confirm before any product-specific content.
- Initial deployment target: managed SaaS, single-tenant-per-customer or row-isolated multi-tenant. No VPC/on-prem/air-gapped/government yet.

---

## 1. The goal, restated (and a warning about this round)

The goal is **not** "zero gaps." It is **zero *untracked* gaps**: every gap is named, and either built now or deferred with a recorded reason and a revisit trigger.

The v2 review is strong and most of its additions are accepted below. But its closing frame — "add ten domains → ~98% zero-gap" — is the original "design everything" instinct returning in new clothes. You do not get closer to done by adding domains; you get closer to done by proving the core loop with real customers, then expanding along clean seams. The review itself concedes the final 2–3% only comes from real-world usage. So: we incorporate what's genuinely cheap-now or safety-critical, we place the rest by phase, and we drop the percentage scoring entirely.

The two override rules are unchanged: **intent-driven, never script-driven**, and **no zero-redesign over-engineering**.

---

## 2. Disposition of the ten gaps

| Gap | Verdict | Where it lands |
|---|---|---|
| **A. Commercial / Business Domain** | Split. Entity model: accept now. Billing system: defer. Business *validation*: parallel founder track. | Entity model sketched before Phase 1; billing deferred; validation runs alongside Phase 0. |
| **B. Product Lifecycle (versioning/retirement)** | Accept, defer | Phase 3 (becomes real after product #3). |
| **C. Knowledge Trust (version, last-verified, validation status)** | Accept now | Knowledge schema, Phase 1. Cheap field-level seam; brutal to retrofit. |
| **D. Competitive Intelligence** | Accept as a *knowledge category*, not a new engine | Schema gets a `competitor_positioning` type now; content added on demand. |
| **E. Discovery Intelligence** | Split. State *fields* now; active *behavior* later. | Pain-point/buying-signal fields in state Phase 1; discovery behavior Phase 2+. |
| **F. Multi-Stakeholder Graph** | Accept now | Model stakeholders as a collection from day one; exercise multi actively in Phase 2. |
| **G. Agent Safety Model** | Accept now — **elevated to MVP** | Read-only is the *default* execution mode from Phase 0. This was under-weighted in v1. |
| **H. Demo Environment Strategy** | Accept now — **changes Phase 0** | The spike needs a demo tenant with data + a reset story. Prerequisite, not afterthought. |
| **I. ADR Policy** | Accept now | Upgrade the decision-log template (§8). |
| **J. Cost / Unit Economics** | Accept telemetry now; analysis parallel | Per-demo cost instrumented in observability Phase 1; unit-econ analysis is founder work. |

---

## 3. Architectural posture (v2 additions in **bold**)

- **One orchestrated LangGraph loop**, not ten agents. Split only on a real boundary, recorded as an ADR.
- **Design interfaces broadly, build implementations narrowly.** Seams: LLM provider (cloud only built), interaction layer (Playwright/web only built), vector retrieval (pgvector default).
- **State ≠ Memory.** MVP = session state + session memory.
- **Confidence-gated autonomy** with graceful degradation; never invent.
- **NEW — Agent execution mode is a first-class, default-deny control.** Four modes: `read-only` (navigate/highlight/explain, no mutations — the **default**), `safe` (whitelisted non-destructive actions), `approval` (mutating actions require human confirm), `execution` (full, only when explicitly granted). The system must *never* fire a real workflow (e.g. submit a PO) in a demo unless the mode and the action are both permitted. This sits beside Governance, not inside Recovery.
- **NEW — Knowledge carries trust metadata as a hard schema requirement:** every chunk/answer surfaces `confidence`, `source`, `last_verified`, `product_version`, `validation_status`. An answer below threshold or tied to a stale product version degrades to "let me show you the source / I'm not certain." Prevents confidently demoing obsolete functionality.
- **NEW — Stakeholders are a collection, not a singular.** State models a stakeholder graph (role + interest + open items per stakeholder) even when only one is active, so a multi-stakeholder meeting (CFO/IT/Ops/Procurement/Compliance) needs no schema change later.
- **NEW — Demo data is part of the architecture.** The interaction layer always points at a **demo environment**, never a customer's live production tenant, by default. Environment, its seed data, and its reset mechanism are modeled entities.
- **NEW — Cost is telemetry, not an afterthought.** Every demo emits cost events (LLM tokens, embeddings, storage, navigation/compute) tagged to a demo session, so per-demo and per-customer unit cost is queryable from day one.

---

## 4. Business entity model (Gap A, the part we build now)

Sketch and persist these before Phase 1 — they're the spine of any SaaS and are cheap now, expensive later:

```
Organization        # the vendor running demos (your customer)
 └─ Workspace        # a team / environment within the org
     ├─ User         # human operators, with roles
     ├─ Product      # a product VIN Demo can demonstrate
     │   ├─ Version          # Gap B hooks here (deferred engine, present field)
     │   ├─ KnowledgeBase    # carries trust metadata (Gap C)
     │   ├─ DemoGraph        # feature/screen/workflow graph
     │   └─ Environment      # demo tenant + seed data + reset policy (Gap H)
     ├─ Persona      # delegated specialist definitions
     └─ Customer     # the prospect being demoed to
         └─ DemoSession
             └─ StakeholderGraph   # collection, not singular (Gap F)
```

Build the *tables/relations* now. Defer the *features* that hang off them (billing on Organization, lifecycle automation on Version, multi-product self-service on Product).

---

## 5. Phased build order (v2)

**Parallel track — Business validation (founder, ongoing from now).** Pricing hypothesis, wedge customer, what a demo is worth. This answers Gap A/J's *commercial* questions without blocking engineering. It is not a software phase.

**Phase 0 — Core-loop spike + demo environment (2–3 wks).** Unchanged in intent, with one addition: **stand up a demo environment with seed data and a reset script first** — the spike is meaningless against empty or live-production screens. Prove the loop on one web app, web only, **in read-only mode**, with self-healing navigation as the centerpiece. Output: go/no-go + what the real architecture must support.

**Phase 1 — Walking skeleton (4–6 wks).** The approval-delegation scenario end-to-end, real but thin: single LangGraph loop; retrieval with **trust metadata (C)**; Playwright nav with one self-heal strategy; state that survives interrupts, modeling a **stakeholder collection (F)** and **discovery fields (E)**; **read-only/safe execution modes (G)**; "why did you show this?" answerable; pause/stop governance; tracing **+ per-demo cost events (J)**. Persist on the **entity model (§4)**.

**Phase 2 — Harden + enrich (4–6 wks).** Confidence gating + degradation; recovery for broken selectors / missing screens; coverage scoring; **active discovery behavior (E)** layered on the proven loop; **multi-stakeholder handling exercised (F)**; **competitive positioning as a knowledge category (D)**; eval harness (intent/nav/hallucination/recovery/context-retention).

**Phase 3 — Products 2 & 3 (manual) + lifecycle (B).** Onboard by hand to discover the adapter contract; now **Product Lifecycle (versioning, update, retirement, release-sync) becomes real (B)** because you're feeling product drift for the first time.

**Phase 4 — Self-service onboarding.** Turn the learned adapter contract into "Add → Train → Demo."

**Phase 5+ — Modality & deployment expansion, demand-driven.** New interaction adapters / deployment targets only on signed-customer triggers, along existing seams.

---

## 6. New domains — concise specs

**Agent Safety Layer (G).** Default-deny execution model (read-only → safe → approval → execution). Action classifier tags every candidate action as read/non-destructive/mutating. Mode + action permission both required to act. Confidential-screen and customer-data guards. Hard kill (emergency stop) always available. Logged for audit and explainability.

**Knowledge Governance (C/D).** Trust metadata on every chunk (`confidence/source/last_verified/product_version/validation_status`) + typed categories (`docs/faq/sop/release_note/competitor_positioning/...`). Stale-version and low-confidence both trigger graceful degradation. Validation status is set by ingestion + (later) human review.

**Demo Environment (H).** Environment entity per product: connection target, seed dataset, scenario fixtures, reset mechanism, refresh cadence. Default routing is always to a demo environment; pointing at production requires explicit, audited opt-in.

**Cost & Unit Economics (J).** Cost events per demo session tagged by type. Dashboards for per-demo and per-customer cost. Budgets/alerts later. The *pricing/margin decision* is the parallel business track, not this telemetry.

**Stakeholder Graph (F).** Per-session collection of stakeholders, each with role, interests, raised questions/objections, and open items, tracked independently so coverage and follow-up are per-stakeholder.

---

## 7. Deferral register (updated — this is the zero-untracked-gaps guarantee)

| Deferred item | Trigger to revisit |
|---|---|
| Multi-agent split | Tool needs independent scaling/owner, or loop exceeds latency/complexity budget |
| Desktop / Citrix / vision automation | Signed customer requiring a non-web target |
| Self-service product onboarding | Adapter contract stable across 3 manually onboarded products |
| pgvector → Pinecone | Retrieval scale/latency exceeds pgvector |
| Air-gapped / on-prem / government | Signed customer + security requirement |
| Voice / Avatars | Core text loop hits target reliability + customer pull |
| **Product Lifecycle engine (B)** | **Onboarding product #3 / first product version bump** |
| **Active discovery behavior (E)** | **Phase 1 loop reliable; fields already captured** |
| **Competitive content (D)** | **Sales/customer asks; category already in schema** |
| **Billing/metering system (A)** | **Pricing validated + first paying customer; entity already modeled** |
| **`execution` (full-write) mode (G)** | **Customer explicitly authorizes mutating actions in their env** |

---

## 8. ADR template (Gap I — upgraded from the plain decision log)

Every major decision records: **Decision · Alternatives considered · Reasoning · Tradeoffs accepted · Revisit trigger · Status (proposed/accepted/superseded)**. The deferral register (§7) is the trigger column made operational.

---

## 9. Open questions (v2 additions in **bold**)

1. **What is VIN Demo actually?** (Blocks product-specific content.)
2. First web-app target for Phase 0, with legitimate automation access.
3. Hallucination tolerance in a live demo.
4. AI persona legal/brand constraints.
5. Initial deployment target + first customer security requirements.
6. Team size & timeline.
7. **Where does demo data come from for the first target, and who owns resetting it? (H)**
8. **What's the pricing hypothesis / what is one demo worth? (A/J — parallel track)**
9. **Default execution mode per customer — is read-only acceptable for the first demos, or do any require mutating actions? (G)**

---

## 10. MVP definition of done (v2)

On one web product, in **read-only mode**, against a **demo environment**, a stakeholder asks *"How does approval delegation work?"* and the system reliably: understands intent → retrieves the answer **with source, confidence, and product version** → selects the right feature/screen → navigates → demonstrates → explains business value → handles a follow-up → recovers from an interruption → returns to context → continues — answers *"why did you show that?"* — gracefully says *"I'm not certain"* on low confidence or stale knowledge — **never fires a mutating action** — and the run's **cost is recorded**. Measured repeatably by the eval harness. Only then expand.

# Phase 3 — Products 2 & 3 + lifecycle (plan)

**Goal (impl plan §Phase 3):** onboard products 2 & 3 by hand to **discover the adapter contract**, and — because we're feeling product drift for the first time — make the **Product Lifecycle engine (Gap B)** real.

**Founder decisions (2026-06-06):** products 2 & 3 are **real web products**; **build Gap B now**.

Per-increment rhythm unchanged: build → live → adversarial review → eval gate → commit.

## Increments
- [x] **P3.1 — Extract the adapter contract.** Generalize the PO.vin-hardwired `PoVinDriver` into a product-agnostic `InteractionAdapter` interface + a per-product adapter registry (mirroring the `embeddings`/`llm` provider+registry pattern). Product-specific bits (base URL, login selectors + post-login success signal, the "open a record" step) become **per-product config** (carried on the `environments` row), not hardcoded; the generalizable bits (DemoGraph-driven self-heal, the fail-closed action classifier, `scanActions`) stay shared. PO.vin becomes the first adapter *through* the contract. `eval:phase1`/`eval:phase2` stay green.
  - **Done.** `WebAdapter` + `InteractionAdapter` interface + `getAdapter` registry; PO.vin & expense.vin are configs; `graph.driveTo` resolves the product name → adapter. **`eval:phase1` 8/8 through the new adapter** (PO.vin unchanged); **expense.vin drives read-only live** (logs in, navigates to Approvals, blocks mutations on the real screen). Onboarding #2 surfaced + fixed 2 classifier bugs (verb-vs-noun: "Approvals"/"Delegation" nav no longer misread as the verbs approve/delegate; leading-interrogative help buttons classified read before the verb scan). Tracked → P3.5: a clickable stat card with verb text ("Direct + delegated") is still a confident-mutation false positive — `scanActions` could filter to true action elements.
- [ ] **P3.2 — Product Lifecycle engine (Gap B).** `product_versions.status` (active | deprecated | retired) made real; a version-bump flow (a new active version supersedes the prior → deprecated); stale-version answer **degradation** wired to the existing trust metadata (Gap C) — an answer tied to a deprecated/retired version degrades to "let me show you the current version / I'm not certain." **[unblocked — start now]**
- [x] **P3.3 — Onboard real product #2 — expense.vin (by hand).** *(Founder chose to onboard #2 before extracting the contract, so it can shape the contract.)*
  - **Done:** reconned read-only (ADMIN + MANAGER) via `recon-expense.ts`; founder-approved scenario (Manager expense approval, screen-level) + knowledge. Onboarded into the entity model (`npm run seed:expense`): product `expense.vin`, v1, environment `https://www.expense.vin`, 4 trust-tagged chunks, DemoGraph (Approvals, Delegation), 5 expected intents. **Retrieval verified — coverage 4/5 (80%).** Recon learnings for the contract: hash-route SPA, button-based nav, email/password login, `/#/dashboard` success signal.
  - **Done.** Live read-only navigation works through the P3.1 contract: logs into the real expense.vin, navigates to the Manager Approvals screen, blocks mutating actions (screen-level — queue empty by design). **P3.3 complete.**
- [x] **P3.4 — Onboard real product #3 — rounds.vin (by hand).** A medical content **production pipeline** — a different domain from the approval apps, the real contract test.
  - **Done.** Reconned read-only; knowledge corroborated by the Rounds API spec; onboarded (`npm run seed:rounds`) with **one new WebAdapter config entry** (hash SPA, `/signin` login, `<a href>` nav) and **no new adapter code**. Live read-only nav works (logs in, navigates the pipeline dashboard, blocks mutations); coverage 4/5. **The single contract now drives 3 real products** (po.vin approvals · expense.vin reimbursement · rounds.vin pipeline) → the **P4 self-service trigger** ("adapter contract stable across 3 manually onboarded products") is now in reach.
  - **ce.vin (#4) queued** — a different stack (custom auth); needs a login-selector discovery pass before onboarding.
- [ ] **P3.5 — Validate + `eval:phase3`.** Assert the contract holds across 3 products (the loop runs read-only on each), a version bump degrades a stale answer, and onboarding is config-not-code wherever the contract allows.

## What I need from you to onboard each real product (P3.3 / P3.4)
Non-secret details go here in chat; **credentials go in `.env`, never the chat** — follow the `PO_VIN_*` pattern.
1. **Name** + **base URL** + **login URL**.
2. **Login flow**: email/password field selectors + a post-login success signal (a button/text proving you're in), and the role(s)/personas. Credentials → `.env` as `PRODn_<ROLE>_USER` / `PRODn_<ROLE>_PASS`.
3. **Knowledge**: the docs/content to seed (paste, a URL, or a file) — with source + confidence + version so trust metadata is real.
4. **Target feature + screens**: the demo scenario (PO.vin's was approval delegation) and the intents/screens to navigate, with candidate locator strategies.

## Deferral discipline (unchanged)
Self-service onboarding stays **P4** (trigger: adapter contract stable across 3 manually onboarded products). Competitive content (D) still deferred (trigger: sales/customer asks). Billing (A), new modalities — deferred.

## Done =
`InteractionAdapter` contract implemented by ≥3 products; lifecycle engine live (a version bump degrades a stale answer); `eval:phase1` 8/8, `eval:phase2` green, `eval:phase3` green; onboarding is config-driven wherever the contract allows.

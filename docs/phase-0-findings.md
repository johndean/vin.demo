# Phase 0 — Core-loop spike findings & go/no-go

**Date:** 2026-06-06 · **Target:** PO.vin ("Purchase Hub") · **Mode:** read-only · **Persona:** Admin

## Verdict: **GO**

The core loop runs reliably end-to-end against a real product, read-only. The scenario *"How does approval delegation work?"* executes: intent → cited answer (with trust metadata + confidence gate) → navigate the real UI → self-heal a broken selector → open the pending PO → demonstrate the delegation control → **never fire a mutating action** → show the Bypassed (delegated) queue.

Spike code is throwaway and lives in [`src/spike/`](../src/spike/). Run: `npm run recon` (observe-only map) and `npm run demo` (the scenario).

### Repeatable check
`npm run eval` runs the scenario once and asserts the MVP guarantees, exiting non-zero on any failure (CI / pre-Phase-1 gate). Current: **7/7 PASS** — intent routed, answer cited (confidence + version), ≥2 self-heals, real PO opened, Approve + Delegate both blocked, zero mutating actions fired.

### PO.vin data note (for the founder, not a spike bug)
The Manager account's queue badge says "Review Queue 3" but its `pos?tab=manager` API returns **200 with 0 rows** — the badge counter and the role-filtered list query disagree (those 3 POs aren't assigned to that specific manager). The Admin view sees all rows at a stage regardless of assignment, so the eval runs as Admin. Worth reconciling badge-vs-list on PO.vin's side.

### Evidence (latest run)
- **Self-healing navigation: 2/2.** Both deliberately-stale primary selectors broke and recovered via semantic fallbacks (`#sidebar-approval-queue-v1` → `button:has-text("Manager Queue")`; `.legacy-bypassed-link` → `button:has-text("Bypassed")`).
- **Read-only guard blocked 6 live mutating controls** on the real PO detail: Approve, Delegate to teammate, Put on Hold, Reject Request, Cancel PO, Post comment. None were clicked — nothing was submitted to the production system.
- **Cited answer + confidence gate:** answer surfaced `source · confidence 0.82 · version v2 · validated`; below-threshold/stale degrades to "I'm not certain / here's the source."
- Screenshots in `tmp/demo/` (gitignored).

## What we learned about the target (PO.vin)
- Vue SPA, **Supabase-backed** (`functions.supabase.co/hub-api/*`, auth via `hub-auth/login`). All writes route through `hub-api` with an idempotent `mutation_intent_id`; every write hits `audit_logs` + `hub_audit_log` (clean audit trail).
- **Login is flaky** — the app can route to the dashboard before the token persists, then bounce back to `/login`.
- **Navigation is role-relative.** The same queue is labelled differently per persona: Manager → "Review Queue", Owner → "Approval Queue", Admin → "Manager Queue"/"Owner Queue". Available sidebar sections also differ (Bypassed is Owner/Admin only).
- **Per-role seed data is inconsistent.** Admin reliably sees pending POs; the Manager/Owner role accounts' own queues showed empty/"Loading…" during the spike.
- Real URL routes exist (`/queue/manager`, `/po/:id`); queue lists load via a slower async call (show "Loading…" before rows render).

## What the real architecture must support (the Phase 0 output)
1. **A per-target interaction adapter** with resilient auth: response-aware login (wait on `hub-auth/login`), readiness checks against semantic elements (not URL/DOM-ready), and bounce-retry. Session/token handling belongs in the adapter, not the loop.
2. **Async-render awareness.** "Navigation complete" is a *semantic* condition (the data-loaded view is present), not a load event. The navigator must wait for intent-relevant content.
3. **Persona/role as a first-class input.** Nav vocabulary and feature availability are role-dependent. The **DemoGraph** must store per-role labels + capabilities, and the **Persona/Stakeholder** model must drive which persona the demo runs as. (Confirms the plan's stakeholder-collection design.)
4. **Self-healing navigation via a DemoGraph of intent-targets**, each with ordered locator strategies (id/testid → role/text → semantic). Spike proved primary→text recovery; the real version adds visual/LLM-assisted recovery and treats recovery as first-class (Phase 2).
5. **A real action-classifier for the safety layer, not a text regex.** The text guard works but is brittle (it false-positives on help text like "How do I use Approve…?", filtered here by a hack). The real default-deny guard must classify by element role/intent/context. The default-deny posture itself is validated.
6. **Retrieval with trust metadata.** The stubbed KB must become pgvector retrieval carrying `confidence/source/last_verified/product_version/validation_status` (Phase 1).
7. **LLM seam (Claude).** ✅ Done — intent parsing (structured output) and natural explanation now run through `claude-opus-4-8` via the official SDK (`src/spike/llm.ts`), grounded in the retrieved chunk and required to cite source/confidence/version; falls back to deterministic behaviour with no key. The real architecture needs this behind a provider interface (cloud-only build) plus per-demo cost events on each call.
8. **Cost events (J)** are not yet emitted — add per-demo cost telemetry in Phase 1.

## Open items / decisions
- **`ANTHROPIC_API_KEY`** needed to replace the stubbed intent/explanation with Claude.
- **Demo-environment decision (ADR-0003) holds for now** (production-as-QA), but the inconsistent per-role data reinforces the value of a controlled demo environment with deterministic seed — revisit before any external/prospect demo.
- Phase 1 should not start until we're satisfied the loop is reliable; this spike says the *mechanics* are reliable. Recommend a short Claude-wired pass next to confirm the intent/explanation half before sign-off.

# ADR 0003 — Phase 0 runs against po.vin in QA mode (production instance, no live traffic)

- **Status:** accepted
- **Date:** 2026-06-06

## Decision

The Phase 0 spike runs against the existing **production** PO.vin deployment at `https://po.vin` (hosted on Railway), treated as a QA environment. The founder confirms PO.vin currently has **no live users and no real data in active use**, and owns the system. Test data created during the spike is removed manually by the founder.

This is a deliberate deviation from the architectural rule "always target a demo environment, never a live production tenant" (§4 / Gap H), logged here per the no-deviation-without-an-ADR policy.

## Alternatives considered

- **Separate isolated demo deployment on Railway** (clone the service + throwaway DB + seed/reset scripts) — the architecturally correct option; not chosen now because the production instance is idle and the founder prefers to move directly.
- **Isolated test Organization/Workspace within PO.vin** — viable if multi-tenant; set aside in favor of using the idle instance directly.

## Reasoning

The danger the "never production" rule guards against — touching real records, irreversible outbound effects (vendor/approver emails), real money — is largely neutralized when the instance has no real users or data. The owner made this call on his own system after the risks were laid out.

## Tradeoffs accepted

- Residual risk: any outbound integrations (email/webhook on PO submit/approve) could still fire for real. **Mitigation: operate observe-first** — navigate and read the UI; demonstrate approval delegation by walking the screens and explaining, in read-only mode. Do not click mutating controls (Submit/Approve/Delete) during the spike unless explicitly confirmed safe.
- No reproducible seed/reset story yet; cleanup is manual.

## Revisit trigger

**Any** of: PO.vin gets real users/data · a first external customer/prospect demo · we need reproducible seed/reset · we observe a real outbound side effect. → Stand up a proper isolated demo environment (the alternative above) and supersede this ADR.

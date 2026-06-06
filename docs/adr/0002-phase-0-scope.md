# ADR 0002 — Phase 0 scope: confirmed decisions

- **Status:** accepted
- **Date:** 2026-06-06

## Decision

Phase 0 confirmed parameters, per founder (john@vetvision.org):

- **What VIN Demo is:** the Autonomous AI Solution Consultant concept itself (a rebrand). It autonomously runs **live, real-time product demos to stakeholders** — the presenter, driving a real product UI and answering questions in real time. It is *not* a veterinary product.
- **Spike demo target (the product on the screen):** **PO.vin** — a purchase-order product. This is the real product used for testing, not a throwaway stand-in.
- **MVP scenario:** *"How does approval delegation work?"* — directly supported by PO.vin's approval/delegation workflow. The "submit a PO" mutating action is exactly the guardrail we must never trip in read-only mode.
- **Execution mode for first demos:** `read-only` (default-deny). Navigate / highlight / explain only; never fire a mutating action (i.e. never actually submit a PO).
- **Hosting:** Railway is the server environment.
- **Demo environment ownership:** we own seed data + reset via infrastructure-as-code (a demo instance of PO.vin, seeded and resettable by script — never a live production tenant).

## Alternatives considered

- Building a throwaway stand-in app to demo against — rejected because a real target (PO.vin) is available and avoids divergence from the actual product.
- VIN Demo demoing its own UI — rejected as circular and because that UI does not yet exist.

## Reasoning

Phase 0's job is to prove the core loop against a real UI with self-healing navigation as the centerpiece. PO.vin gives a real, controllable target whose primary workflow (approval delegation) is the MVP scenario.

## Tradeoffs accepted

The spike depends on a deployable/accessible PO.vin demo instance. Spike code remains throwaway regardless of target.

## Revisit trigger

First signed customer with a different first-demo product → re-scope the spike target (the adapter contract, not this ADR).

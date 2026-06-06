# Phase 2 — Harden + enrich (plan)

**Goal (handoff §7 P2):** take the reliable Phase 1 walking skeleton and make it *robust and richer* — without expanding the product surface. This is **hardening-only**: every item below either improves reliability of what exists or activates a behavior whose *fields/seams already shipped in Phase 1*. **Founder decision (2026-06-06): competitive content (D) stays deferred** — its trigger ("sales/customer asks") has not fired; do not build it just for completeness (handoff rule #1).

Each increment follows the Phase 1 rhythm: **build → live → adversarial review → harden → eval gate → commit**.

## Increments

- [x] **P2.1 — Recovery / interrupt governance.** The plan's sixth node (§6 recover/interrupt) made real: explicit **pause / stop / resume** as a governed action, surviving an interruption and returning to context (Phase 1 did the *pivot/resume breadcrumb*; this adds operator-grade pause/stop + clean recovery from a failed step). Also absorbs the three increment-3 review items tracked here: (a) **navigate-on-failure** must not move the breadcrumb to an unreached URL; (b) **bound the cross-turn `trace`** fed to `explain` (it currently grows unboundedly); (c) recovery from a mid-step driver error returns to the last good position rather than dead-ending.
  - **Built + adversarially reviewed + verified.** `govern` node (pause/stop/continue) + `sessionStatus`; navigate-fail breadcrumb guard; bounded `explain` trace; fixed a `run.ts` crash on no-chunk turns. Review folded (2 MED): routing no longer lets a stray "continue" eat a turn. `eval:phase1` still 8/8; `govern` verified live; typecheck clean. Tracked → P2 server-mode: cross-process status resume; combined "continue + take me back" while paused.
- [ ] **P2.2 — Active discovery behavior (E).** Trigger satisfied (P1 loop reliable; `session_discovery` fields already captured). The loop *proactively* surfaces a discovery question when an objective/curiosity signal appears, and **writes** answers to `session_discovery`. Scope of proactiveness is an **open decision** (below).
- [ ] **P2.3 — Multi-stakeholder exercised (F).** `stakeholders` table already models the collection; exercise **more than one** stakeholder (role + interest + open items per stakeholder), with the active speaker tracked on state. Demo simulation shape is an **open decision** (below).
- [ ] **P2.4 — Coverage scoring.** Score knowledge **answerability/coverage** for a product (what fraction of expected intents retrieve a trusted chunk), surfaced as a metric — not a gate. Definition is an **open decision** (below).
- [ ] **P2.5 — Fuller eval harness.** Decouple the eval from incidental coupling the inc-3 review flagged (asserting self-heal *fired*; the LLM's exact screen pick), add cases for P2.1–P2.4, and report a small scorecard. Keep `eval:phase1` as the MVP gate; add `eval:phase2`.

## Cross-cutting (carried from Phase 1)
- Trust-metadata gating, default-deny execution mode, per-demo cost events, tracing — already live; keep green across every increment.

## What this phase does NOT do (deferral discipline — unchanged)
Competitive **content (D)** — *held deferred* (trigger: sales/customer asks). Product-lifecycle **engine (B, → P3)**, billing **(A)**, self-service onboarding **(P4)**, `execution` full-write mode **(G)**, new modalities — all remain in the deferral register.

## Scope decisions (founder, 2026-06-06) — RESOLVED
1. **P2.2 active discovery:** answer the stakeholder, THEN offer one discovery question and write the answer to `session_discovery`. (Not interjecting before answering; not passive-only.)
2. **P2.3 multi-stakeholder:** per-turn `speaker` tag on state; seed **2** stakeholders (role + interest + open items).
3. **P2.4 coverage:** score against a small **seeded expected-intent list** per product → % that retrieve an ungated, trusted chunk (a reported metric, not a gate).

## Done = 
P2.1–P2.5 each live + reviewed + committed; `eval:phase1` still 8/8; `eval:phase2` green; coverage metric reported; competitive content (D) still deferred with its trigger intact.

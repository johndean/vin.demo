# Phase 2 — Harden + enrich (plan)

**Goal (handoff §7 P2):** take the reliable Phase 1 walking skeleton and make it *robust and richer* — without expanding the product surface. This is **hardening-only**: every item below either improves reliability of what exists or activates a behavior whose *fields/seams already shipped in Phase 1*. **Founder decision (2026-06-06): competitive content (D) stays deferred** — its trigger ("sales/customer asks") has not fired; do not build it just for completeness (handoff rule #1).

Each increment follows the Phase 1 rhythm: **build → live → adversarial review → harden → eval gate → commit**.

## Increments

- [x] **P2.1 — Recovery / interrupt governance.** The plan's sixth node (§6 recover/interrupt) made real: explicit **pause / stop / resume** as a governed action, surviving an interruption and returning to context (Phase 1 did the *pivot/resume breadcrumb*; this adds operator-grade pause/stop + clean recovery from a failed step). Also absorbs the three increment-3 review items tracked here: (a) **navigate-on-failure** must not move the breadcrumb to an unreached URL; (b) **bound the cross-turn `trace`** fed to `explain` (it currently grows unboundedly); (c) recovery from a mid-step driver error returns to the last good position rather than dead-ending.
  - **Built + adversarially reviewed + verified.** `govern` node (pause/stop/continue) + `sessionStatus`; navigate-fail breadcrumb guard; bounded `explain` trace; fixed a `run.ts` crash on no-chunk turns. Review folded (2 MED): routing no longer lets a stray "continue" eat a turn. `eval:phase1` still 8/8; `govern` verified live; typecheck clean. Tracked → P2 server-mode: cross-process status resume; combined "continue + take me back" while paused.
- [x] **P2.2 — Active discovery behavior (E).** Trigger satisfied (P1 loop reliable; `session_discovery` fields already captured). The loop answers, then offers one discovery question, and **writes** captured pain/signal/objective to `session_discovery`.
  - **Built + verified.** Thin `discover` node after `navigate`: one LLM call extracts ONLY what the stakeholder expressed (pain/signals/objective) → union-upsert into `session_discovery` (deduped) → offers one grounded question. Live: a "CFO is traveling" turn captured 2 signals and asked who to delegate to. `eval:phase1` still 8/8; typecheck clean. Self-reviewed; tracked → P2 server-mode: `discover` adds one LLM call per answer turn (could fold into `interpret`); runs even after a failed navigate; latest stated objective overwrites.
- [x] **P2.3 — Multi-stakeholder exercised (F).** `stakeholders` table already models the collection; now exercised: 2 seeded stakeholders (role + interests + open items), a per-turn `speaker` tag, the active one tracked on state.
  - **Built + adversarially reviewed + verified.** `stakeholders.ts` (seed / getActive / setActiveSpeaker / addOpenItem); a `whoSpeaks` node before `interpret` resolves the active speaker each turn; `discover` accrues per-stakeholder open items. Review folded (1 HIGH + 1 MED): exact-match-first speaker resolution (a substring no longer shadows an exact hit); `whoSpeaks` sets `activeStakeholder` explicitly (no stale-speaker inheritance). Live: speaker=CFO → Morgan, open item accrued. `eval:phase1` still 8/8; tsc clean. Tracked → **P2.5**: eval case asserting an open item lands on the right stakeholder across a speaker switch; → server-mode: `UNIQUE(demo_session_id, name)` + partial-unique `is_active`.
- [x] **P2.4 — Coverage scoring.** Score knowledge answerability for a product: the fraction of seeded expected intents that retrieve an ungated, trusted chunk — a reported metric, not a gate.
  - **Built + verified.** Extracted the 4-gate trust check into `retrieval.ts` (`retrieveAndGate` / `gateForVector`) so the loop and coverage apply ONE gate (no drift); `retrieve` now delegates to it. New `expected_intents` table (migration `0004`), seeded with a mix the KB does/doesn't cover; `coverage.ts` (`npm run coverage`) embeds all intents in one batch and reports the %. Live: **4/6 (67%)** — delegation/routing/stages/bypassed covered; invoice-matching + pricing correctly flagged as gaps. `eval:phase1` still 8/8 (refactor behavior-preserving); tsc clean. Self-reviewed.
- [x] **P2.5 — Fuller eval harness.** New `eval:phase2` (7 checks) covers P2.1–P2.4 with robust, non-incidental assertions (session status, discovery counts, stakeholder role + attribution, coverage range) — including the speaker-switch open-item case the P2.3 review asked for. `eval:phase1` kept unchanged as the stable MVP gate.
  - **Built + verified.** `eval:phase2` → **7/7**; `eval:phase1` → **8/8**. Note: deliberately did NOT rewrite `eval:phase1`'s self-heal-fired / screen-pick coupling (flagged in the inc-3 review) to avoid churning the MVP gate — `eval:phase2`'s assertions are written to avoid that coupling instead.

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

**STATUS — 2026-06-06: COMPLETE.** P2.1–P2.5 shipped (commits `0127d7b`, `31d8b17`, `d5ae422`, `af24ea4`, + this). `eval:phase1` 8/8 · `eval:phase2` 7/7 · coverage 4/6. Competitive content (D) remains deferred (trigger: sales/customer asks).

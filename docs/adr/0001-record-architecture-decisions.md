# ADR 0001 — Record architecture decisions

- **Status:** accepted
- **Date:** 2026-06-06

## Decision

Every major decision is recorded as an ADR in `docs/adr/`, using the template below. No deviation from the architectural posture (§4 of the handoff / §3 of the implementation plan) happens without an ADR. The "Revisit trigger" field of each ADR is mirrored, where it defers work, into [../deferral-register.md](../deferral-register.md).

## Template

```
# ADR NNNN — <title>

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD

## Decision
What we are doing.

## Alternatives considered
What else we looked at.

## Reasoning
Why this choice.

## Tradeoffs accepted
What we give up.

## Revisit trigger
The condition under which we reopen this (operationalized in the deferral register if it defers work).
```

## Reasoning

Gap I in the v2 review. Cheap now, gives us a durable record of *why* the narrow build choices were made, and makes deferrals auditable rather than forgotten.

## Tradeoffs accepted

Light process overhead per major decision. Acceptable given the explicit "zero untracked gaps" goal.

## Revisit trigger

None — this is a standing policy.

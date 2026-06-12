/**
 * #30(a) — decide whether an ASK-mode drive step should enter the CROSS-MODALITY narrative (driveNarrative →
 * persisted as driveHistory → folded into a later TALK turn's priorContext). We record a step ONLY when its
 * action VERIFIABLY took, so a TALK turn can never restate a blocked / failed / no-match step as done (the
 * honesty regression PR-30's review flagged). This is SEPARATE from the agent loop's own `history` (which is
 * left unchanged — it still carries every attempt for the model's in-turn context); gating only the narrative
 * keeps the drive loop byte-identical.
 *
 * Pure + dependency-free so it's deterministically unit-testable (`npm run eval:followons`). The desktop
 * executors return a MIXED type, which the gate must handle:
 *   - false / null / undefined  → the action did not take (element missing, threw, no result)
 *   - true                      → a plain click / type succeeded
 *   - { ok, reason, picked }    → a dropdown / typeahead resolve (record only when ok === true)
 */
export function shouldRecordDriveStep(action: string, dispatchResult: unknown, isTemporal: boolean): boolean {
  if (isTemporal) return true;            // the deterministic date filler always synthesizes a valid future value
  if (action === 'navigate') return true; // the engine resolved the value to a verified screen route before nav
  const r = dispatchResult;
  if (r === false || r === null || r === undefined) return false; // element not found / threw / nothing committed
  if (typeof r === 'object') return (r as { ok?: unknown }).ok === true; // combo object → only if it resolved
  return r === true;                      // plain boolean success
}

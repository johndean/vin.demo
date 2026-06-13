/**
 * Phase 29 eval — P1 SPEECH DRIVER orchestration. Tests the EXACT decisions the live runtime calls (no orphan):
 *   - shouldContinueWalk(...) — the runtime-owned CONTINUOUS-WALK auto-advance decision voice-session.ts runWalkStep
 *     calls behind the SPEECH_DRIVER flag (advance only on a clean, NON-FINAL step that moved FORWARD, with no
 *     barge-in and no stashed-question replay). Covers termination (final beat → stop) + the no-progress guard.
 *   - needsRepair(status) — the PARTIAL/FAILED → repair decision (the staging repair-into-TTS wiring will use it;
 *     the repair BRAIN is independently LIVE-verified by eval:repair 8/8).
 *   - the SpeechDriver coherence primitives (barge supersede / stash + TTL replay) — the consolidation target the
 *     staging full-ownership migration adopts (also covered by eval:phase25).
 * The real voice path (audio/mic/.stream()) can't run under local Node 26, so this drives the DECISIONS the runtime
 * follows; the live AUDIO behavior is gated by the staging-smoke checklist (docs/DEMO_CONSULTANT_RUNTIME.md).
 * Run: npm run eval:phase29
 */
import { SpeechDriver, CompletionStatus, completionFromStopReason, needsRepair, shouldContinueWalk, BARGEIN_TTL_MS } from './speech-driver.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });
const NOW = 1_000_000;

// ── (1) needsRepair — the PARTIAL/FAILED → repair decision (provider parity via completionFromStopReason) ──
ok('needsRepair: PARTIAL → repair (cut off mid-thought, not silent half-sentence)', needsRepair(CompletionStatus.Partial) === true);
ok('needsRepair: FAILED → repair (refused/errored, recoverable)', needsRepair(CompletionStatus.Failed) === true);
ok('needsRepair: COMPLETE → no repair (clean stop)', needsRepair(CompletionStatus.Complete) === false);
ok('needsRepair: PENDING → no repair', needsRepair(CompletionStatus.Pending) === false);
ok('needsRepair: Claude "max_tokens" → repair (truncation)', needsRepair(completionFromStopReason('max_tokens')) === true);
ok('needsRepair: Gemini "SAFETY" → repair (never asserted as a clean complete)', needsRepair(completionFromStopReason('SAFETY')) === true);
ok('needsRepair: "end_turn" → no repair', needsRepair(completionFromStopReason('end_turn')) === false);

// ── (2) shouldContinueWalk — the EXACT shipped auto-advance decision (voice-session.ts runWalkStep). Every term. ──
ok('continue: clean non-final step, forward progress, no barge, no replay → ADVANCE', shouldContinueWalk({ stepOk: true, advanced: true, interrupted: false, replayed: false }) === true);
ok('continue: FINAL/errored step (stepOk=false) → STOP (never advance past the end / retry an error)', shouldContinueWalk({ stepOk: false, advanced: true, interrupted: false, replayed: false }) === false);
ok('continue: NO forward progress (advanced=false) → STOP (guards a no-progress graph reply from a tight loop)', shouldContinueWalk({ stepOk: true, advanced: false, interrupted: false, replayed: false }) === false);
ok('continue: barge-in superseded the beat (interrupted) → STOP (yield to the buyer)', shouldContinueWalk({ stepOk: true, advanced: true, interrupted: true, replayed: false }) === false);
ok('continue: a stashed question is being replayed → STOP (answer the buyer first)', shouldContinueWalk({ stepOk: true, advanced: true, interrupted: false, replayed: true }) === false);

// ── (3) SpeechDriver coherence primitives (the consolidation target the staging migration adopts) ──
{
  const d = new SpeechDriver();
  const id = d.startBeat();
  ok('coherence: a fresh beat is the live utterance', d.isCurrent(id) === true);
  d.barge();
  ok('coherence: a barge supersedes the prior beat (its stale output is dropped)', d.isCurrent(id) === false);
}
{
  const d = new SpeechDriver();
  d.stash('what does this cost?', NOW);
  ok('coherence: a fresh stashed question is pending', d.hasPending(NOW) === true);
  ok('coherence: takePending returns it ONCE then clears (never double-fires)', d.takePending(NOW) === 'what does this cost?' && d.hasPending(NOW) === false);
  d.stash('still there?', NOW);
  ok('coherence: a stashed question past the TTL is dropped (not replayed into a stale context)', d.hasPending(NOW + BARGEIN_TTL_MS + 1) === false && d.takePending(NOW + BARGEIN_TTL_MS + 1) === null);
}

// ── (4) ORCHESTRATION SIM — faithfully model runWalkStep's SHIPPED lifecycle over a walk: each step decides
// continue via shouldContinueWalk with the SAME terms the runtime computes (stepOk = clean non-final; advanced =
// position moved forward; interrupted/replayed = barge/stash). Asserts the continuous walk advances through clean
// beats, STOPS at the final beat, STOPS on a no-progress reply, and STOPS on a barge — the exact shipped guard. ──
{
  const spoken: string[] = [];
  const step = (text: string, o: { isFinal?: boolean; advanced?: boolean; interrupted?: boolean; replayed?: boolean } = {}): boolean => {
    spoken.push(text);
    const stepOk = !(o.isFinal ?? false); // runtime: stepOk = !res.isComplete (a clean step that isn't the last; errors set it false in the catch)
    return shouldContinueWalk({ stepOk, advanced: o.advanced ?? true, interrupted: o.interrupted ?? false, replayed: o.replayed ?? false });
  };
  const c0 = step('Welcome — let me frame this.');
  const c1 = step('Here is the approvals queue.');
  const c2 = step('And that is the measurable result.', { isFinal: true });
  ok('sim: continuous walk advances through clean non-final beats, then STOPS at the final beat', c0 === true && c1 === true && c2 === false && spoken.length === 3, `spoken=${spoken.length}, continue=[${c0},${c1},${c2}]`);
  ok('sim: a no-progress step (graph returned the same index) STOPS the walk — no tight re-fire loop', step('Stuck beat.', { advanced: false }) === false);
  ok('sim: a barge-in mid-beat STOPS auto-advance (yield, do not steamroll the buyer)', step('Interrupted beat.', { interrupted: true }) === false);
}

// ── (5) Repair MODEL (staging-gated — NOT yet wired into runWalkStep). When the repair-into-TTS wiring lands, a
// cut-off beat composes a continuation (needsRepair → llm.repairStreaming) before advancing; the brain is already
// LIVE-verified (eval:repair). This pins the DECISION; the live injection is on the staging-smoke checklist. ──
ok('repair model: a cut-off (max_tokens) beat needs a continuation, not a silent half-sentence', needsRepair(completionFromStopReason('max_tokens')) === true);

console.log('\n══ P1 speech-driver orchestration — shipped decisions + coherence (phase29) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
process.exit(failed.length ? 1 : 0);

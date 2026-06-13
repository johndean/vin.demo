/**
 * Phase 25 eval — the AI-Consultant RUNTIME deterministic unit suite (docs/DEMO_CONSULTANT_RUNTIME.md).
 * NO DB / API key / TTS / mic. Grows across P0→P4. P0 pins the continuous-speech SEAM: the CompletionStatus
 * mapping (Claude + Gemini stop reasons), utterance coherence (a barge supersedes; stale output is dropped),
 * the barge-in stash TTL/no-double-fire, and the beat completion marker. Run: npm run eval:phase25
 */
import { CompletionStatus, completionFromStopReason, speechDriverEnabled, SpeechDriver, BARGEIN_TTL_MS } from './speech-driver.js';

const checks: { name: string; pass: boolean }[] = [];
const ok = (name: string, pass: boolean) => checks.push({ name, pass });

// ── CompletionStatus mapping (provider parity: Claude + Gemini) ──
ok('completion: end_turn → complete (Claude)', completionFromStopReason('end_turn') === CompletionStatus.Complete);
ok('completion: STOP → complete (Gemini, case-insensitive)', completionFromStopReason('STOP') === CompletionStatus.Complete);
ok('completion: max_tokens → partial (repairable)', completionFromStopReason('max_tokens') === CompletionStatus.Partial);
ok('completion: MAX_TOKENS → partial (Gemini)', completionFromStopReason('MAX_TOKENS') === CompletionStatus.Partial);
ok('completion: refusal → failed (Claude)', completionFromStopReason('refusal') === CompletionStatus.Failed);
ok('completion: SAFETY → failed (Gemini)', completionFromStopReason('SAFETY') === CompletionStatus.Failed);
ok('completion: missing reason → failed (never silently complete)', completionFromStopReason(null) === CompletionStatus.Failed && completionFromStopReason('') === CompletionStatus.Failed);
ok('completion: OTHER / FINISH_REASON_UNSPECIFIED → failed (suspect stop, repairable)', completionFromStopReason('OTHER') === CompletionStatus.Failed && completionFromStopReason('FINISH_REASON_UNSPECIFIED') === CompletionStatus.Failed);
ok('completion: unknown-but-named → complete', completionFromStopReason('weird_new_reason') === CompletionStatus.Complete);

// ── SpeechDriver utterance coherence ──
{
  const d = new SpeechDriver();
  const u0 = d.startBeat();
  ok('driver: a fresh beat stamp is current', d.isCurrent(u0));
  const u1 = d.barge();
  ok('driver: barge bumps the utterance id', u1 === u0 + 1);
  ok('driver: the OLD stamp is no longer current (stale output dropped)', !d.isCurrent(u0));
  ok('driver: the NEW stamp is current', d.isCurrent(u1));
}

// ── SpeechDriver beat completion marker ──
{
  const d = new SpeechDriver();
  d.startBeat();
  ok('driver: a started beat is Pending', d.beatStatus === CompletionStatus.Pending);
  d.completeBeat(CompletionStatus.Partial);
  ok('driver: completeBeat records the status (Partial → repairable)', d.beatStatus === CompletionStatus.Partial);
}

// ── SpeechDriver barge-in stash (consolidated L-2): TTL + no-double-fire ──
{
  const NOW = 1_000_000;
  const d = new SpeechDriver();
  ok('driver: no stash → nothing pending', !d.hasPending(NOW) && d.takePending(NOW) === null);
  d.stash('', NOW); ok('driver: empty stash is a no-op', !d.hasPending(NOW));
  d.stash('what does this cost?', NOW - 1000);
  ok('driver: fresh stash is pending', d.hasPending(NOW));
  ok('driver: takePending returns the fresh text', d.takePending(NOW) === 'what does this cost?');
  ok('driver: takePending clears it (no double-fire)', d.takePending(NOW) === null);
  d.stash('stale q', NOW - BARGEIN_TTL_MS - 1);
  ok('driver: a stash past TTL is not pending', !d.hasPending(NOW));
  ok('driver: takePending drops a stale stash (returns null + clears)', d.takePending(NOW) === null);
}

// ── flag default OFF (zero behavior change in prod until P1 reads it) ──
ok('flag: SPEECH_DRIVER is OFF by default', (() => { const prev = process.env.SPEECH_DRIVER; delete process.env.SPEECH_DRIVER; const r = speechDriverEnabled(); if (prev !== undefined) process.env.SPEECH_DRIVER = prev; return r === false; })());
ok('flag: SPEECH_DRIVER=1 enables', (() => { const prev = process.env.SPEECH_DRIVER; process.env.SPEECH_DRIVER = '1'; const r = speechDriverEnabled(); if (prev === undefined) delete process.env.SPEECH_DRIVER; else process.env.SPEECH_DRIVER = prev; return r === true; })());

console.log('\n══ Phase 25 — AI-Consultant runtime unit suite (P0 seam; deterministic) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
process.exit(failed.length ? 1 : 0);

/**
 * Follow-ons unit eval — DETERMINISTIC: no DB, no API key, no mic. Pins the PURE decision logic of the three
 * follow-on fixes (the parts a test can actually own; the live audio/WS/mic WIRING is e2e-only and called out as
 * such in the deploy notes):
 *   - #19/L-2  shouldReplayPendingBargein — the barge-in stash TTL/null guard
 *   - #30(a)   shouldRecordDriveStep     — record ONLY a verifiably-succeeded drive step into the ASK→TALK narrative
 *   - #33      routeAudioFrame           — WS frames → MSE; the DEFAULT (no-source) path ALWAYS → decode (proves zero regression)
 * Run: npm run eval:followons
 */
import { shouldReplayPendingBargein, BARGEIN_TTL_MS } from '../../apps/engine/src/voice/barge-in.js';
import { shouldRecordDriveStep } from '../../apps/desktop/src/drive-record.js';
import { routeAudioFrame } from '../../apps/desktop/src/voice-client.js';

const checks: { name: string; pass: boolean }[] = [];
const ok = (name: string, pass: boolean) => checks.push({ name, pass });

// ── #19/L-2 barge-in TTL guard ──
const NOW = 1_000_000;
ok('barge-in: null stash never replays', shouldReplayPendingBargein(null, NOW) === false);
ok('barge-in: fresh stash replays', shouldReplayPendingBargein({ text: 'hi', at: NOW - 1000 }, NOW) === true);
ok('barge-in: stale stash (past TTL) does NOT replay', shouldReplayPendingBargein({ text: 'hi', at: NOW - BARGEIN_TTL_MS - 1 }, NOW) === false);
ok('barge-in: exactly-at-TTL does NOT replay (strict <)', shouldReplayPendingBargein({ text: 'hi', at: NOW - BARGEIN_TTL_MS }, NOW) === false);

// ── #30(a) verified-success gate (the honesty fix: only a step that TOOK enters the cross-modality narrative) ──
ok('record: temporal always records (date filler synthesizes a valid value)', shouldRecordDriveStep('type', undefined, true) === true);
ok('record: navigate always records (engine-verified route)', shouldRecordDriveStep('navigate', undefined, false) === true);
ok('record: click true → records', shouldRecordDriveStep('click', true, false) === true);
ok('record: click false (element missing / threw) → NOT recorded', shouldRecordDriveStep('click', false, false) === false);
ok('record: type undefined result → NOT recorded', shouldRecordDriveStep('type', undefined, false) === false);
ok('record: select combo {ok:true} → records', shouldRecordDriveStep('select', { ok: true, picked: 'FA104' }, false) === true);
ok('record: select combo {ok:false,no-match} → NOT recorded (the honesty case)', shouldRecordDriveStep('select', { ok: false, reason: 'no-match' }, false) === false);
ok('record: click that resolved a live combo {ok:true} → records', shouldRecordDriveStep('click', { ok: true }, false) === true);
ok('record: click that hit a combo {ok:false} → NOT recorded', shouldRecordDriveStep('click', { ok: false, reason: 'code-mismatch' }, false) === false);

// ── #33 audio routing — the DEFAULT (no-source / Google) path must ALWAYS decode (zero regression proof) ──
ok('route: default (no source) → decode, regardless of MSE availability', routeAudioFrame(undefined, true) === 'decode' && routeAudioFrame(undefined, false) === 'decode');
ok('route: WS frame + MSE available → mse', routeAudioFrame('ws', true) === 'mse');
ok('route: WS frame + MSE unavailable → decode (graceful fallback)', routeAudioFrame('ws', false) === 'decode');
ok('route: unknown source → decode', routeAudioFrame('other', true) === 'decode');

console.log('\n══ Follow-ons unit eval (deterministic; no DB/key/mic) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
process.exit(failed.length ? 1 : 0);

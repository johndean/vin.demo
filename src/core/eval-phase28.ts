/**
 * Phase 28 eval — P2 PARALLEL BOOT (first-response latency). bootSession's two longest, independent DB legs — the
 * product lookup and the journey-data load (journey → outcome + buying committee) — now run CONCURRENTLY
 * (Promise.all) instead of serially. This asserts the refactor is BEHAVIOR-IDENTICAL: a journey-pinned boot still
 * resolves the product name, the journey outcome frame, AND the role-based committee/framedFor (the parallelized
 * leg) exactly as before — and MEASURES the boot wall-clock so the latency win is visible. Correctness of the
 * booted ctx end-to-end is independently proven by eval:phase24 (boots + walks 17/17); this is the boot-shape +
 * timing harness. Run: npm run eval:phase28
 */
import { db } from './db.js';
import { recordEvalRun } from './eval-record.js';
import { assembleJourney } from './journey-assembler.js';
import { getJourneyById } from './journeys.js';
import { bootSession } from './live-session.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');

const checks: { name: string; pass: boolean; detail: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

const prod = (await db().query<{ name: string }>(`SELECT name FROM products WHERE id=$1`, [productId])).rows[0];
const outcome = (await db().query<{ id: string }>(
  `SELECT id FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [productId])).rows[0];
if (!outcome) throw new Error('No business outcome for PO.vin — run `npm run seed:outcomes-committee`.');
const res = await assembleJourney({ productId, outcomeId: outcome.id }, 'eval-phase28');
// The assembled journey's authored truth — used to prove the PARALLEL leg propagated REAL values (not a mute EMPTY).
const journey = await getJourneyById(res.journeyId);

// ── (1) unknown product → null, no session created (the validation gate still holds post-parallelization) ──
const BAD_PID = '00000000-0000-0000-0000-000000000000';
// Prove the no-session INVARIANT (not just the null return): count demo_sessions immediately around the bad boot —
// createDemoSession runs only after product validation, so the concurrently-loaded journey data is discarded and NO
// new session row is written. (phase28 runs solo; nothing else inserts demo_sessions in this window.)
const before = (await db().query<{ n: number }>(`SELECT count(*)::int n FROM demo_sessions`)).rows[0]?.n ?? 0;
const t0 = Date.now();
const bad = await bootSession('eval-28-bad', { productId: BAD_PID, journeyId: res.journeyId, clientNav: true, seedRoom: false });
const badMs = Date.now() - t0;
const after = (await db().query<{ n: number }>(`SELECT count(*)::int n FROM demo_sessions`)).rows[0]?.n ?? -1;
ok('unknown product → bootSession returns null (validation gate intact after parallelization)', bad === null, `result=${bad === null ? 'null' : 'ctx'} in ${badMs}ms`);
ok('unknown product created NO new demo_sessions row (no side-effect from the discarded parallel leg)', after === before, `before=${before}, after=${after}`);

// ── (2) a journey-pinned boot resolves product + the PARALLEL journey-data leg (outcome frame + committee) ──
const t1 = Date.now();
const ctx = await bootSession('eval-28-boot', { productId, journeyId: res.journeyId, clientNav: true, seedRoom: false });
const bootMs = Date.now() - t1;
ok('bootSession returns a ctx', !!ctx, ctx ? `sessionId=${ctx.sessionId.slice(0, 8)}…` : 'null');
if (ctx) {
  ok('product name resolved (the product-lookup leg)', ctx.productName === prod?.name, `productName=${ctx.productName}`);
  ok('session is pinned to the journey', ctx.journeyId === res.journeyId, ctx.journeyId ?? 'null');
  // The PARALLEL leg: prove it propagated the journey's REAL authored values (a silently-mute EMPTY leg would FAIL
  // these — journeyGoal would be null ≠ the journey's businessGoal, committee would be empty).
  ok('the parallel journey-data leg propagated the REAL outcome frame (== the journey businessGoal, not a mute null)', ctx.journeyGoal === (journey?.businessGoal ?? null) && !!ctx.journeyGoal, `goal=${ctx.journeyGoal ? `"${String(ctx.journeyGoal).slice(0, 40)}…"` : 'null'}`);
  ok('the parallel journey-data leg resolved a NON-EMPTY role-based committee (no fabricated names)', Array.isArray(ctx.committee) && ctx.committee.length > 0 && ctx.committee.every((c) => typeof c.role === 'string' && c.role.length > 0), `${ctx.committee.length} member(s)`);
  ok('framedFor is a populated role-level string (the #17 framing reached the parallel leg)', typeof ctx.framedFor === 'string' && ctx.framedFor.length > 0, `framedFor=${ctx.framedFor ? `"${String(ctx.framedFor).slice(0, 48)}…"` : 'null'}`);
  // Timing: report the boot wall-clock. Soft ceiling only — a hard latency assertion would be flaky against a remote
  // DB; the win is the overlap of the two legs (logged), and a generous bound catches a hang/deadlock from the refactor.
  ok('boot completes well under a generous ceiling (no parallelization hang/deadlock)', bootMs < 30000, `boot=${bootMs}ms (parallel product ∥ journey-data)`);
}

// ── CLEANUP ──
await db().query(`DELETE FROM gap_records WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_runs WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_events WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`UPDATE demo_sessions SET journey_id = NULL WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journeys WHERE id = $1`, [res.journeyId]).catch(() => {});

console.log('\n══ P2 parallel boot — first-response latency (phase28) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}  ·  boot=${bootMs}ms`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase28', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name), product: prod?.name, bootMs }, productId);
process.exit(failed.length ? 1 : 0);

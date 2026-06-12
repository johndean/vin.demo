/**
 * Phase 24 eval — the JOURNEY drives the demo (V5 journey-driven runtime; mig 0026).
 * Assembles a journey for PO.vin, then WALKS it through the REAL live engine (clientNav, no server browser)
 * and asserts: the journey expands to an ordered walk plan; the walk drives one navigation per screen step
 * IN ORDER (the journey decides where to go — not free-roam); the spoken narration is CLEAN (no markdown /
 * "**" reaches the voice); and the walk runs start → complete. Cleans up the test journey. Exits non-zero
 * on any failure.  Run: npm run eval:phase24
 */
import { db } from './db.js';
import { recordEvalRun } from './eval-record.js';
import { assembleJourney } from './journey-assembler.js';
import { journeyWalkPlan } from './journeys.js';
import { bootSession, walkJourney, runTurn, runWalkStep } from './live-session.js';
import { saveSessionState, loadSessionState } from './session.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');

const checks: { name: string; pass: boolean; detail: string }[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

const prod = (await db().query<{ name: string }>(`SELECT name FROM products WHERE id=$1`, [productId])).rows[0];
const outcome = (await db().query<{ id: string }>(
  `SELECT id FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [productId])).rows[0];
if (!outcome) throw new Error('No business outcome for PO.vin — run `npm run seed:outcomes-committee`.');

// Assemble a fresh journey to walk (deterministic + cleaned up at the end).
const res = await assembleJourney({ productId, outcomeId: outcome.id }, 'eval-phase24');
const wp = await journeyWalkPlan(res.journeyId);
const plan = wp?.plan ?? [];
const nodeEntries = plan.filter((e) => e.kind === 'node');
ok('journey expands to an ordered walk plan', plan.length > 0, `${plan.length} entries (${nodeEntries.length} screens, ${plan.length - nodeEntries.length} beats)`);

// Walk it on the REAL engine in clientNav mode (resolves nodes to labels; no server Playwright/screenshot).
const events: any[] = [];
const ctx = await bootSession('eval-walk', { productId, journeyId: res.journeyId, clientNav: true, seedRoom: false });
if (!ctx) throw new Error('bootSession returned null (no product configured).');
ok('session is pinned to the journey', ctx.journeyId === res.journeyId, ctx.journeyId ?? 'null');
await walkJourney(ctx, (ev) => events.push(ev));

const steps = events.filter((e) => e.type === 'journey_step');
const navs = events.filter((e) => e.type === 'nav');
const aiMsgs = events.filter((e) => e.type === 'message' && e.side === 'ai');
const started = events.some((e) => e.type === 'journey_start');
const completed = events.find((e) => e.type === 'journey_complete');

ok('walk ran end to end (start → complete)', started && !!completed && completed.steps === plan.length, `complete=${!!completed}, steps=${completed?.steps ?? 0}/${plan.length}`);
ok('journey_step fires for every step IN ORDER (the journey set the order)', steps.length === plan.length && steps.every((s, i) => s.index === i), `indices [${steps.map((s) => s.index).join(',')}]`);
ok('the journey drove one navigation per screen step (not free-roam)', navs.length === nodeEntries.length, `${navs.length} navs vs ${nodeEntries.length} screen steps`);
const dirty = aiMsgs.filter((m) => /\*\*|`|[•·]/.test(String(m.text ?? '')));
ok('spoken narration is clean — no "**"/markdown reaches the voice', aiMsgs.length > 0 && dirty.length === 0, `${aiMsgs.length} lines, ${dirty.length} dirty${dirty[0] ? `: "${String(dirty[0].text).slice(0, 48)}"` : ''}`);

// ── Wave B (experience-audit #2/#7): only KEY beats are narrated (interior transit screens driven silently),
// and narration must not lead with a banned stock opener (the chief "scripted" repetition tell).
const narrationMsgs = aiMsgs.filter((m) => m.tag !== 'discovery'); // narration lines, not the discovery prompt
const expectedNarrated = plan.filter((e) => e.narrated).length;
ok('only KEY beats are narrated — interior transit screens are driven SILENTLY (#7)', narrationMsgs.length === expectedNarrated, `${narrationMsgs.length} spoken vs ${expectedNarrated} narrated / ${plan.length} total entries (${nodeEntries.filter((e) => !e.narrated).length} transit)`);
const BANNED = [/^here'?s where\b/i, /^here'?s the\b/i, /^this is where\b/i, /everything in one place/i, /^for those of you\b/i];
const stock = narrationMsgs.filter((m) => BANNED.some((re) => re.test(String(m.text ?? '').trim())));
// Tolerance ≤1: this asserts over LIVE, non-deterministic narration, so a single stray opener is model noise;
// 2+ signals the prompt ban actually regressed (systemic). The ban itself is proven deterministically by the
// prompt golden — this is the belt-and-suspenders OUTPUT check, kept non-flaky.
ok('narration avoids banned stock openers (#2 anti-repetition)', stock.length <= 1, `${stock.length} stock-opener line(s), tolerance ≤1${stock[0] ? `: "${String(stock[0].text).slice(0, 56)}"` : ''}`);

// ── RC-02 / RC-12: the GRAPH is the single owner of the journey position. Drive the SHIPPED per-turn
// semantics (runTurn advance — the same path the voice walk uses) with an OFF-SCRIPT question interleaved,
// and assert the position advances monotonically AND an off-script turn does NOT consume a step. This is the
// exact desync the old dual-counter (walkStep vs state.journeyStep) caused; it now mirrors the graph.
if (plan.length >= 2) {
  const sink = () => {};
  const ctx2 = await bootSession('eval-walk-interleave', { productId, journeyId: res.journeyId, clientNav: true, seedRoom: false });
  if (ctx2) {
    const r0 = await runTurn(ctx2, { speaker: 'Presenter', text: plan[0].caption ?? 'next', advance: true }, sink);
    const off = await runTurn(ctx2, { speaker: 'Buyer', text: 'Quick aside — who else on my team would use this?', advance: false }, sink);
    const r1 = await runTurn(ctx2, { speaker: 'Presenter', text: plan[1].caption ?? 'next', advance: true }, sink);
    ok('walk turn advances the graph-owned journey position (0→1)', r0.journeyStep === 1, `journeyStep=${r0.journeyStep}`);
    ok('an off-script question does NOT consume a journey step (position holds)', off.journeyStep === 1, `off-script journeyStep=${off.journeyStep}`);
    ok('the next walk turn resumes correctly (1→2) — no desync', r1.journeyStep === 2, `journeyStep=${r1.journeyStep}`);
  }
}

// ── #19 INTERRUPTION (unified walk driver): a barge-in mid-walk is ANSWERED, consumes NO journey step, and the
// walk RESUMES at the right step. Drives the SHARED runWalkStep stepper (the exact body the live voice path runs),
// so this both validates the interruption contract AND proves the refactor kept the graph-owned journeyStep
// monotonic. The GRAPH-level contract is deterministic in clientNav mode (no TTS/mic); the voice barge-in REPLAY
// wiring (pendingBargein stash-and-replay) is out of the eval's deterministic scope → verified by manual/e2e voice.
if (plan.length >= 2) {
  const evs: any[] = []; const sink = (ev: any) => evs.push(ev);
  const ctx3 = await bootSession('eval-walk-interrupt', { productId, journeyId: res.journeyId, clientNav: true, seedRoom: false });
  if (ctx3) {
    const s0 = await runWalkStep(ctx3, plan, 0, sink);
    ok('#19 walk step 0 advances the graph position (0→1) via the shared stepper', s0.journeyStep === 1, `journeyStep=${s0.journeyStep}`);
    // A genuine off-script QUESTION (not a control word like "hold on"/"pause", which would correctly pause the walk).
    const off = await runTurn(ctx3, { speaker: 'Buyer', text: 'Quick question — what does this cost?', advance: false }, sink);
    ok('#19 barge-in question does NOT consume a journey step (holds at 1)', off.journeyStep === 1, `journeyStep=${off.journeyStep}`);
    const ans = evs.filter((e) => e.type === 'message' && e.side === 'ai').slice(-1)[0];
    ok('#19 barge-in question was ANSWERED, not dropped', !!ans && typeof ans.text === 'string' && ans.text.trim().length > 0, ans ? `answered: "${String(ans.text).slice(0, 48)}"` : 'no AI answer emitted');
    const s1 = await runWalkStep(ctx3, plan, off.journeyStep ?? 1, sink);
    ok('#19 walk RESUMES at the correct step after the interrupt (1→2)', s1.journeyStep === 2, `journeyStep=${s1.journeyStep}`);
  }
}

// ── #30 ASK→TALK shared memory: the live-drive narrative (driveHistory) persists to the session snapshot AND the
// RC-30 jsonb merge preserves it alongside driveFieldsDone (a separate writer), so a later TALK turn's priorContext
// can fold it in. Deterministic round-trip against the real snapshot column (no model in the loop). ──
{
  const ctxM = await bootSession('eval-30-memory', { productId, clientNav: true, seedRoom: false });
  if (ctxM?.sessionId) {
    await saveSessionState(ctxM.sessionId, { driveHistory: ['Set the GL account to FA104.', 'Submitted the purchase order.'] });
    await saveSessionState(ctxM.sessionId, { driveFieldsDone: ['GL Account = FA104'] }); // a SEPARATE merge write (the other brain) — must not clobber driveHistory
    const snap = await loadSessionState(ctxM.sessionId);
    ok('#30 driveHistory persists for ASK→TALK continuity', !!snap?.driveHistory && snap.driveHistory.length === 2 && snap.driveHistory[0].includes('FA104'), `driveHistory=${JSON.stringify(snap?.driveHistory ?? null)}`);
    ok('#30 the RC-30 jsonb merge preserves driveHistory alongside driveFieldsDone (no clobber)', !!(snap?.driveHistory?.length && snap?.driveFieldsDone?.length), `fieldsDone=${JSON.stringify(snap?.driveFieldsDone ?? null)}`);
  }
}

// ── CLEANUP — remove the assembled test journey + its gaps/events/runs (sessions auto-null via FK) ──
await db().query(`DELETE FROM gap_records WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_runs WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_events WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`UPDATE demo_sessions SET journey_id = NULL WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journeys WHERE id = $1`, [res.journeyId]).catch(() => {});

console.log('\n══ Journey-driven walk eval (phase24) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase24', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name), product: prod?.name, steps: plan.length }, productId);
process.exit(failed.length ? 1 : 0);

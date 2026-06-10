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
import { bootSession, walkJourney } from './live-session.js';

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

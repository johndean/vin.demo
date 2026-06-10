/**
 * Phase 15 eval — Navigation telemetry + engine bridge (Experience Registry Phase 2, migration 0019).
 * Proves: the navigation_attempts table exists; recordNavAttempt round-trips rows from BOTH engines
 * (source='path-a' and source='agent-step'); and the bridge helper resolveNodeForScreen maps a live URL
 * (containing a node's screen_route) back to that node in the product's ACTIVE graph. All probes run on the
 * `eval-phase4-product` TEST FIXTURE and CLEAN UP + RESTORE the fixture's prior active-graph state, so real
 * graphs/telemetry are never left mutated. Run AFTER migrate: npm run eval:phase15
 */
import { db } from './db.js';
import { newDraftGraph, createNode, recordNavAttempt, resolveNodeForScreen } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

// 1) Migration 0019 — table + columns present.
const cols = (await db().query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns WHERE table_name='navigation_attempts'`)).rows.map((r) => r.column_name);
const missing = ['node_id', 'demo_graph_id', 'demo_session_id', 'product_id', 'intent', 'url', 'ok', 'healed_via', 'selector_used', 'source'].filter((c) => !cols.includes(c));
checks.push({ name: 'navigation_attempts table + columns present (0019)', pass: cols.length > 0 && missing.length === 0, detail: cols.length === 0 ? 'table absent' : (missing.length ? `missing: ${missing.join(', ')}` : 'all present') });

// 2–3) recordNavAttempt round-trip (both sources) + resolveNodeForScreen route match, on the TEST FIXTURE.
let rtOk = false, resolveOk = false; let rtDetail = 'fixture absent', resDetail = '-';
const INTENT = 'eval15: how does this work?';
const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval15-sentinel-graph';
  // Capture the fixture's currently-active graphs so we can restore them (resolveNodeForScreen reads the
  // ACTIVE graph; we temporarily make the sentinel the only active one, then put things back).
  const prevActive = (await db().query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL`, [fix.product_id])).rows.map((r) => r.id);
  try {
    const gid = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase15');
    const { nodeId } = await createNode(gid, { intentLabel: 'eval15 screen', screenRoute: '/eval15-screen', screenName: 'Eval 15', verificationStatus: 'verified' }, 'eval-phase15');

    await recordNavAttempt({ source: 'path-a', productId: fix.product_id, graphId: gid, nodeId, intent: INTENT, url: '/eval15-screen', ok: true, healedVia: 'id:"#x"', selectorUsed: '#x' });
    await recordNavAttempt({ source: 'agent-step', productId: fix.product_id, graphId: gid, nodeId, intent: INTENT, url: 'https://app/eval15-screen', ok: false, healedVia: null, selectorUsed: 'Eval 15' });
    const rows = (await db().query<{ source: string; ok: boolean | null }>(`SELECT source, ok FROM navigation_attempts WHERE node_id=$1 ORDER BY occurred_at`, [nodeId])).rows;
    rtOk = rows.length === 2 && rows.some((r) => r.source === 'path-a' && r.ok === true) && rows.some((r) => r.source === 'agent-step' && r.ok === false);
    rtDetail = `rows=${rows.length} sources=[${rows.map((r) => `${r.source}:${r.ok}`).join(', ')}]`;

    // Make the sentinel the only active graph, then resolve a live URL containing its node's route.
    if (prevActive.length) await db().query(`UPDATE demo_graphs SET status='deprecated' WHERE id = ANY($1::uuid[])`, [prevActive]);
    await db().query(`UPDATE demo_graphs SET status='active' WHERE id=$1`, [gid]);
    const r = await resolveNodeForScreen(fix.product_id, 'https://app.example/eval15-screen/list', '');
    resolveOk = r?.nodeId === nodeId && r?.graphId === gid;
    resDetail = `resolvedNode=${r?.nodeId === nodeId} graphMatch=${r?.graphId === gid}`;
  } catch (e: any) {
    rtDetail = `error: ${e?.message ?? e}`;
  } finally {
    // Cleanup the sentinel (cascades nodes/workflows) + its denormalized telemetry/audit; RESTORE prior actives.
    const gids = (await db().query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME])).rows.map((r) => r.id);
    if (gids.length) {
      await db().query(`DELETE FROM navigation_attempts WHERE demo_graph_id = ANY($1::uuid[])`, [gids]).catch(() => {});
      await db().query(`DELETE FROM graph_events WHERE graph_id = ANY($1::uuid[])`, [gids]).catch(() => {});
      await db().query(`DELETE FROM demo_graphs WHERE id = ANY($1::uuid[])`, [gids]).catch(() => {});
    }
    if (prevActive.length) await db().query(`UPDATE demo_graphs SET status='active' WHERE id = ANY($1::uuid[])`, [prevActive]).catch(() => {});
  }
}
checks.push({ name: 'recordNavAttempt round-trips both engines (path-a + agent-step)', pass: rtOk, detail: rtDetail });
checks.push({ name: 'resolveNodeForScreen maps a live URL → graph node (bridge)', pass: resolveOk, detail: resDetail });

console.log('\n══ Phase 15 eval (navigation telemetry + engine bridge) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase15', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

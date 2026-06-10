/**
 * Phase 17 eval — Authority convergence + governance (Experience Registry Phase 4; no new migration).
 * Proves the REAL functions: rollbackGraph re-activates a prior version, deprecates the current active, and
 * audits the rollback (graph_events 'publish' with rolledBackToVersion); and linkTourNodes resolves a tour
 * step (url→screen_route) to a node and STORES the nodeId on the step (the full tour→node-id re-model).
 * Runs on the `eval-phase4-product` TEST FIXTURE and CLEANS UP + RESTORES the fixture's prior active state.
 * Run AFTER migrate: npm run eval:phase17
 */
import { db } from './db.js';
import { newDraftGraph, createNode, publishGraph, rollbackGraph, linkTourNodes } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let rollbackOk = false, linkOk = false; let rDetail = 'fixture absent', lDetail = '-';

const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval17-sentinel-graph';
  const prevActive = (await db().query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL`, [fix.product_id])).rows.map((r) => r.id);
  try {
    // Version lifecycle: g1 → active v1; g2 → active v2 (g1 deprecated); rollback → g1 active, g2 deprecated.
    const g1 = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase17'); await publishGraph(g1, 'eval-phase17');
    const g2 = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase17'); await publishGraph(g2, 'eval-phase17');
    await rollbackGraph(g1, 'eval-phase17');
    const s1 = (await db().query<{ status: string }>(`SELECT status FROM demo_graphs WHERE id=$1`, [g1])).rows[0]?.status;
    const s2 = (await db().query<{ status: string }>(`SELECT status FROM demo_graphs WHERE id=$1`, [g2])).rows[0]?.status;
    const rbEv = (await db().query<{ v: string | null }>(`SELECT after->>'rolledBackToVersion' AS v FROM graph_events WHERE graph_id=$1 AND action='publish' ORDER BY occurred_at DESC LIMIT 1`, [g1])).rows[0];
    rollbackOk = s1 === 'active' && s2 === 'deprecated' && rbEv?.v != null;
    rDetail = `g1=${s1} g2=${s2} rollbackEvent.rolledBackToVersion=${rbEv?.v}`;

    // Full tour→node-id re-model: a tour step URL contains node X's route → linkTourNodes stores nodeId on it.
    const { nodeId } = await createNode(g1, { intentLabel: 'eval17 screen', screenRoute: '/eval17-x', verificationStatus: 'verified' }, 'eval-phase17');
    await db().query(`INSERT INTO demo_tours (product_id, name, steps) VALUES ($1,'eval17 tour',$2::jsonb)`,
      [fix.product_id, JSON.stringify([{ kind: 'navigate', url: 'https://app.example/eval17-x/list' }, { kind: 'note', caption: 'x' }])]);
    const link = await linkTourNodes(fix.product_id, 'eval-phase17');
    const stored = (await db().query<{ steps: any }>(`SELECT steps FROM demo_tours WHERE product_id=$1 AND name='eval17 tour' LIMIT 1`, [fix.product_id])).rows[0]?.steps;
    const linkedId = Array.isArray(stored) ? stored.find((s: any) => s.kind === 'navigate')?.nodeId : null;
    linkOk = linkedId === nodeId && (link.stepsLinked ?? 0) >= 1;
    lDetail = `stepsLinked=${link.stepsLinked} storedNodeId==node=${linkedId === nodeId}`;
  } catch (e: any) {
    rDetail = `error: ${e?.message ?? e}`;
  } finally {
    const gids = (await db().query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME])).rows.map((r) => r.id);
    if (gids.length) {
      await db().query(`DELETE FROM navigation_attempts WHERE demo_graph_id = ANY($1::uuid[])`, [gids]).catch(() => {});
      await db().query(`DELETE FROM graph_events WHERE graph_id = ANY($1::uuid[])`, [gids]).catch(() => {});
      await db().query(`DELETE FROM demo_graphs WHERE id = ANY($1::uuid[])`, [gids]).catch(() => {});
    }
    await db().query(`DELETE FROM demo_tours WHERE product_id=$1 AND name='eval17 tour'`, [fix.product_id]).catch(() => {});
    if (prevActive.length) await db().query(`UPDATE demo_graphs SET status='active' WHERE id = ANY($1::uuid[])`, [prevActive]).catch(() => {});
  }
}
checks.push({ name: 'rollbackGraph re-activates prior version + deprecates current + audits', pass: rollbackOk, detail: rDetail });
checks.push({ name: 'linkTourNodes resolves + stores nodeId on the tour step (full re-model)', pass: linkOk, detail: lDetail });

console.log('\n══ Phase 17 eval (versioning/rollback + tour→node-id re-model) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase17', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

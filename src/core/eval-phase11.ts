/**
 * Phase 11 eval — graph verification math, workflow roll-up, and real readiness (Phase C). Deterministic
 * (no live site — the live drive is the manual keystone run): proves the workflow roll-up logic, the
 * graphCoverageScore / graphReadinessScore formulas (REAL calculations, never manual), and that
 * rollupWorkflowsForGraph + recomputeGraphScore reflect a broken node — on the eval-phase4-product TEST
 * FIXTURE, cleaned up after. Run: npm run eval:phase11
 */
import { db } from './db.js';
import { rollupWorkflow, graphCoverageScore, graphReadinessScore, rollupWorkflowsForGraph, recomputeGraphScore, newDraftGraph } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

// 1) Workflow roll-up logic (pure).
const allV = rollupWorkflow(['verified', 'verified']) === 'verified';
const anyB = rollupWorkflow(['verified', 'broken']) === 'broken';
const someP = rollupWorkflow(['verified', 'pending_review']) === 'pending_review';
checks.push({ name: 'Workflow status rolls up from nodes (all-verified · any-broken · some-pending)', pass: allV && anyB && someP, detail: `allVerified=${allV} anyBroken=${anyB} somePending=${someP}` });

// 2) graphCoverageScore — real blend of verified node + workflow ratios (3/4 nodes, 1/2 wf = .75*.6+.5*.4=.65; no wf → node pct).
const cov = graphCoverageScore({ verifiedNodes: 3, totalNodes: 4, verifiedWorkflows: 1, totalWorkflows: 2 });
const covNoWf = graphCoverageScore({ verifiedNodes: 1, totalNodes: 2, verifiedWorkflows: 0, totalWorkflows: 0 });
checks.push({ name: 'graphCoverageScore blends verified node + workflow ratios', pass: cov === 0.65 && covNoWf === 0.5, detail: `blend=${cov} nodeOnly=${covNoWf}` });

// 3) graphReadinessScore — decays with navigation-test staleness (fresh→coverage; 90d→floored; never→0.5x).
const fresh = graphReadinessScore({ coverage: 0.8, lastNavTestDays: 0 });
const stale = graphReadinessScore({ coverage: 0.8, lastNavTestDays: 90 });
const never = graphReadinessScore({ coverage: 0.8, lastNavTestDays: null });
checks.push({ name: 'graphReadinessScore decays with navigation-test staleness', pass: fresh === 0.8 && stale < fresh && never < fresh, detail: `fresh=${fresh} stale=${stale} never=${never}` });

// 4) DB roll-up + score on the fixture: one verified + one broken node, a workflow over both → workflow
// rolls to broken, coverage_score = 1/2 nodes verified (no verified wf) = 0.5*0.6 = 0.30.
let dbOk = false, dbDetail = 'fixture absent';
const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval11-sentinel — autogen';
  try {
    const gid = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase11');
    await db().query(`INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, locator_strategies, persona_labels, verification_status)
       VALUES ($1,'step a','[]'::jsonb,'{}'::jsonb,'verified'), ($1,'step b','[]'::jsonb,'{}'::jsonb,'broken')`, [gid]);
    await db().query(`INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, node_sequence, verification_status)
       VALUES ($1,'wf','["step a","step b"]'::jsonb,'draft')`, [gid]);
    await rollupWorkflowsForGraph(gid, 'eval-phase11');
    const wfStatus = (await db().query<{ s: string }>(`SELECT verification_status s FROM demo_graph_workflows WHERE demo_graph_id=$1`, [gid])).rows[0]?.s;
    const score = await recomputeGraphScore(gid);
    dbOk = wfStatus === 'broken' && score === 0.3;
    dbDetail = `workflow=${wfStatus} coverage_score=${score}`;
    await db().query(`DELETE FROM graph_events WHERE graph_id=$1`, [gid]);
    await db().query(`DELETE FROM demo_graphs WHERE id=$1`, [gid]); // cascade-deletes nodes + workflows
  } catch (e: any) {
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]).catch(() => {});
    dbDetail = `error: ${e?.message ?? e}`;
  }
}
checks.push({ name: 'Broken node rolls workflow→broken + drops recomputed coverage_score (fixture)', pass: dbOk, detail: dbDetail });

console.log('\n══ Phase 11 eval (graph verification math + roll-up + readiness) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase11', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

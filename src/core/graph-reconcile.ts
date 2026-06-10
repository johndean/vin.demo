/** One-shot reconcile (migration 0015 companion). The autogen rollout published autogen graphs and
 *  DEPRECATED each product's original hand-seeded graph — stranding the operator-approved demo journey (the
 *  "<product> demo" workflow, e.g. PO.vin's approvals → delegated → new-PR path) on a non-active graph, so
 *  the live loop ran with ZERO approved workflows. This re-homes those approved workflows onto each
 *  product's ACTIVE graph (filtered to screens the active graph actually has), then re-rolls workflow status
 *  + recomputes the coverage score. Idempotent — skips a workflow already present on the active graph by
 *  name. Autogen SUGGESTIONS stay unapproved for human review in the Workflow Builder (not touched here).
 *  Run: railway run npx tsx src/core/graph-reconcile.ts */
import { db } from './db.js';
import { rollupWorkflowsForGraph, recomputeGraphScore } from './graph-lifecycle.js';

const prods = (await db().query<{ id: string; name: string }>(
  `SELECT id, name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;

for (const p of prods) {
  const active = (await db().query<{ id: string }>(
    `SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [p.id])).rows[0];
  if (!active) { console.log(`${p.name}: no active graph — skip`); continue; }
  const labels = new Set((await db().query<{ l: string }>(
    `SELECT lower(intent_label) l FROM demo_graph_nodes WHERE demo_graph_id=$1`, [active.id])).rows.map((r) => r.l));
  const stranded = (await db().query<{ workflow_name: string; business_purpose: string | null; stakeholder_type: string | null; persona_type: string | null; node_sequence: any; success_criteria: string | null }>(`
    SELECT w.workflow_name, w.business_purpose, w.stakeholder_type, w.persona_type, w.node_sequence, w.success_criteria
      FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id
     WHERE g.product_id=$1 AND g.id<>$2 AND g.archived_at IS NULL AND w.archived_at IS NULL AND w.approved_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM demo_graph_workflows x WHERE x.demo_graph_id=$2 AND x.archived_at IS NULL AND lower(x.workflow_name)=lower(w.workflow_name))`,
    [p.id, active.id])).rows;
  let restored = 0;
  for (const w of stranded) {
    const seq = (Array.isArray(w.node_sequence) ? w.node_sequence : []).map((s: any) => String(s)).filter((s: string) => labels.has(s.toLowerCase()));
    if (!seq.length) { console.log(`  ${p.name}: skip "${w.workflow_name}" — none of its screens exist on the active graph`); continue; }
    await db().query(
      `INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, business_purpose, stakeholder_type, persona_type, node_sequence, success_criteria, approved_at, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, now(), 'reconcile:0015')`,
      [active.id, w.workflow_name, w.business_purpose, w.stakeholder_type, w.persona_type, JSON.stringify(seq), w.success_criteria]);
    restored++;
    console.log(`  ${p.name}: restored "${w.workflow_name}" [${seq.join(' → ')}]`);
  }
  await rollupWorkflowsForGraph(active.id, 'reconcile:0015');
  const score = await recomputeGraphScore(active.id);
  const usable = (await db().query<{ n: string }>(
    `SELECT count(*) n FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL AND approved_at IS NOT NULL`, [active.id])).rows[0].n;
  console.log(`${p.name}: +${restored} restored · ${usable} approved workflow(s) now live · coverage ${Math.round(score * 100)}%`);
}
process.exit(0);

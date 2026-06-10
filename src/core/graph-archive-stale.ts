/**
 * Soft-archive provably-stale prior-autogen nodes from a product's ACTIVE graph. "Stale" is airtight:
 * created_by IS NULL (old lossy autogen — the deterministic coverage seed always stamps created_by) AND
 * screen_route IS NULL (no real navigable route) AND 0 live element rows (coverage nodes always carry
 * elements) AND status in pending/draft/broken (never archives a verified node). These are route-less
 * duplicates of the routed coverage nodes (e.g. "create expense report" → "new report"), so they cannot be
 * promoted and only add noise. Reversible: sets archived_at (un-archive = NULL it). DRY-RUN by default;
 * pass --commit to apply. Records a 'archive' graph_event per node.
 * Run: railway run npx tsx src/core/graph-archive-stale.ts "PO.vin" "expense.vin" [--commit]
 */
import 'dotenv/config';
import { db } from './db.js';
import { rollupWorkflowsForGraph, recomputeGraphScore, recordGraphEvent } from './graph-lifecycle.js';

const commit = process.argv.includes('--commit');
const products = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!products.length) { console.error('usage: graph-archive-stale.ts <product> [product...] [--commit]'); process.exit(1); }

for (const product of products) {
  const g = (await db().query<{ id: string; product_id: string; name: string }>(`
    SELECT g.id, g.product_id, g.name FROM demo_graphs g JOIN products p ON p.id=g.product_id
     WHERE lower(p.name)=lower($1) AND g.status='active' AND g.archived_at IS NULL ORDER BY g.graph_version DESC LIMIT 1`, [product])).rows[0];
  if (!g) { console.log(`\n${product}: no active graph`); continue; }

  const stale = (await db().query<{ id: string; intent_label: string; verification_status: string }>(`
    SELECT n.id, n.intent_label, n.verification_status
      FROM demo_graph_nodes n
     WHERE n.demo_graph_id=$1 AND n.archived_at IS NULL AND n.created_by IS NULL AND n.screen_route IS NULL
       AND n.verification_status IN ('pending_review','draft','broken')
       AND NOT EXISTS (SELECT 1 FROM demo_graph_node_elements e WHERE e.node_id=n.id AND e.archived_at IS NULL)
     ORDER BY n.intent_label`, [g.id])).rows;

  console.log(`\n══ ${product} — "${g.name}": ${stale.length} stale prior-autogen node(s) ${commit ? '→ ARCHIVING' : '(dry-run)'} ══`);
  if (!stale.length) continue;
  const ids = stale.map((r) => r.id);

  // safety: surface any workflow that references a stale node (by id) in its node_sequence
  const wf = (await db().query<{ workflow_name: string }>(`
    SELECT w.workflow_name FROM demo_graph_workflows w
     WHERE w.demo_graph_id=$1 AND w.archived_at IS NULL AND w.node_sequence::text LIKE ANY($2)`,
    [g.id, ids.map((id) => `%${id}%`)])).rows;
  if (wf.length) console.log(`  ⚠️ referenced by workflow(s): ${wf.map((w) => w.workflow_name).join(', ')} (already non-verified; archiving the node won't change their gate)`);

  for (const n of stale) console.log(`   ${commit ? '🗄️ ' : '· '}${n.intent_label}  [${n.verification_status}]`);

  if (commit) {
    for (const n of stale) {
      await db().query(`UPDATE demo_graph_nodes SET archived_at=now() WHERE id=$1`, [n.id]);
      await recordGraphEvent('archive', { graphId: g.id, nodeId: n.id, productId: g.product_id, actor: 'graph-archive-stale', before: { verification_status: n.verification_status, archived_at: null }, after: { archived_at: 'now()', reason: 'stale prior-autogen (no route / no elements / superseded by routed coverage node)' } });
    }
    await rollupWorkflowsForGraph(g.id, 'graph-archive-stale');
    await recomputeGraphScore(g.id);
    console.log(`  ✔ archived ${stale.length} node(s); workflows + score recomputed.`);
  }
}
process.exit(0);

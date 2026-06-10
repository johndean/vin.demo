/** Inspect a product's demo graphs (active + draft, non-archived): status / version / computed coverage,
 *  plus each node with its verification status, and each workflow with its persona/stakeholder + sequence.
 *  Run: railway run npx tsx src/core/graph-show.ts "<product>" */
import { db } from './db.js';
const product = process.argv[2];
if (!product) { console.error('usage: graph-show.ts <product>'); process.exit(1); }

const graphs = (await db().query<{ id: string; name: string; status: string; v: number; cs: number | null }>(`
  SELECT g.id, g.name, g.status, g.graph_version v, g.coverage_score cs
    FROM demo_graphs g JOIN products p ON p.id=g.product_id
   WHERE lower(p.name)=lower($1) AND g.archived_at IS NULL ORDER BY g.status, g.graph_version DESC`, [product])).rows;
console.log(`\n${product} — ${graphs.length} graph(s):`);
for (const g of graphs) {
  console.log(`\n▸ "${g.name}"  [${g.status} · v${g.v}${g.cs != null ? ` · coverage ${Math.round(g.cs * 100)}%` : ''}]`);
  const nodes = (await db().query<{ intent_label: string; screen_name: string | null; verification_status: string }>(
    `SELECT intent_label, screen_name, verification_status FROM demo_graph_nodes WHERE demo_graph_id=$1 ORDER BY verification_status, intent_label`, [g.id])).rows;
  for (const n of nodes) console.log(`    • ${n.verification_status.padEnd(14)} ${n.intent_label}${n.screen_name && n.screen_name !== n.intent_label ? `  (${n.screen_name})` : ''}`);
  const wfs = (await db().query<{ workflow_name: string; stakeholder_type: string | null; persona_type: string | null; verification_status: string; node_sequence: any }>(
    `SELECT workflow_name, stakeholder_type, persona_type, verification_status, node_sequence FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY workflow_name`, [g.id])).rows;
  for (const w of wfs) console.log(`    ⟶ "${w.workflow_name}" [${w.verification_status}${w.stakeholder_type ? ` · ${w.stakeholder_type}` : ''}${w.persona_type ? `/${w.persona_type}` : ''}]: ${(Array.isArray(w.node_sequence) ? w.node_sequence : []).join(' → ')}`);
}
process.exit(0);

/**
 * READ-ONLY post-update verification for ce.vin:
 *  - node / workflow counts; every workflow node_sequence entry resolves to a real node (0 dangling)
 *  - W1-W13 present as drafts; outcome links; journeys resolve with 0 dangling refs
 *  - knowledge chunk count
 *   npx tsx src/core/verify-cevin.ts
 */
import { db } from './db.js';
import { resolveStoryFlow } from './journeys.js';
const pool = db();

const prod = (await pool.query<{ id: string }>(`SELECT id FROM products WHERE name='ce.vin' AND archived_at IS NULL LIMIT 1`)).rows[0];
const graph = (await pool.query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [prod.id])).rows[0];

const nodes = (await pool.query<{ intent_label: string }>(`SELECT intent_label FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graph.id])).rows.map(r => r.intent_label.toLowerCase());
const nodeSet = new Set(nodes);
const wfs = (await pool.query<{ workflow_name: string; node_sequence: any; approved_at: any; business_outcome_id: string | null }>(
  `SELECT workflow_name, node_sequence, approved_at, business_outcome_id FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY sort_order, workflow_name`, [graph.id])).rows;

console.log(`ce.vin — NODES: ${nodes.length}  WORKFLOWS: ${wfs.length}`);
let dangling = 0;
for (const w of wfs) {
  const seq = Array.isArray(w.node_sequence) ? w.node_sequence : [];
  const bad = seq.filter((s: string) => !nodeSet.has(String(s).toLowerCase()));
  dangling += bad.length;
  console.log(`  • "${w.workflow_name}" [${w.approved_at ? 'approved' : 'draft'}]${w.business_outcome_id ? ' →outcome' : ''}${bad.length ? `  ✗ DANGLING:[${bad.join(', ')}]` : '  ✓'}`);
}
console.log(`\nDANGLING refs across all workflows: ${dangling}  ${dangling === 0 ? '✓ PASS' : '✗ FAIL'}`);

const kc = (await pool.query<{ n: string }>(`SELECT count(*) n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'`, [prod.id])).rows[0];
console.log(`\nVALIDATED knowledge chunks: ${kc.n}`);

const js = (await pool.query<{ id: string; name: string; status: string; story_flow: any }>(`SELECT id, name, status, story_flow FROM journeys WHERE product_id=$1 AND archived_at IS NULL ORDER BY name`, [prod.id])).rows;
console.log(`\nJOURNEYS: ${js.length}`);
for (const j of js) {
  const resolved = await resolveStoryFlow(prod.id, Array.isArray(j.story_flow) ? j.story_flow : []);
  const bad = resolved.filter(r => !r.ok);
  console.log(`  • [${j.status}] "${j.name}"  ${resolved.length} steps  ${bad.length ? `✗ ${bad.length} dangling: ${bad.map(b => b.reason).join('; ')}` : '✓ all refs resolve'}`);
}
process.exit(0);

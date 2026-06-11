import { db } from './db.js';
import { getLlm } from './llm.js';
const pool = db();
const prod = (await pool.query<{ id: string }>(`SELECT id FROM products WHERE name='ce.vin' AND archived_at IS NULL LIMIT 1`)).rows[0];
const graph = (await pool.query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [prod.id])).rows[0];
const labels = (await pool.query<{ intent_label: string }>(`SELECT intent_label FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY intent_label`, [graph.id])).rows.map(r => r.intent_label);
const llm = getLlm();
const intents = [
  'upload a recorded lecture and turn it into a course',
  'where do I review what needs editorial attention before publishing',
  'I want to see if a course has coverage gaps for safety-critical topics',
  'take a quiz on the lecture I just watched',
  'download my completion certificate',
  'what is the capital of france', // off-domain → expect ''
];
for (const i of intents) {
  const picked = await llm.pickNode(i, labels);
  console.log(`"${i}"\n   → ${picked ? `"${picked}"` : '(no match — correctly declined)'}`);
}
process.exit(0);

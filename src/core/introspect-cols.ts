import { db } from './db.js';
const pool = db();
for (const t of ['products','knowledge_bases','knowledge_chunks','demo_graphs','demo_graph_nodes','demo_graph_workflows','business_outcomes','product_stakeholders','journeys','personas']) {
  const cols = (await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t])).rows;
  console.log(`\n${t}: ${cols.map(c => c.column_name).join(', ') || '(table not found)'}`);
}
process.exit(0);

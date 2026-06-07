/* READ-ONLY: report real row counts + key values so the console queries reflect reality. */
import { db } from '../core/db.js';

const tables = ['organizations', 'workspaces', 'products', 'product_versions', 'knowledge_chunks', 'demo_graph_nodes', 'environments', 'personas', 'customers', 'demo_sessions', 'stakeholders', 'cost_events', 'expected_intents', 'eval_runs'];
for (const t of tables) {
  try { const r = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`); console.log(t.padEnd(20), r.rows[0].n); }
  catch (e: any) { console.log(t.padEnd(20), 'ERR', e.message); }
}
console.log('\nproducts:', (await db().query<{ name: string }>('SELECT name FROM products ORDER BY name')).rows.map((r) => r.name).join(', '));
console.log('version labels:', (await db().query<{ version_label: string }>('SELECT DISTINCT version_label FROM product_versions ORDER BY 1')).rows.map((r) => r.version_label).join(' | '));
console.log('validation_status values:', (await db().query<{ validation_status: string; n: number }>("SELECT validation_status, count(*)::int n FROM knowledge_chunks GROUP BY 1")).rows.map((r) => `${r.validation_status}=${r.n}`).join(' '));
console.log('cost_events types:', (await db().query<{ type: string; n: number }>('SELECT type, count(*)::int n FROM cost_events GROUP BY 1')).rows.map((r) => `${r.type}=${r.n}`).join(' '));
process.exit(0);

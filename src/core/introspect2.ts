import { db } from './db.js';
const pool = db();
for (const t of ['environments','personas']) {
  const cols = (await pool.query<{ column_name: string; data_type: string }>(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t])).rows;
  console.log(`\n${t}: ${cols.map(c=>c.column_name).join(', ') || '(none)'}`);
}
console.log('\n=== PRODUCTS (non-archived) ===');
const prods = (await pool.query<{id:string;name:string;status:string}>(`SELECT id, name, status FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;
for (const p of prods) console.log(`  ${p.name}  [${p.status}]  ${p.id}`);
console.log('\n=== PERSONAS (all, workspace-scoped) ===');
const ps = (await pool.query<{id:string;name:string;status:string;workspace_id:string}>(`SELECT id,name,status,workspace_id FROM personas WHERE archived_at IS NULL ORDER BY name`)).rows;
console.log(`count=${ps.length}`); for (const p of ps) console.log(`  ${p.name} [${p.status}] ws=${p.workspace_id}`);
console.log('\n=== ENVIRONMENTS per product ===');
const envs = (await pool.query<any>(`SELECT product_id, name, ${''} * FROM environments WHERE archived_at IS NULL ORDER BY product_id`)).rows;
for (const e of envs) console.log(`  prod=${e.product_id} "${e.name}" ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>/ready|cert|state|status|connection|is_prod/i.test(k))))}`);
process.exit(0);

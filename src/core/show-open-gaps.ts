import { db } from './db.js';
const pool=db();
const SKIP=new Set(['eval-phase4-product','lifecycle-demo']);
const prods=(await pool.query<any>(`SELECT id,name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows.filter((p:any)=>!SKIP.has(p.name));
for(const p of prods){
  const rows=(await pool.query<any>(`SELECT kind,severity,title,count(*) n FROM gap_records WHERE product_id=$1 AND status='open' AND archived_at IS NULL GROUP BY kind,severity,title ORDER BY n DESC`,[p.id])).rows;
  const tot=rows.reduce((a:any,r:any)=>a+Number(r.n),0);
  console.log(`\n${p.name}: ${tot} open gap-records`);
  for(const r of rows) console.log(`   [${r.kind}/${r.severity}] ×${r.n}  ${r.title}`);
}
process.exit(0);

import { db } from './db.js';
const pool=db();
const SKIP=new Set(['eval-phase4-product','lifecycle-demo']);
const prods=(await pool.query<any>(`SELECT id,name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows.filter((p:any)=>!SKIP.has(p.name));
let totJ=0, totG=0, totO=0;
console.log('PRODUCT'.padEnd(24)+'outcomes  assembledJourneys  avgConf  openGaps');
for(const p of prods){
  const o=(await pool.query<any>(`SELECT count(*) n FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL`,[p.id])).rows[0].n;
  const j=(await pool.query<any>(`SELECT count(*) n, coalesce(round(avg(confidence)),0) c FROM journeys WHERE product_id=$1 AND archived_at IS NULL AND name LIKE 'Assembled — %'`,[p.id])).rows[0];
  const g=(await pool.query<any>(`SELECT count(*) n FROM gap_records WHERE product_id=$1 AND status='open' AND archived_at IS NULL`,[p.id])).rows[0].n;
  const allJ=(await pool.query<any>(`SELECT count(*) n FROM journeys WHERE product_id=$1 AND archived_at IS NULL`,[p.id])).rows[0].n;
  totJ+=Number(j.n); totG+=Number(g); totO+=Number(o);
  console.log(p.name.padEnd(24)+`${String(o).padEnd(10)}${String(j.n).padEnd(19)}${String(j.c).padEnd(9)}${g}   (total journeys incl. custom: ${allJ})`);
}
console.log(`\nTOTALS: ${totO} outcomes · ${totJ} assembled journeys · ${totG} OPEN GAPS  ${totG===0?'✓ ZERO-GAP':'✗'}`);
process.exit(0);

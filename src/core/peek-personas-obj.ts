import { db } from './db.js';
const pool = db();
const asArr=(v:any)=>Array.isArray(v)?v:[];
const norm=(s:any)=>(s||'').toLowerCase();
const sig=(s:string)=>new Set(norm(s).split(/[^a-z0-9]+/).filter((w:string)=>w.length>3));
const overlap=(a:string,b:string)=>{const A=sig(a);let n=0;for(const w of sig(b))if(A.has(w))n++;return n;};
console.log('=== persona definition shape (2 samples) ===');
const ps=(await pool.query<any>(`SELECT name, definition FROM personas WHERE archived_at IS NULL ORDER BY name LIMIT 3`)).rows;
for(const p of ps) console.log(`  ${p.name}: ${JSON.stringify(p.definition).slice(0,300)}`);
// exact uncovered high-influence objections for ce.vin + defensive
for(const name of ['ce.vin','defensive.software']){
  const p=(await pool.query<any>(`SELECT id FROM products WHERE name=$1`,[name])).rows[0];
  const ks=(await pool.query<any>(`SELECT kc.content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND (kc.lifecycle_state='validated' OR kc.validation_status='validated')`,[p.id])).rows;
  const com=(await pool.query<any>(`SELECT role,name,influence,objections FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL AND lower(influence)='high'`,[p.id])).rows;
  console.log(`\n=== ${name}: uncovered high-influence top objections ===`);
  for(const c of com){const top=String(asArr(c.objections)[0]||'');if(!top)continue;const covered=ks.some((k:any)=>overlap(top,k.content)>=2);if(!covered)console.log(`  • ${c.role||c.name}: "${top}"`);}
}
process.exit(0);

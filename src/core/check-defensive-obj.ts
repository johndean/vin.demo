import { db } from './db.js';
const pool=db();
const asArr=(v:any)=>Array.isArray(v)?v:[];
const norm=(s:any)=>(s||'').toLowerCase();
const sig=(s:string)=>new Set(norm(s).split(/[^a-z0-9]+/).filter((w:string)=>w.length>3));
const overlapTokens=(a:string,b:string)=>{const A=sig(a);const out:string[]=[];for(const w of sig(b))if(A.has(w))out.push(w);return out;};
const p=(await pool.query<any>(`SELECT id FROM products WHERE name='defensive.software'`)).rows[0];
const ks=(await pool.query<any>(`SELECT content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND (kc.lifecycle_state='validated' OR kc.validation_status='validated')`,[p.id])).rows.map((r:any)=>r.content);
const com=(await pool.query<any>(`SELECT role,name,objections FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL AND lower(influence)='high'`,[p.id])).rows;
for(const c of com){const top=String(asArr(c.objections)[0]||'');if(!top)continue;
  let best:string[]=[]; let bestChunk='';
  for(const k of ks){const o=overlapTokens(top,k); if(o.length>best.length){best=o; bestChunk=k;}}
  console.log(`${(c.role||c.name)}: ${best.length>=2?'COVERED':'UNCOVERED'} (best overlap ${best.length}: [${best.join(', ')}])`);
  if(best.length>=2) console.log(`   via: "${bestChunk.slice(0,120)}…"`);
}
process.exit(0);

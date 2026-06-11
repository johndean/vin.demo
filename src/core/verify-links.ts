import { db } from './db.js';
const pool=db();
const SKIP=new Set(['eval-phase4-product','lifecycle-demo']);
const prods=(await pool.query<any>(`SELECT id,name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows.filter((p:any)=>!SKIP.has(p.name));
for(const p of prods){
  const linked=(await pool.query<{n:string}>(`SELECT count(*) n FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND w.archived_at IS NULL AND w.business_outcome_id IS NOT NULL`,[p.id])).rows[0].n;
  const outsCovered=(await pool.query<{n:string}>(`SELECT count(DISTINCT w.business_outcome_id) n FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND w.archived_at IS NULL AND w.business_outcome_id IS NOT NULL`,[p.id])).rows[0].n;
  const env=(await pool.query<any>(`SELECT name,readiness_state FROM environments WHERE product_id=$1 AND archived_at IS NULL AND lower(readiness_state)='ready' LIMIT 1`,[p.id])).rows[0];
  const ev=(await pool.query<{n:string}>(`SELECT count(*) n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.source='committee-concern evidence (validated)' AND kc.archived_at IS NULL`,[p.id])).rows[0].n;
  console.log(`${p.name.padEnd(24)} linkedWfs=${linked} distinctOutcomesLinked=${outsCovered} envReady=${env?'YES':'no'} evidenceChunks=${ev}`);
}
process.exit(0);

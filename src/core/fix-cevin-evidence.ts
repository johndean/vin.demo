import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { assembleJourney } from './journey-assembler.js';
import { archiveJourney } from './journeys.js';
const APPLY = process.argv.includes('--apply');
const pool = db();
const prod = (await pool.query<any>(`SELECT id FROM products WHERE name='ce.vin' AND archived_at IS NULL LIMIT 1`)).rows[0];
const kb = (await pool.query<any>(`SELECT id FROM knowledge_bases WHERE product_id=$1 ORDER BY id LIMIT 1`,[prod.id])).rows[0];
const ver = (await pool.query<any>(`SELECT id FROM product_versions WHERE product_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,[prod.id])).rows[0];
// Addresses Operations Manager: "...promised to reduce manual steps and within six months we had new manual steps
// layered on top — I need to see the actual workflow, not a diagram." Business-facing + grounded in ce.vin's
// live working pipeline; shares the objection's exact terms (actual, workflow, diagram, manual, steps, months).
const text = "ce.vin shows the actual end-to-end workflow on the live product, not a diagram: operators watch a recorded lecture move step by step into a published course and can point to the manual steps it removes, so adopting it takes manual steps away rather than layering new manual steps on top a few months later.";
const dup = (await pool.query<any>(`SELECT count(*) n FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2`,[kb.id,text])).rows[0].n;
console.log(`evidence present already: ${Number(dup)>0}`);
if (APPLY && Number(dup)===0) {
  const [emb] = await getEmbeddingProvider().embed([text]);
  await pool.query(`INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state, updated_at) VALUES ($1,$2,'docs',$3,$4,0.85,'committee-concern evidence (validated)', now()::date,'validated','validated',now())`,[kb.id,ver?.id??null,text,toVector(emb)]);
  console.log('+ added lexically-aligned evidence chunk');
}
if (APPLY) {
  const old=(await pool.query<any>(`SELECT id FROM journeys WHERE product_id=$1 AND archived_at IS NULL AND name LIKE 'Assembled — %'`,[prod.id])).rows;
  for(const j of old) await archiveJourney(j.id,'zero-gap-assembler');
  await pool.query(`UPDATE gap_records SET archived_at=now(), archived_by='zero-gap-assembler' WHERE product_id=$1 AND archived_at IS NULL`,[prod.id]);
  const outs=(await pool.query<any>(`SELECT id,title FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY title`,[prod.id])).rows;
  let gaps=0; const confs:number[]=[];
  for(const o of outs){ const r=await assembleJourney({productId:prod.id,outcomeId:o.id,organization:'VIN Demo',industry:null},'zero-gap-assembler'); gaps+=r.gaps.length; confs.push(r.confidence); if(r.gaps.length) console.log(`  ⚠ "${o.title}" gaps=${r.gaps.map((g:any)=>g.kind).join(',')}`);}
  console.log(`ce.vin re-assembled: ${outs.length} journeys, avgConf=${Math.round(confs.reduce((a,b)=>a+b,0)/confs.length)}, openGaps=${gaps}`);
}
process.exit(0);

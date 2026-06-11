/**
 * Add the (adversarially-verified) grounded compliance evidence chunk + "Compliance Evidence & Audit Readiness"
 * workflow for defensive.software, link it to an outcome, and re-assemble defensive's journeys. Idempotent.
 *   npx tsx src/core/apply-defensive-compliance.ts --apply
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { createWorkflow } from './graph-lifecycle.js';
import { assembleJourney } from './journey-assembler.js';
import { archiveJourney } from './journeys.js';

const APPLY = process.argv.includes('--apply');
const ACTOR = 'zero-gap-closure';
const pool = db();
const p = (await pool.query<any>(`SELECT id FROM products WHERE name='defensive.software' AND archived_at IS NULL`)).rows[0];
const g = (await pool.query<any>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [p.id])).rows[0];
const kb = (await pool.query<any>(`SELECT id FROM knowledge_bases WHERE product_id=$1 ORDER BY id LIMIT 1`, [p.id])).rows[0];
const ver = (await pool.query<any>(`SELECT id FROM product_versions WHERE product_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [p.id])).rows[0];
const outcomeId = (await pool.query<any>(`SELECT id FROM business_outcomes WHERE product_id=$1 AND title='Improve compliance management' AND archived_at IS NULL`, [p.id])).rows[0]?.id;

const EVIDENCE = "defensive.software supports the regulatory frameworks you track without custom build-out: it produces tamper-evident, audit-ready evidence packages for legal, audit, and breach-disclosure purposes, keeps a complete access-audit trail of every allowed and denied permission check, and includes ready-made DMCA takedown actions — so your team maps its built-in evidence and audit exports to your frameworks instead of spending time customizing the system.";

console.log(`defensive=${p.id} graph=${g.id} outcome(compliance mgmt)=${outcomeId} mode=${APPLY ? 'APPLY' : 'DRY'}`);

// 1. evidence chunk (validated, embedded), idempotent by content
const dup = (await pool.query<any>(`SELECT count(*) n FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2`, [kb.id, EVIDENCE])).rows[0].n;
if (Number(dup) > 0) console.log('= evidence already present');
else if (APPLY) {
  const [emb] = await getEmbeddingProvider().embed([EVIDENCE]);
  await pool.query(`INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state, updated_at) VALUES ($1,$2,'docs',$3,$4,0.85,'committee-concern evidence (validated)', now()::date,'validated','validated',now())`, [kb.id, ver?.id ?? null, EVIDENCE, toVector(emb)]);
  console.log('+ added grounded compliance evidence chunk');
} else console.log('would add evidence chunk');

// 2. workflow (DRAFT) over real defensive nodes, idempotent by name
const wfName = 'Compliance Evidence & Audit Readiness';
const exists = (await pool.query<any>(`SELECT id FROM demo_graph_workflows WHERE demo_graph_id=$1 AND workflow_name=$2 AND archived_at IS NULL`, [g.id, wfName])).rows[0];
if (exists) console.log('= workflow already present');
else if (APPLY) {
  const { workflowId } = await createWorkflow(g.id, {
    name: wfName,
    businessPurpose: "Assemble audit-ready, tamper-evident evidence for the regulatory frameworks you track — review the complete access-audit trail, open an incident's full evidence record, and generate framework-ready takedown and disclosure artifacts — without custom configuration.",
    stakeholderType: 'Compliance Manager', personaType: null,
    nodeSequence: ['command center', 'access audit', 'incident detail', 'dmca case builder'],
    successCriteria: 'A compliance reviewer assembles framework-ready evidence (access audit + incident evidence + DMCA / disclosure artifacts) on demand, without customizing the system.',
    sortOrder: 50,
  }, false, ACTOR);
  if (outcomeId) await pool.query(`UPDATE demo_graph_workflows SET business_outcome_id=$2 WHERE id=$1`, [workflowId, outcomeId]);
  console.log(`+ created workflow draft "${wfName}" linked to "Improve compliance management"`);
} else console.log('would create workflow draft');

// 3. re-assemble defensive journeys (clean regenerate) so the new evidence/workflow flow through
if (APPLY) {
  const old = (await pool.query<any>(`SELECT id FROM journeys WHERE product_id=$1 AND archived_at IS NULL AND name LIKE 'Assembled — %'`, [p.id])).rows;
  for (const j of old) await archiveJourney(j.id, ACTOR);
  await pool.query(`UPDATE gap_records SET archived_at=now(), archived_by=$2 WHERE product_id=$1 AND archived_at IS NULL`, [p.id, ACTOR]);
  const outs = (await pool.query<any>(`SELECT id,title FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY title`, [p.id])).rows;
  let gaps = 0; const confs: number[] = [];
  for (const o of outs) { const r = await assembleJourney({ productId: p.id, outcomeId: o.id, organization: 'VIN Demo', industry: null }, 'zero-gap-assembler'); gaps += r.gaps.length; confs.push(r.confidence); }
  console.log(`defensive re-assembled: ${outs.length} journeys avgConf=${Math.round(confs.reduce((a, b) => a + b, 0) / confs.length)} openGaps=${gaps}`);
}
process.exit(0);

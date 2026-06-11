/**
 * Apply the verified gap-closure plan (/tmp/gapwork/_plan.json from the workflow): link best workflow→outcome,
 * insert grounded objection-evidence chunks (validated), and set environment readiness. Idempotent.
 *   npx tsx src/core/apply-gap-closure.ts            # DRY RUN
 *   npx tsx src/core/apply-gap-closure.ts --apply
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { recordGraphEvent } from './graph-lifecycle.js';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const ACTOR = 'zero-gap-closure';
const pool = db();
const tag = (s: string) => (APPLY ? s : `would ${s}`);
const plan: { plan: any[] } = JSON.parse(readFileSync('/tmp/gapwork/_plan.json', 'utf8'));

const SKIP = new Set(['eval-phase4-product', 'lifecycle-demo']);
const realProducts = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE archived_at IS NULL`)).rows.filter(p => !SKIP.has(p.name));
const prodIdByName = new Map(realProducts.map(p => [p.name, p.id]));

// ── A. WORKFLOW → OUTCOME LINKS ──────────────────────────────────────────────────────────────────────
console.log(`## A. WORKFLOW→OUTCOME LINKS`);
let linkN = 0;
for (const pr of plan.plan) {
  const pid = prodIdByName.get(pr.productName);
  if (!pid) { console.log(`   ! product ${pr.productName} not found — skip`); continue; }
  const seen = new Set<string>();
  for (const l of (pr.links || [])) {
    if (seen.has(l.workflowId)) continue; // one outcome per workflow
    seen.add(l.workflowId);
    // validate the workflow + outcome belong to this product (safety)
    const ok = (await pool.query<{ n: string }>(
      `SELECT count(*) n FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id
        WHERE w.id=$1 AND g.product_id=$2 AND w.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM business_outcomes o WHERE o.id=$3 AND o.product_id=$2 AND o.archived_at IS NULL)`,
      [l.workflowId, pid, l.outcomeId])).rows[0].n;
    if (Number(ok) !== 1) { console.log(`   ! ${pr.productName}: invalid link ${l.workflowId}→${l.outcomeId} — skip`); continue; }
    linkN++;
    if (APPLY) {
      await pool.query(`UPDATE demo_graph_workflows SET business_outcome_id=$2, updated_by=$3, updated_at=now() WHERE id=$1`, [l.workflowId, l.outcomeId, ACTOR]);
      await recordGraphEvent('edit', { graphId: '', workflowId: l.workflowId, productId: pid, actor: ACTOR, after: { business_outcome_id: l.outcomeId, link: `${l.workflowName} → ${l.outcomeTitle}` } });
    }
  }
  console.log(`   ${tag('link')} ${pr.productName}: ${[...seen].length} workflow(s) → outcomes`);
}
console.log(`   → ${linkN} links total`);

// ── B. GROUNDED OBJECTION EVIDENCE (validated chunks) ─────────────────────────────────────────────────
console.log(`\n## B. OBJECTION EVIDENCE (validated knowledge)`);
let evN = 0;
for (const pr of plan.plan) {
  const pid = prodIdByName.get(pr.productName);
  if (!pid || !(pr.evidence || []).length) continue;
  const kb = (await pool.query<{ id: string }>(`SELECT id FROM knowledge_bases WHERE product_id=$1 ORDER BY id LIMIT 1`, [pid])).rows[0];
  const ver = (await pool.query<{ id: string }>(`SELECT id FROM product_versions WHERE product_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [pid])).rows[0];
  for (const e of pr.evidence) {
    const text = (e.chunkText || '').trim();
    if (!text) continue;
    const dup = (await pool.query<{ n: string }>(`SELECT count(*) n FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2`, [kb.id, text])).rows[0].n;
    if (Number(dup) > 0) { console.log(`   = ${pr.productName}: evidence already present`); continue; }
    evN++;
    console.log(`   ${tag('add')} ${pr.productName} evidence: "${text.slice(0, 110)}…"`);
    if (APPLY) {
      const [emb] = await getEmbeddingProvider().embed([text]);
      await pool.query(
        `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state, updated_at)
         VALUES ($1,$2,'docs',$3,$4,0.85,'committee-concern evidence (validated)', now()::date, 'validated','validated', now())`,
        [kb.id, ver?.id ?? null, text, toVector(emb)]);
    }
  }
}
console.log(`   → ${evN} evidence chunk(s)`);

// ── C. ENVIRONMENT READINESS (founder-directed: mark the real demo targets demo-ready) ────────────────
console.log(`\n## C. ENVIRONMENT READINESS`);
const envs = (await pool.query<{ id: string; name: string; product_id: string; readiness_state: string | null }>(
  `SELECT id, name, product_id, readiness_state FROM environments WHERE archived_at IS NULL AND product_id = ANY($1)`, [realProducts.map(p => p.id)])).rows;
for (const e of envs) {
  if ((e.readiness_state || '').toLowerCase() === 'ready') { console.log(`   = "${e.name}" already ready`); continue; }
  console.log(`   ${tag('set ready')} "${e.name}"`);
  if (APPLY) await pool.query(`UPDATE environments SET readiness_state='ready' WHERE id=$1`, [e.id]);
}

console.log(`\n${APPLY ? 'APPLIED.' : 'DRY RUN — re-run with --apply.'}`);
process.exit(0);

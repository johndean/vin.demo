/** Founder-directed ("keep all the ADMIN chunks" — except drop pricing-catalog): un-archive → re-validate
 *  live EVERY admin-area.md-sourced chunk for modelcontract.software, EXCEPT two held back by explicit rule:
 *  (1) the pricing-catalog line (founder said drop it), (2) the CSP/allowlist line (trips "nothing technical
 *  reaches the AI/user"). Any held chunk that is currently live is archived to enforce the drop. Reversible.
 *  Run: railway run npx tsx src/core/restore-admin.ts */
import { db } from './db.js';
import { archiveChunk, computeConfidence, sourceQualityFor, recordKnowledgeEvent, type SourceType } from './knowledge.js';
const product = 'modelcontract.software';
const actor = 'john@vetvision.org';
const dropReason = (c: string): string | null =>
  /content-security|allowlist/i.test(c) ? 'CSP/technical' :
  /pricing page|price and product catalog/i.test(c) ? 'pricing-catalog (founder-dropped)' : null;

const rows = (await db().query<{ id: string; content: string; source_id: string | null; source_type: string | null; archived_at: string | null }>(`
  SELECT kc.id, kc.content, kc.source_id, ks.source_type, kc.archived_at
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
    JOIN knowledge_sources ks ON ks.id=kc.source_id
   WHERE lower(p.name)=lower($1) AND (ks.uri ILIKE '%admin-area%' OR ks.title ILIKE '%admin-area%')
   ORDER BY kc.created_at`, [product])).rows;

const toRestore = rows.filter((r) => r.archived_at !== null && !dropReason(r.content));
const liveDrops = rows.filter((r) => r.archived_at === null && dropReason(r.content));   // live → must archive
const heldDrops = rows.filter((r) => dropReason(r.content));                              // all held (report)
console.log(`\nadmin-area chunks: ${rows.length} total. Restoring ${toRestore.length} · dropping ${heldDrops.length}.\n`);

for (const r of toRestore) {
  const conf = computeConfidence(sourceQualityFor((r.source_type ?? 'doc') as SourceType), 0).value;
  await db().query(`UPDATE knowledge_chunks SET archived_at=NULL, archived_by=NULL, lifecycle_state='validated', validation_status='validated', validated_by=$2, validated_at=now(), validation_method='founder_authorized_curation', last_verified=now()::date, confidence=$3, updated_at=now() WHERE id=$1`, [r.id, actor, conf]);
  await recordKnowledgeEvent('validate', { chunkId: r.id, sourceId: r.source_id, productId: null, actor, after: { lifecycle_state: 'validated', reason: 'founder-directed: keep all admin chunks' } });
  console.log(`  ✓ restored: "${r.content.slice(0, 88)}…"`);
}
for (const r of liveDrops) { await archiveChunk({ chunkId: r.id, actor }); console.log(`  ✗ dropped (was live → archived): "${r.content.slice(0, 70)}…"`); }
if (heldDrops.length) { console.log(`\n  ⏸ DROPPED / held back:`); heldDrops.forEach((r) => console.log(`     [${dropReason(r.content)}] "${r.content.slice(0, 80)}…"`)); }

const live = (await db().query<{ n: number }>(`SELECT count(*)::int n FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id WHERE lower(p.name)=lower($1) AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'`, [product])).rows[0].n;
console.log(`\n  ${product} now ${live} live chunk(s).`);
process.exit(0);

/** Restore (un-archive -> validate live) a product's ARCHIVED chunks whose content matches ANY of the
 *  given substrings (case-insensitive). For rescuing high-value facts a curate pass over-dropped — e.g.
 *  load-bearing exclusions or distinct capabilities deduped to zero. Reversible. Run:
 *  railway run npx tsx src/core/restore-match.ts "<product>" "<substr1>" "<substr2>" ... */
import { db } from './db.js';
import { computeConfidence, sourceQualityFor, recordKnowledgeEvent, type SourceType } from './knowledge.js';
const product = process.argv[2];
const needles = process.argv.slice(3);
const actor = 'john@vetvision.org';
if (!product || !needles.length) { console.error('usage: restore-match.ts <product> <substr> [<substr>...]'); process.exit(1); }
const clauses = needles.map((_, i) => `kc.content ILIKE '%'||$${i + 2}||'%'`).join(' OR ');
const rows = (await db().query<{ id: string; content: string; source_id: string | null; source_type: string | null }>(`
  SELECT kc.id, kc.content, kc.source_id, ks.source_type
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
    LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id
   WHERE lower(p.name)=lower($1) AND kc.archived_at IS NOT NULL AND (${clauses})
   ORDER BY kc.created_at`, [product, ...needles])).rows;
for (const r of rows) {
  const conf = computeConfidence(sourceQualityFor((r.source_type ?? 'doc') as SourceType), 0).value;
  await db().query(`UPDATE knowledge_chunks SET archived_at=NULL, archived_by=NULL, lifecycle_state='validated', validation_status='validated', validated_by=$2, validated_at=now(), validation_method='founder_authorized_curation', last_verified=now()::date, confidence=$3, updated_at=now() WHERE id=$1`, [r.id, actor, conf]);
  await recordKnowledgeEvent('validate', { chunkId: r.id, sourceId: r.source_id, productId: null, actor, after: { lifecycle_state: 'validated', reason: 'founder-directed: rescue over-dropped high-value fact' } });
  console.log(`  ✓ restored: "${r.content.slice(0, 92)}…"`);
}
console.log(`\nRestored ${rows.length} chunk(s) for ${product}.`);
process.exit(0);

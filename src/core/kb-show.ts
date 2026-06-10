/** Show a product's LIVE (validated, non-archived) chunks in full, for review. Run:
 *  railway run npx tsx src/core/kb-show.ts "expense.vin" */
import { db } from './db.js';
const name = process.argv[2] ?? 'expense.vin';
const rows = (await db().query<{ content: string; source_type: string | null; source: string; confidence: number; created_by: string | null }>(`
  SELECT kc.content, ks.source_type, kc.source, kc.confidence,
         (SELECT actor FROM knowledge_events WHERE chunk_id=kc.id AND action='create' ORDER BY occurred_at LIMIT 1) AS created_by
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
    LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id
   WHERE p.name=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
   ORDER BY kc.confidence DESC, kc.created_at`, [name])).rows;
console.log(`\n${name} — ${rows.length} LIVE chunk(s):`);
rows.forEach((r, i) => console.log(`\n${i + 1}. [${r.source_type ?? '—'} · via ${r.created_by ?? '?'} · conf ${r.confidence} · ${r.source}]\n   ${r.content}`));
process.exit(0);

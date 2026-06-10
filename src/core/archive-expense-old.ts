/** Archive expense.vin's OLD admin-skewed live chunks — everything validated by the earlier bulk pass,
 *  NOT today's curation — now that the role-recon + docs replace them. Run: railway run npx tsx src/core/archive-expense-old.ts */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';
const actor = 'john@vetvision.org';
const rows = (await db().query<{ id: string; s: string }>(`
  SELECT kc.id, left(kc.content, 60) s FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
   JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
  WHERE p.name='expense.vin' AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
    AND (kc.validation_method IS DISTINCT FROM 'founder_authorized_curation')`)).rows;
for (const r of rows) { await archiveChunk({ chunkId: r.id, actor }); console.log(`  ✓ archived old: "${r.s}…"`); }
console.log(`Archived ${rows.length} old admin-skewed expense chunk(s).`);
process.exit(0);

/** Archive a product's OLD live chunks — everything validated NOT by today's curation — so founder seed
 *  data replaces them. Reversible (soft-archive + audit). Run: railway run npx tsx src/core/archive-old.ts "<product>" */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';
const product = process.argv[2];
const actor = 'john@vetvision.org';
if (!product) { console.error('usage: archive-old.ts <product>'); process.exit(1); }
const rows = (await db().query<{ id: string; s: string }>(`
  SELECT kc.id, left(kc.content, 64) s FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
   JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
  WHERE p.name=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
    AND (kc.validation_method IS DISTINCT FROM 'founder_authorized_curation')`, [product])).rows;
for (const r of rows) { await archiveChunk({ chunkId: r.id, actor }); console.log(`  ✓ archived: "${r.s}…"`); }
console.log(`Archived ${rows.length} old ${product} chunk(s).`);
process.exit(0);

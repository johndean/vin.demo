/** Surgically soft-archive LIVE chunks of a product whose content matches a substring (case-insensitive)
 *  — e.g. removing a single technical-leak chunk caught by leak-scan. Reversible (soft-archive + audit).
 *  Run: railway run npx tsx src/core/archive-match.ts "<product>" "<substring>" */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';
const product = process.argv[2]; const needle = process.argv[3];
const actor = 'john@vetvision.org';
if (!product || !needle) { console.error('usage: archive-match.ts <product> <substring>'); process.exit(1); }
const rows = (await db().query<{ id: string; s: string }>(`
  SELECT kc.id, left(kc.content, 90) s FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
   JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
  WHERE lower(p.name)=lower($1) AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
    AND kc.content ILIKE '%'||$2||'%'`, [product, needle])).rows;
for (const r of rows) { await archiveChunk({ chunkId: r.id, actor }); console.log(`  ✓ archived: "${r.s}…"`); }
console.log(`Archived ${rows.length} live chunk(s) of ${product} matching "${needle}".`);
process.exit(0);

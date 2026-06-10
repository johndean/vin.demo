/** Drop a product's PENDING recon-sourced chunks (e.g. when the live recon hit the wrong tool / a stale
 *  demo URL, so the captures don't match the authoritative docs). Reversible. Run:
 *  railway run npx tsx src/core/archive-pending-recon.ts "<product>" */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';
const product = process.argv[2];
const actor = 'john@vetvision.org';
if (!product) { console.error('usage: archive-pending-recon.ts <product>'); process.exit(1); }
const rows = (await db().query<{ id: string; s: string }>(`
  SELECT kc.id, left(kc.content, 58) s FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
   JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id
  WHERE p.name=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='pending_review' AND ks.source_type='recon'`, [product])).rows;
for (const r of rows) { await archiveChunk({ chunkId: r.id, actor }); console.log(`  ✓ dropped recon: "${r.s}…"`); }
console.log(`Dropped ${rows.length} mismatched recon chunk(s) for ${product}.`);
process.exit(0);

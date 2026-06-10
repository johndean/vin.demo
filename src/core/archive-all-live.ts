/** Clean-slate: soft-archive EVERY non-archived chunk for a product (validated OR pending, any
 *  validation_method) so founder seed data fully replaces it, per "remove existing knowledge chunks".
 *  Reversible (soft-archive + audit). Run: railway run npx tsx src/core/archive-all-live.ts "<product>" */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';
const product = process.argv[2];
const actor = 'john@vetvision.org';
if (!product) { console.error('usage: archive-all-live.ts <product>'); process.exit(1); }
const rows = (await db().query<{ id: string; ls: string; vm: string | null; st: string | null; s: string }>(`
  SELECT kc.id, kc.lifecycle_state ls, kc.validation_method vm, ks.source_type st, left(kc.content, 70) s
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
    LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id
   WHERE lower(p.name)=lower($1) AND kc.archived_at IS NULL ORDER BY kc.created_at`, [product])).rows;
console.log(`\n${rows.length} non-archived chunk(s) for ${product}:`);
for (const r of rows) {
  console.log(`  [${r.ls} · ${r.st ?? 'no-src'} · vm=${r.vm ?? 'none'}] "${r.s}…"`);
  await archiveChunk({ chunkId: r.id, actor });
}
console.log(`\n  ✓ Archived all ${rows.length} — ${product} is now a clean slate.`);
process.exit(0);

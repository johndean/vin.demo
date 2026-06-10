/**
 * Founder-authorized sweep: archive the unverified hand-authored seed chunks the AI currently uses, so no
 * unverified ("plausible but never fact-checked") content can reach a stakeholder. Archive — not delete —
 * via the governed archiveChunk path: takes them off-air (the retrieval gate excludes archived) AND records
 * a knowledge_events('archive') row per chunk, so it's fully reversible. Targets LIVE (validated, non-
 * archived) chunks on the REAL products (excludes eval* fixtures + the lifecycle-demo test product).
 * Run: railway run npx tsx src/core/sweep-seeds.ts
 */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';

const actor = 'john@vetvision.org';
const { rows } = await db().query<{ id: string; product: string; snippet: string }>(`
  SELECT kc.id, p.name AS product, left(kc.content, 72) AS snippet
    FROM products p JOIN knowledge_bases kb ON kb.product_id = p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id = kb.id
   WHERE p.name NOT LIKE 'eval%' AND p.name <> 'lifecycle-demo'
     AND kc.archived_at IS NULL AND kc.lifecycle_state = 'validated'
   ORDER BY p.name, kc.created_at`);

console.log(`\n══ Sweep: archiving ${rows.length} unverified seed chunk(s) (actor=${actor}) ══`);
let ok = 0;
for (const r of rows) {
  try { await archiveChunk({ chunkId: r.id, actor }); ok++; console.log(`  ✓ [${r.product}] ${r.snippet}…`); }
  catch (e: any) { console.log(`  ✗ [${r.product}] ${r.id}: ${e?.message ?? e}`); }
}
console.log(`\n  Done — ${ok}/${rows.length} archived (reversible via un-archive). The KB now serves ONLY fact-rooted, validated content.\n`);
process.exit(ok === rows.length ? 0 : 1);

/** Whole-KB landscape: live (validated, non-archived) chunk count per real product, + how many have a
 *  real embedding (retrievable). Run: railway run npx tsx src/core/kb-landscape.ts */
import { db } from './db.js';
const rows = (await db().query<{ name: string; live: number; embedded: number; pending: number }>(`
  SELECT p.name,
         count(*) FILTER (WHERE kc.archived_at IS NULL AND kc.lifecycle_state='validated')::int live,
         count(*) FILTER (WHERE kc.archived_at IS NULL AND kc.lifecycle_state='validated' AND kc.embedding IS NOT NULL)::int embedded,
         count(*) FILTER (WHERE kc.archived_at IS NULL AND kc.lifecycle_state='pending_review')::int pending
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
   WHERE p.name NOT LIKE 'eval%' AND p.name <> 'lifecycle-demo'
   GROUP BY p.name ORDER BY live DESC`)).rows;
let total = 0;
console.log(`\n══ KB landscape — live (validated) chunks per real product ══`);
for (const r of rows) { total += r.live; console.log(`  ${r.name.padEnd(26)} ${String(r.live).padStart(3)} live  (${r.embedded} embedded${r.pending ? ` · ${r.pending} pending` : ''})`); }
console.log(`  ${'─'.repeat(46)}\n  ${'TOTAL'.padEnd(26)} ${String(total).padStart(3)} live facts`);
process.exit(0);

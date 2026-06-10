/**
 * (1) Archive the 2 expense.vin chunks that assert TRANSIENT demo-state numbers as product facts.
 * (2) Scan ALL live chunks for the same class — the harvest's faithfulness gate proves "true to the screen
 *     at capture time" but NOT "durable product fact", so it can bake demo seed-counts into knowledge.
 * Read-only scan + the 2 targeted archives. Run: railway run npx tsx src/core/kb-transient.ts
 */
import { db } from './db.js';
import { archiveChunk } from './knowledge.js';
const actor = 'john@vetvision.org';

// (1) targeted archive — the two known transient-number chunks on expense.vin
const t = (await db().query<{ id: string; s: string }>(`
  SELECT kc.id, left(kc.content, 64) s FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
   JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
  WHERE p.name='expense.vin' AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
    AND (kc.content ILIKE '%18 total in Hub%' OR kc.content ILIKE '%audit log containing 59%')`)).rows;
for (const r of t) { await archiveChunk({ chunkId: r.id, actor }); console.log(`  ✓ archived transient: "${r.s}…"`); }
console.log(`Archived ${t.length} transient-number chunk(s) on expense.vin.\n`);

// (2) KB-wide scan for likely-transient content (parenthesized counts, "N total/entries/active", "containing N")
const cand = (await db().query<{ product: string; s: string }>(`
  SELECT p.name AS product, left(kc.content, 90) s
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
   WHERE p.name NOT LIKE 'eval%' AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
     AND kc.content ~ '(\\(\\s*[0-9]+|[0-9]+\\s+(total|entries|active|reports|sessions|words|segments)\\b|containing\\s+[0-9]+)'
   ORDER BY p.name`)).rows;
console.log(`Possible TRANSIENT-number chunks still live KB-wide (${cand.length}) — review:`);
for (const c of cand) console.log(`  [${c.product}] "${c.s}…"`);
process.exit(0);

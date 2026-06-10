/**
 * Founder-authorized CLEAN SLATE: archive ALL current knowledge across the real sites so the founder can
 * load authoritative seed data per site. Soft-archive (reversible, audited) — the retrieval gate excludes
 * archived, so the AI runs gated ("let me show you") until seed data is loaded. Excludes eval* + the
 * lifecycle-demo test fixture (not real sites). Run: railway run npx tsx src/core/clean-slate.ts
 */
import { db } from './db.js';
const actor = 'john@vetvision.org';

const rows = (await db().query<{ id: string; product: string }>(`
  SELECT kc.id, p.name AS product
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
   WHERE p.name NOT LIKE 'eval%' AND p.name <> 'lifecycle-demo' AND kc.archived_at IS NULL`)).rows;

if (!rows.length) { console.log('Nothing live to archive — already a clean slate.'); process.exit(0); }
const ids = rows.map((r) => r.id);
await db().query(`UPDATE knowledge_chunks SET archived_at=now(), archived_by=$2, lifecycle_state='archived', updated_at=now() WHERE id = ANY($1::uuid[])`, [ids, actor]);
await db().query(
  `INSERT INTO knowledge_events (chunk_id, source_id, product_id, action, actor, before, after)
   SELECT kc.id, kc.source_id, kb.product_id, 'archive', $2,
          jsonb_build_object('lifecycle_state', 'validated'),
          jsonb_build_object('lifecycle_state', 'archived', 'reason', 'clean_slate — replacing with founder seed data')
     FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kc.id = ANY($1::uuid[])`,
  [ids, actor]);

const byProd: Record<string, number> = {};
for (const r of rows) byProd[r.product] = (byProd[r.product] ?? 0) + 1;
console.log('\n══ Clean slate — archived per site ══');
for (const [p, n] of Object.entries(byProd).sort()) console.log(`  ${p}: ${n}`);
console.log(`\n  Total ${rows.length} chunk(s) archived (reversible via un-archive). Every site's KB is now empty —`);
console.log('  the AI runs gated ("let me show you") until seed data is loaded. Ready for your seed data per site.\n');
process.exit(0);

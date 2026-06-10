/**
 * Founder-authorized HARD PURGE of knowledge for the real sites — current AND historical/archived chunks
 * are DELETED (not soft-archived), per "remove all original knowledge" + "delete historical knowledge".
 * The founder is loading authoritative seed data per site, so the old chunks aren't needed.
 *   • Excludes eval* (the eval suite's fixtures) + lifecycle-demo (test fixture) — not real sites.
 *   • PRESERVES knowledge_events (the audit trail of what was there/removed — denormalized, no FK) and
 *     knowledge_sources (idempotently reused when seed data is re-imported).
 * Run: railway run npx tsx src/core/purge-knowledge.ts
 */
import { db } from './db.js';

const before = (await db().query<{ name: string; n: number; arch: number }>(`
  SELECT p.name, count(*)::int n, count(*) FILTER (WHERE kc.archived_at IS NOT NULL)::int arch
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
   WHERE p.name NOT LIKE 'eval%' AND p.name <> 'lifecycle-demo'
   GROUP BY p.name ORDER BY p.name`)).rows;

const del = await db().query(`
  DELETE FROM knowledge_chunks WHERE knowledge_base_id IN (
    SELECT kb.id FROM knowledge_bases kb JOIN products p ON p.id=kb.product_id
     WHERE p.name NOT LIKE 'eval%' AND p.name <> 'lifecycle-demo')`);

console.log('\n══ Knowledge purge (hard delete) — per site ══');
for (const r of before) console.log(`  ${r.name}: ${r.n} deleted (${r.arch} already archived)`);
console.log(`\n  Total deleted: ${del.rowCount}. knowledge_events audit + source records preserved.`);
console.log('  Every real site is now empty — ready to import seed data.\n');
process.exit(0);

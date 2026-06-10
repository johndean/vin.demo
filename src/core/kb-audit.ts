/**
 * Read-only KB landscape audit. Per product: what the AI uses NOW (live = validated + non-archived) vs the
 * gated fact-rooted queue (pending_review = harvest + docs) vs archived. We deliberately do NOT split live
 * by source_type — the 0011 backfill INFERRED a source_type for every legacy chunk from its category, so
 * that label can't tell hand-authored seed from genuinely fact-rooted. lifecycle_state is the honest line:
 * nothing from the harvest/docs has been validated yet, so every live chunk is original hand-seeded content.
 * Run: railway run npx tsx src/core/kb-audit.ts
 */
import { db } from './db.js';

const summary = (await db().query(`
  SELECT p.name,
    count(*) FILTER (WHERE kc.archived_at IS NULL AND kc.lifecycle_state='validated')      AS live,
    count(*) FILTER (WHERE kc.archived_at IS NULL AND kc.lifecycle_state='pending_review') AS pending,
    count(*) FILTER (WHERE kc.archived_at IS NOT NULL)                                     AS archived
  FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
  JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
  WHERE p.name NOT LIKE 'eval%'
  GROUP BY p.name ORDER BY p.name`)).rows;
console.table(summary.map((r: any) => ({ product: r.name, 'LIVE (AI uses now)': +r.live, 'pending (fact-rooted, gated)': +r.pending, archived: +r.archived })));

const live = (await db().query(`
  SELECT p.name AS product, ks.source_type, kc.validated_by, kc.last_verified::text AS verified, left(kc.content, 88) AS snippet,
         (SELECT actor FROM knowledge_events WHERE chunk_id=kc.id AND action='create' ORDER BY occurred_at LIMIT 1) AS created_by
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id
    JOIN knowledge_chunks kc ON kc.knowledge_base_id=kb.id
    LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id
   WHERE p.name NOT LIKE 'eval%' AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
   ORDER BY p.name, kc.created_at`)).rows;
console.log(`\nLIVE chunks the AI can use right now (${live.length}) — provenance + snippet:`);
for (const c of live as any[]) console.log(`  [${c.product}] (${c.source_type ?? '—'} · by ${c.created_by ?? '?'} · verified ${c.verified ?? '—'}) ${c.snippet}…`);
process.exit(0);

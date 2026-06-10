/**
 * Founder-authorized triage of the pending_review queue: DEDUPE (drop near-identical restatements) and
 * make the survivors AVAILABLE for the AI (validate → the retrieval gate serves them). Everything in the
 * queue is already faithfulness-gated (true to its real source); this only removes redundancy and flips
 * the keepers live. Dedupe is by SELECTION (keep one of a near-duplicate set verbatim) — never by rewriting,
 * so no new text is invented. On validation we RECOMPUTE confidence fresh from the source class (doc→0.94,
 * recon→0.70) so chunks clear the 0.6 gate floor instead of sitting at their seeded 0.5.
 *
 * Dry by default (prints decisions, no writes). Apply with EXECUTE=1. Tune with SIM=<0..1>.
 * Run: railway run npx tsx src/core/triage-pending.ts        (dry)
 *      EXECUTE=1 railway run npx tsx src/core/triage-pending.ts   (apply)
 */
import { db } from './db.js';
import { computeConfidence, sourceQualityFor, recordKnowledgeEvent, type SourceType } from './knowledge.js';

const DRY = process.env.EXECUTE !== '1';
const T = Number(process.env.SIM ?? '0.92'); // cosine-similarity dedupe threshold
const actor = 'john@vetvision.org';

const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

const prods = (await db().query<{ id: string; name: string }>(
  `SELECT id, name FROM products WHERE name NOT LIKE 'eval%' AND name <> 'lifecycle-demo' ORDER BY name`)).rows;

let tPending = 0, tKept = 0, tDup = 0;
for (const p of prods) {
  const rows = (await db().query<{ id: string; content: string; emb: string; source_type: string | null; source_id: string | null }>(
    `SELECT kc.id, kc.content, kc.embedding::text AS emb, ks.source_type, kc.source_id
       FROM knowledge_bases kb JOIN knowledge_chunks kc ON kc.knowledge_base_id = kb.id
       LEFT JOIN knowledge_sources ks ON ks.id = kc.source_id
      WHERE kb.product_id = $1 AND kc.archived_at IS NULL AND kc.lifecycle_state = 'pending_review'`, [p.id])).rows;
  if (!rows.length) continue;
  const sq = (st: string | null) => sourceQualityFor((st ?? 'doc') as SourceType);
  // Keep the most authoritative source (higher quality), then the richer (longer) phrasing, as representative.
  rows.sort((a, b) => (sq(b.source_type) - sq(a.source_type)) || (b.content.length - a.content.length));
  const parsed = rows.map((r) => ({ ...r, vec: JSON.parse(r.emb) as number[] }));
  const kept: typeof parsed = [];
  const dups: { dup: typeof parsed[number]; of: typeof parsed[number]; sim: number }[] = [];
  for (const c of parsed) {
    let best = -1, bestOf: typeof parsed[number] | null = null;
    for (const k of kept) { const s = cos(c.vec, k.vec); if (s > best) { best = s; bestOf = k; } }
    if (bestOf && best > T) dups.push({ dup: c, of: bestOf, sim: best }); else kept.push(c);
  }
  tPending += rows.length; tKept += kept.length; tDup += dups.length;
  console.log(`\n── ${p.name}: ${rows.length} pending → KEEP ${kept.length} · drop ${dups.length} dup ──`);
  for (const d of dups) console.log(`   ✗ dup ${d.sim.toFixed(3)}: "${d.dup.content.slice(0, 58)}…"  ≈  "${d.of.content.slice(0, 58)}…"`);
  if (!DRY) {
    for (const d of dups) {
      await db().query(`UPDATE knowledge_chunks SET archived_at=now(), archived_by=$2, lifecycle_state='archived', updated_at=now() WHERE id=$1`, [d.dup.id, actor]);
      await recordKnowledgeEvent('archive', { chunkId: d.dup.id, sourceId: d.dup.source_id, productId: p.id, actor, after: { lifecycle_state: 'archived', reason: 'duplicate' } });
    }
    for (const k of kept) {
      const conf = computeConfidence(sq(k.source_type), 0).value;
      await db().query(
        `UPDATE knowledge_chunks SET lifecycle_state='validated', validation_status='validated', validated_by=$2,
            validated_at=now(), validation_method='founder_authorized_bulk', last_verified=now()::date, confidence=$3, updated_at=now() WHERE id=$1`,
        [k.id, actor, conf]);
      await recordKnowledgeEvent('validate', { chunkId: k.id, sourceId: k.source_id, productId: p.id, actor, after: { lifecycle_state: 'validated', confidence: conf } });
    }
  }
}
console.log(`\n${DRY ? '[DRY-RUN] ' : ''}TOTAL: ${tPending} pending → KEEP ${tKept} (validated, live) · drop ${tDup} dup. ${DRY ? 'Re-run with EXECUTE=1 to apply.' : 'APPLIED — kept chunks are now live for the AI.'}`);
process.exit(0);

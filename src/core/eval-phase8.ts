/**
 * Phase 8 eval — knowledge PROVENANCE + lifecycle retrievability + mutation audit (migration 0011).
 * Proves: every chunk has a real source_id; every source_id resolves to a real source; the mutation audit
 * is populated; recordKnowledgeEvent round-trips; an ARCHIVED chunk is invisible to retrieval
 * (archive-not-delete); a DEPRECATED chunk is retrieved but GATED. Deterministic, real DB. The
 * archived/deprecated probes INSERT then CLEAN UP a throwaway chunk on the `eval-phase4-product` TEST
 * FIXTURE so real product knowledge is never mutated. Run AFTER migrate + backfill: npm run eval:phase8
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { gateForVector } from './retrieval.js';
import { recordKnowledgeEvent, addChunk, editChunk, validateChunk, archiveChunk } from './knowledge.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

// 1) Provenance coverage — every chunk has a source_id (backfill + the seed/onboard fold).
const nullSrc = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM knowledge_chunks WHERE source_id IS NULL`)).rows[0].n);
checks.push({ name: 'Every chunk has a source_id (provenance backfilled)', pass: nullSrc === 0, detail: `${nullSrc} chunks without source_id` });

// 2) Every source_id resolves to a real knowledge_sources row.
const orphan = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM knowledge_chunks kc LEFT JOIN knowledge_sources ks ON ks.id=kc.source_id WHERE kc.source_id IS NOT NULL AND ks.id IS NULL`)).rows[0].n);
checks.push({ name: 'Every source_id resolves to a real source', pass: orphan === 0, detail: `${orphan} dangling source_id` });

// 3) Mutation audit populated (backfill emitted a 'create' per pre-existing chunk).
const events = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM knowledge_events WHERE action='create'`)).rows[0].n);
const chunkN = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM knowledge_chunks`)).rows[0].n);
checks.push({ name: 'Knowledge mutation audit is populated', pass: events >= 1, detail: `${events} create events / ${chunkN} chunks` });

// 4) recordKnowledgeEvent round-trips before/after jsonb (then clean up the probe event).
await recordKnowledgeEvent('reindex', { chunkId: null, actor: 'eval-phase8', before: { x: 1 }, after: { x: 2, note: 'roundtrip' } });
const rt = (await db().query<{ before: any; after: any }>(`SELECT before, after FROM knowledge_events WHERE actor='eval-phase8' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
checks.push({ name: 'recordKnowledgeEvent round-trips before/after', pass: rt?.before?.x === 1 && rt?.after?.x === 2, detail: JSON.stringify(rt?.after ?? null) });
await db().query(`DELETE FROM knowledge_events WHERE actor='eval-phase8'`);

// 5 + 6) Lifecycle retrievability on the eval-phase4-product TEST FIXTURE (insert probe → gate → clean up).
let archivedExcluded = false, deprecatedGated = false, fixDetail = 'fixture absent';
const fix = (await db().query<{ product_id: string; kb_id: string; version_id: string | null }>(`
  SELECT p.id AS product_id, kb.id AS kb_id,
         (SELECT id FROM product_versions WHERE product_id=p.id ORDER BY created_at LIMIT 1) AS version_id
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  try {
    const SENT = 'EVAL8 SENTINEL zzq probe — archived and deprecated retrievability check';
    const [sv] = await getEmbeddingProvider().embed([SENT]);
    const ins = (lifecycle: string, archivedAt: string | null) => db().query(
      `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state, archived_at)
       VALUES ($1,$2,'docs',$3,$4,0.95,'eval8-sentinel','2026-06-05','validated',$5,$6)`,
      [fix.kb_id, fix.version_id, `${SENT} [${lifecycle}]`, toVector(sv), lifecycle, archivedAt]);
    // archived → excluded from retrieval entirely (WHERE archived_at IS NULL)
    await ins('archived', new Date().toISOString());
    const aRows = (await gateForVector(sv, fix.product_id)).rows;
    archivedExcluded = !aRows.some((r) => r.source === 'eval8-sentinel');
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval8-sentinel'`);
    // deprecated → retrieved (it's the closest) but GATED with a 'deprecated' reason
    await ins('deprecated', null);
    const dGate = await gateForVector(sv, fix.product_id);
    deprecatedGated = dGate.top?.source === 'eval8-sentinel' && dGate.gated && /deprecated/.test(dGate.reason);
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval8-sentinel'`);
    fixDetail = `archivedExcluded=${archivedExcluded} · deprecatedGated=${deprecatedGated} (${dGate.reason})`;
  } catch (e: any) {
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval8-sentinel'`).catch(() => {});
    fixDetail = `error: ${e?.message ?? e}`;
  }
}
checks.push({ name: 'Archived chunk excluded from retrieval (archive-not-delete)', pass: archivedExcluded, detail: fixDetail });
checks.push({ name: 'Deprecated chunk retrieved but gated', pass: deprecatedGated, detail: fixDetail });

// 7) Phase C — the in-console mutation lifecycle through the REAL engine functions: add (draft) → edit
// (pending_review) → validate (validated) → archive (archived), each emitting a knowledge_events row.
// Runs on the eval-phase4-product fixture with a distinct sentinel source; cleans up after.
let mutLifecycle = false, mutDetail = 'fixture absent';
if (fix) {
  try {
    const added = await addChunk({ productId: fix.product_id, content: 'EVAL8 MUT sentinel — lifecycle probe via the in-console knowledge functions.', sourceTitle: 'eval8-mut-sentinel', sourceType: 'manual', actor: 'eval-phase8' });
    const st1 = (await db().query<{ s: string }>(`SELECT lifecycle_state s FROM knowledge_chunks WHERE id=$1`, [added.id])).rows[0]?.s;
    await editChunk({ chunkId: added.id, content: 'EVAL8 MUT sentinel — edited content for the lifecycle probe.', actor: 'eval-phase8' });
    const st2 = (await db().query<{ s: string }>(`SELECT lifecycle_state s FROM knowledge_chunks WHERE id=$1`, [added.id])).rows[0]?.s;
    await validateChunk({ chunkId: added.id, actor: 'eval-phase8' });
    const v = (await db().query<{ s: string; vb: string | null }>(`SELECT lifecycle_state s, validated_by vb FROM knowledge_chunks WHERE id=$1`, [added.id])).rows[0];
    await archiveChunk({ chunkId: added.id, actor: 'eval-phase8' });
    const a = (await db().query<{ s: string; aa: string | null }>(`SELECT lifecycle_state s, archived_at::text aa FROM knowledge_chunks WHERE id=$1`, [added.id])).rows[0];
    const acts = (await db().query<{ action: string }>(`SELECT action FROM knowledge_events WHERE chunk_id=$1 ORDER BY occurred_at`, [added.id])).rows.map((r) => r.action);
    mutLifecycle = st1 === 'draft' && st2 === 'pending_review' && v?.s === 'validated' && v?.vb === 'eval-phase8' && a?.s === 'archived' && !!a?.aa
      && ['create', 'edit', 'validate', 'archive'].every((x) => acts.includes(x));
    mutDetail = `${st1}→${st2}→${v?.s}→${a?.s} · events=[${acts.join(',')}]`;
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval8-mut-sentinel'`);
    await db().query(`DELETE FROM knowledge_events WHERE actor='eval-phase8'`);
    await db().query(`DELETE FROM knowledge_sources WHERE title='eval8-mut-sentinel'`);
  } catch (e: any) {
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval8-mut-sentinel'`).catch(() => {});
    await db().query(`DELETE FROM knowledge_sources WHERE title='eval8-mut-sentinel'`).catch(() => {});
    mutDetail = `error: ${e?.message ?? e}`;
  }
}
checks.push({ name: 'In-console mutation lifecycle (add→edit→validate→archive + audit)', pass: mutLifecycle, detail: mutDetail });

console.log('\n══ Phase 8 eval (knowledge provenance + lifecycle + mutation audit) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase8', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

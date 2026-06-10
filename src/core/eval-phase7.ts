/**
 * Phase 7 eval — proves the KNOWLEDGE TRUST machinery (confidence bands · per-persona floor · staleness
 * gate · validation/lifecycle gate · knowledge-hierarchy re-rank) is observable, using SELF-CONTAINED
 * synthetic fixtures on the eval-phase4-product TEST PRODUCT (insert → assert → clean up). It deliberately
 * does NOT depend on any real product's KB content — earlier it leaned on hand-authored po.vin chunks,
 * which both coupled the test to demo data AND planted "validated" facts in a real product (the fabrication
 * incident). Each fixture carries controlled trust metadata + a distinct sentinel embedding so the gate
 * result is deterministic. Run AFTER migrate: npm run eval:phase7
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { retrieveAndGate, priorityRank } from './retrieval.js';
import type { RetrievedChunk } from './state.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

// Locate the test-fixture product (NOT a real product) to host the synthetic chunks.
const fix = (await db().query<{ product_id: string; kb_id: string; version_id: string | null }>(`
  SELECT p.id AS product_id, kb.id AS kb_id,
         (SELECT id FROM product_versions WHERE product_id=p.id ORDER BY created_at LIMIT 1) AS version_id
    FROM products p JOIN knowledge_bases kb ON kb.product_id=p.id WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];

if (!fix) {
  checks.push({ name: 'eval-phase4-product test fixture present', pass: false, detail: 'fixture absent — run npm run eval:phase4 first' });
} else {
  const SENT = {
    high:    'EVAL7 HIGH sentinel zzq — strong close validated fresh fact about widget alpha configuration',
    medium:  'EVAL7 MEDIUM sentinel zzq — mid-confidence fact about widget beta reporting cadence',
    low:     'EVAL7 LOW sentinel zzq — low-confidence fact about widget gamma offline mode',
    stale:   'EVAL7 STALE sentinel zzq — fact about widget delta year-end procedure',
    pending: 'EVAL7 PENDING sentinel zzq — fact about widget epsilon punch list workflow',
  };
  type Fx = { conf: number; validation: string; lifecycle: string; verified: string };
  const FX: Record<keyof typeof SENT, Fx> = {
    high:    { conf: 0.9,  validation: 'validated', lifecycle: 'validated',      verified: '2026-06-05' },
    medium:  { conf: 0.75, validation: 'validated', lifecycle: 'validated',      verified: '2026-06-05' },
    low:     { conf: 0.64, validation: 'validated', lifecycle: 'validated',      verified: '2026-06-05' },
    stale:   { conf: 0.9,  validation: 'validated', lifecycle: 'validated',      verified: '2025-01-01' },
    pending: { conf: 0.9,  validation: 'pending',   lifecycle: 'pending_review', verified: '2026-06-05' },
  };
  try {
    // Insert the synthetic fixtures (one embed per sentinel; query each by its own text → distance ~0).
    const vecs: Record<string, number[]> = {};
    for (const k of Object.keys(SENT) as (keyof typeof SENT)[]) {
      const [v] = await getEmbeddingProvider().embed([SENT[k]]);
      vecs[k] = v;
      const f = FX[k];
      await db().query(
        `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state)
         VALUES ($1,$2,'docs',$3,$4,$5,'eval7-fixture',$6,$7,$8)`,
        [fix.kb_id, fix.version_id, SENT[k], toVector(v), f.conf, f.verified, f.validation, f.lifecycle]);
    }
    const high = await retrieveAndGate(SENT.high, fix.product_id);
    const medium = await retrieveAndGate(SENT.medium, fix.product_id);
    const low = await retrieveAndGate(SENT.low, fix.product_id);
    const lowFloored = await retrieveAndGate(SENT.low, fix.product_id, 0.7); // persona floor 0.7 > 0.64
    const stale = await retrieveAndGate(SENT.stale, fix.product_id);
    const pending = await retrieveAndGate(SENT.pending, fix.product_id);

    checks.push({ name: 'High band — strong/close/validated/fresh', pass: !high.gated && high.band === 'high', detail: `band=${high.band} gated=${high.gated} (${high.reason})` });
    checks.push({ name: 'Medium band — mid confidence', pass: !medium.gated && medium.band === 'medium', detail: `band=${medium.band} conf=${medium.top?.confidence}` });
    checks.push({ name: 'Low band — low confidence answered cautiously', pass: !low.gated && low.band === 'low', detail: `band=${low.band} conf=${low.top?.confidence}` });
    checks.push({ name: 'Per-persona confidence floor gates the low-conf chunk', pass: lowFloored.gated && /low confidence/.test(lowFloored.reason), detail: lowFloored.reason });
    checks.push({ name: 'Staleness gate — verified >180d ago is gated', pass: stale.gated && /stale/.test(stale.reason), detail: stale.reason });
    checks.push({ name: 'Lifecycle gate — pending_review is gated (not validated)', pass: pending.gated && /not validated/.test(pending.reason), detail: pending.reason });
  } catch (e: any) {
    checks.push({ name: 'fixture harness ran', pass: false, detail: `error: ${e?.message ?? e}` });
  } finally {
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval7-fixture'`).catch(() => {});
  }
}

// Knowledge-hierarchy re-rank (deterministic logic; DB-independent): docs-first ranks docs above marketing, flips on reorder.
const mk = (category: string): RetrievedChunk => ({
  content: '', category, confidence: 0.8, source: '', last_verified: '2026-06-05',
  product_version: 'v2', product_version_status: 'active', validation_status: 'validated', distance: 0.4,
});
const docsFirst = ['Product Documentation', 'Release Notes', 'FAQ', 'Competitor Positioning'];
const mktFirst = ['Competitor Positioning', 'Product Documentation'];
const docsPreferred = priorityRank(mk('docs'), docsFirst) < priorityRank(mk('competitor_positioning'), docsFirst);
const mktPreferred = priorityRank(mk('competitor_positioning'), mktFirst) < priorityRank(mk('docs'), mktFirst);
checks.push({ name: 'Knowledge hierarchy re-rank — docs over marketing (flips on reorder)', pass: docsPreferred && mktPreferred, detail: `docsFirst:docs<comp=${docsPreferred} · mktFirst:comp<docs=${mktPreferred}` });

console.log('\n══ Phase 7 eval (knowledge trust machinery — synthetic fixtures) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase7', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

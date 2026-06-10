/**
 * Phase 13 eval — site/product ISOLATION + cross-product HALLUCINATION prevention (closes the harness's one
 * missing spec category). Proves retrieval is product-scoped against REAL data:
 *   (1) DETERMINISTIC: a SENTINEL chunk inserted into ce.vin's KB is INVISIBLE to PO.vin's gate (the gate
 *       filters by kb.product_id) yet findable in ce.vin — then cleaned up.
 *   (2) SEMANTIC: a query distinctive to one product is answerable for that product but GATED against the
 *       OTHER — so the AI can never answer product A using product B's facts (it refuses instead).
 * Real embeddings + the real gateForVector (same gate the live loop uses). Run: npm run eval:phase13
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { gateForVector } from './retrieval.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

const prods = (await db().query<{ id: string; name: string; kb: string | null; ver: string | null }>(`
  SELECT p.id, p.name,
         (SELECT id FROM knowledge_bases WHERE product_id=p.id ORDER BY id LIMIT 1) kb,
         (SELECT id FROM product_versions WHERE product_id=p.id AND status='active' ORDER BY created_at LIMIT 1) ver
    FROM products p WHERE p.name IN ('PO.vin','ce.vin')`)).rows;
const po = prods.find((p) => p.name === 'PO.vin');
const ce = prods.find((p) => p.name === 'ce.vin');

if (po && ce && ce.kb) {
  // ── (1) DETERMINISTIC isolation: a sentinel in ce.vin must be invisible to PO.vin's gate, findable in ce.vin ──
  const SENT = 'ZZQ ISOLATION SENTINEL — quillfish marlinspike telegraph (unique cross-tenant probe phrase)';
  let isoOk = false, ownOk = false, isoDetail = 'n/a';
  try {
    const [sv] = await getEmbeddingProvider().embed([SENT]);
    await db().query(
      `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, lifecycle_state)
       VALUES ($1,$2,'docs',$3,$4,0.95,'eval13-sentinel',now()::date,'validated','validated')`,
      [ce.kb, ce.ver, SENT, toVector(sv)]);
    const againstPO = await gateForVector(sv, po.id);
    isoOk = !againstPO.rows.some((r) => r.source === 'eval13-sentinel'); // PO.vin cannot see ce.vin's chunk
    const againstCE = await gateForVector(sv, ce.id);
    ownOk = againstCE.top?.source === 'eval13-sentinel';                  // but ce.vin can (gate is product-correct)
    isoDetail = `PO.vin-sees-sentinel=${!isoOk} · ce.vin-top="${againstCE.top?.source ?? 'none'}"`;
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval13-sentinel'`);
  } catch (e: any) {
    await db().query(`DELETE FROM knowledge_chunks WHERE source='eval13-sentinel'`).catch(() => {});
    isoDetail = `error: ${e?.message ?? e}`;
  }
  checks.push({ name: 'Product isolation — one product cannot retrieve another product\'s chunk', pass: isoOk, detail: isoDetail });
  checks.push({ name: 'Own-product retrieval still finds it (gate is product-correct, not always-deny)', pass: ownOk, detail: isoDetail });

  // ── (2) SEMANTIC cross-product hallucination: distinctive query answerable for its product, GATED for the other ──
  const poQ = 'delegated approval of a purchase request when the approver is away';
  const ceQ = 'how learners earn XP, streaks and badges from spaced-repetition reinforcement';
  const [poVec, ceVec] = await getEmbeddingProvider().embed([poQ, ceQ]);
  const poOwn = await gateForVector(poVec, po.id);
  const ceOwn = await gateForVector(ceVec, ce.id);
  const poXce = await gateForVector(poVec, ce.id); // PO.vin question against ce.vin → must gate
  const ceXpo = await gateForVector(ceVec, po.id); // ce.vin question against PO.vin → must gate
  checks.push({ name: 'PO.vin answers its own distinctive query', pass: !poOwn.gated, detail: `gated=${poOwn.gated} dist=${poOwn.top?.distance?.toFixed(3) ?? 'n/a'}` });
  checks.push({ name: 'ce.vin answers its own distinctive query', pass: !ceOwn.gated, detail: `gated=${ceOwn.gated} dist=${ceOwn.top?.distance?.toFixed(3) ?? 'n/a'}` });
  checks.push({ name: 'PO.vin query GATED against ce.vin (no cross-product hallucination)', pass: poXce.gated, detail: `gated=${poXce.gated} (${poXce.reason})` });
  checks.push({ name: 'ce.vin query GATED against PO.vin (no cross-product hallucination)', pass: ceXpo.gated, detail: `gated=${ceXpo.gated} (${ceXpo.reason})` });
} else {
  checks.push({ name: 'PO.vin + ce.vin present with KBs', pass: false, detail: `po=${!!po} ce=${!!ce} ceKb=${!!ce?.kb}` });
}

console.log('\n══ Phase 13 eval (site/product isolation + cross-product hallucination) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase13', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

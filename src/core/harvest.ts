/**
 * Recon-harvest — the fact-rooted knowledge GENERATOR (the mechanism that was missing). Drives a real
 * product via its adapter (REAL login + navigation), captures the ACTUAL on-screen text per DemoGraph
 * screen, extracts candidate knowledge statements STRICTLY grounded in that captured text, runs a
 * FAITHFULNESS gate on each (rejecting anything not entailed by the captured text — zero hallucination),
 * and seeds the survivors as UNVERIFIED (lifecycle 'pending_review', NOT retrievable) with the captured
 * text recorded as provenance in knowledge_events. The founder then validates each in the console before
 * it goes live. This NEVER fabricates: nothing is asserted that wasn't on the real screen + faithfulness-checked.
 * Read-only recon. Run: npm run harvest -- <product-name> [role]
 */
import 'dotenv/config';
import { db, toVector } from './db.js';
import { getAdapter, type DemoNode } from './driver.js';
import { getLlm } from './llm.js';
import { getEmbeddingProvider } from './embeddings.js';
import { ensureSource, recordKnowledgeEvent } from './knowledge.js';
import type { ExecutionMode } from './safety.js';

const productName = process.argv[2];
const role = process.argv[3] ?? 'admin';
if (!productName) { console.error('usage: npm run harvest -- <product-name> [role]'); process.exit(1); }

const prod = (await db().query<{ id: string; kb: string | null; ver: string | null }>(`
  SELECT p.id,
         (SELECT id FROM knowledge_bases WHERE product_id=p.id ORDER BY id LIMIT 1) kb,
         (SELECT id FROM product_versions WHERE product_id=p.id AND status='active' ORDER BY created_at LIMIT 1) ver
    FROM products p WHERE lower(p.name)=lower($1) LIMIT 1`, [productName])).rows[0];
if (!prod?.kb) { console.error(`product "${productName}" not found or has no knowledge base`); process.exit(1); }

const nodes = (await db().query(`
  SELECT n.intent_label, n.screen_route, n.locator_strategies, n.persona_labels
    FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id WHERE g.product_id=$1 ORDER BY n.intent_label`,
  [prod.id])).rows as unknown as DemoNode[];

console.log(`\n══ Recon-harvest: ${productName} (role ${role}) — ${nodes.length} screen(s) ══`);

// 1) Drive the REAL site read-only + capture actual on-screen text per screen.
const adapter = await getAdapter(productName, 'read-only' as ExecutionMode);
const captures: { screen: string; url: string; text: string }[] = [];
try {
  await adapter.open(role);
  const grab = async (screen: string) => {
    const p = (adapter as { page?: import('playwright').Page }).page;
    if (!p) { console.log(`  (no page for "${screen}")`); return; }
    const text = (await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    captures.push({ screen, url: p.url(), text });
    console.log(`  captured "${screen}" — ${text.length} chars @ ${p.url()}`);
  };
  await grab('landing');
  for (const node of nodes) {
    await adapter.gotoNode(node, role).catch((e: any) => console.log(`  (nav "${node.intent_label}" failed: ${e?.message ?? e})`));
    await grab(node.intent_label);
  }
} finally { await adapter.close().catch(() => {}); }

// 2) Grounded extraction + faithfulness gate + seed UNVERIFIED (pending_review). Idempotent on content.
const llm = getLlm();
let seeded = 0, rejected = 0, dup = 0;
for (const cap of captures) {
  if (cap.text.length < 60) continue;
  const candidates = await llm.harvestChunks({ product: productName, screen: cap.screen, capturedText: cap.text });
  for (const cand of candidates) {
    const faithful = await llm.verifyFaithful({ statement: cand, source: cap.text });
    if (!faithful) { rejected++; console.log(`  ✗ rejected (unfaithful): "${cand.slice(0, 80)}…"`); continue; }
    const exists = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2', [prod.kb, cand]);
    if (exists.rowCount) { dup++; continue; }
    const title = `recon: ${productName} · ${cap.screen}`;
    const sourceId = await ensureSource(prod.id, { title, sourceType: 'recon', owner: 'recon-harvest', uri: cap.url, versionId: prod.ver, createdBy: 'recon-harvest' });
    const [emb] = await getEmbeddingProvider().embed([cand]);
    const ins = await db().query<{ id: string }>(
      `INSERT INTO knowledge_chunks
         (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, source_id, lifecycle_state, updated_at)
       VALUES ($1,$2,'docs',$3,$4,0.5,$5,now()::date,'unverified',$6,'pending_review',now()) RETURNING id`,
      [prod.kb, prod.ver, cand, toVector(emb), title, sourceId]);
    await recordKnowledgeEvent('create', { chunkId: ins.rows[0].id, sourceId, productId: prod.id, actor: 'recon-harvest',
      after: { content: cand, screen: cap.screen, url: cap.url, faithful: true, captured_excerpt: cap.text.slice(0, 400) } });
    seeded++;
    console.log(`  ✓ seeded (pending_review): "${cand.slice(0, 90)}…"`);
  }
}
console.log(`\n  Harvest complete — ${seeded} candidate(s) seeded pending_review · ${rejected} rejected by the faithfulness gate · ${dup} duplicate(s) skipped.`);
console.log(`  Nothing is retrievable until you validate it in the console (Knowledge → Needs review).`);
process.exit(0);

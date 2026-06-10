/**
 * Ingest REAL product docs through the SAME zero-hallucination gate as recon-harvest: read a docs file,
 * split it into passages, extract candidate knowledge STRICTLY grounded in each passage
 * (llm.harvestChunks), run the FAITHFULNESS gate on each (llm.verifyFaithful), and seed the survivors
 * UNVERIFIED (lifecycle 'pending_review', not retrievable) with the passage recorded as provenance. The
 * doc is the fact source — nothing is invented; the founder validates each in the console before it goes
 * live. Run: npm run ingest:docs -- <product-name> <path-to-doc.txt|md>
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db, toVector } from './db.js';
import { getLlm } from './llm.js';
import { getEmbeddingProvider } from './embeddings.js';
import { ensureSource, recordKnowledgeEvent } from './knowledge.js';

const productName = process.argv[2];
const file = process.argv[3];
if (!productName || !file) { console.error('usage: npm run ingest:docs -- <product-name> <file>'); process.exit(1); }

const prod = (await db().query<{ id: string; kb: string | null; ver: string | null }>(`
  SELECT p.id,
         (SELECT id FROM knowledge_bases WHERE product_id=p.id ORDER BY id LIMIT 1) kb,
         (SELECT id FROM product_versions WHERE product_id=p.id AND status='active' ORDER BY created_at LIMIT 1) ver
    FROM products p WHERE lower(p.name)=lower($1) LIMIT 1`, [productName])).rows[0];
if (!prod?.kb) { console.error(`product "${productName}" not found or has no knowledge base`); process.exit(1); }

const raw = await readFile(file, 'utf8');
// Split on blank lines / headings into passages; normalize whitespace; drop trivially short fragments.
const passages = raw.split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 60);
console.log(`\n══ Doc ingest: ${productName} ← ${file} (${passages.length} passage(s)) ══`);

const llm = getLlm();
const docTitle = `docs: ${file.split('/').pop()}`;
let seeded = 0, rejected = 0, dup = 0;
for (let i = 0; i < passages.length; i++) {
  const passage = passages[i].slice(0, 2000);
  const candidates = await llm.harvestChunks({ product: productName, screen: `${docTitle} · passage ${i + 1}`, capturedText: passage });
  for (const cand of candidates) {
    if (!(await llm.verifyFaithful({ statement: cand, source: passage }))) { rejected++; console.log(`  ✗ rejected (unfaithful): "${cand.slice(0, 70)}…"`); continue; }
    const exists = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2', [prod.kb, cand]);
    if (exists.rowCount) { dup++; continue; }
    const sourceId = await ensureSource(prod.id, { title: docTitle, sourceType: 'doc', owner: 'doc-ingest', uri: file, versionId: prod.ver, createdBy: 'doc-ingest' });
    const [emb] = await getEmbeddingProvider().embed([cand]);
    const ins = await db().query<{ id: string }>(
      `INSERT INTO knowledge_chunks
         (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, source_id, lifecycle_state, updated_at)
       VALUES ($1,$2,'docs',$3,$4,0.5,$5,now()::date,'unverified',$6,'pending_review',now()) RETURNING id`,
      [prod.kb, prod.ver, cand, toVector(emb), docTitle, sourceId]);
    await recordKnowledgeEvent('create', { chunkId: ins.rows[0].id, sourceId, productId: prod.id, actor: 'doc-ingest',
      after: { content: cand, source: docTitle, faithful: true, passage_excerpt: passage.slice(0, 400) } });
    seeded++;
    console.log(`  ✓ seeded (pending_review): "${cand.slice(0, 90)}…"`);
  }
}
console.log(`\n  Doc ingest complete — ${seeded} seeded pending_review · ${rejected} rejected by the faithfulness gate · ${dup} duplicate(s). Validate in the console (Knowledge → Needs review).`);
process.exit(0);

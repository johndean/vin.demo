/**
 * Onboard product #3 — rounds.vin (P3.4), by hand. A medical content PRODUCTION
 * PIPELINE (a different domain from the approval apps — the real test of the adapter
 * contract). Idempotent: product + active version + environment (https://rounds.vin)
 * + trust-tagged knowledge (the pipeline, corroborated by the Rounds API spec) +
 * DemoGraph (pipeline overview, sessions) + expected intents.
 * Prints ROUNDS_VIN_PRODUCT_ID.  Run: npm run seed:rounds
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';

async function upsert(table: string, match: Record<string, unknown>, insert: Record<string, unknown>): Promise<string> {
  const whereSql = Object.keys(match).map((k, i) => `${k} = $${i + 1}`).join(' AND ');
  const found = await db().query<{ id: string }>(`SELECT id FROM ${table} WHERE ${whereSql} LIMIT 1`, Object.values(match));
  if (found.rows[0]) return found.rows[0].id;
  const cols = Object.keys(insert);
  const res = await db().query<{ id: string }>(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(insert),
  );
  return res.rows[0].id;
}

const orgId = await upsert('organizations', { name: 'VIN Demo (internal)' }, { name: 'VIN Demo (internal)' });
const wsId = await upsert('workspaces', { org_id: orgId, name: 'default' }, { org_id: orgId, name: 'default' });
const productId = await upsert('products', { workspace_id: wsId, name: 'rounds.vin' }, { workspace_id: wsId, name: 'rounds.vin' });
const versionId = await upsert(
  'product_versions',
  { product_id: productId, version_label: 'v1 · Flowint SSOT' },
  { product_id: productId, version_label: 'v1 · Flowint SSOT', status: 'active' },
);
await upsert(
  'environments',
  { product_id: productId, name: 'rounds.vin (production-as-QA)' },
  { product_id: productId, name: 'rounds.vin (production-as-QA)', connection_target: 'https://rounds.vin', is_production: true, reset_mechanism: 'manual' },
);
const kbId = await upsert('knowledge_bases', { product_id: productId, name: 'rounds.vin docs' }, { product_id: productId, name: 'rounds.vin docs' });

// Knowledge: the production pipeline (visible on the dashboard, corroborated by the
// Rounds API groups: sessions / segments / word-alignment / corrections / discrepancies
// / sop / queue / exports / improvements).
const CHUNKS: { category: string; content: string }[] = [
  { category: 'docs', content: 'In rounds.vin, a recorded session moves through a production pipeline: Upload → Transcribe → Normalize → Align → Fuse → Ready → Copy-edit (draft) → Medical review → Copy-edit (final) → CMS published → Captions on video → QA → Complete. The dashboard shows how many sessions sit at each stage.' },
  { category: 'docs', content: 'Each session is split into segments that are transcribed and word-aligned; corrections and discrepancies are resolved against the SOP before copy-edit.' },
  { category: 'docs', content: 'Medical review is the stage where a clinician verifies the content for accuracy before the final copy-edit and CMS publishing.' },
  { category: 'docs', content: 'A stuck or failed session can be rescued from the dashboard by re-running the failed stage; the queue and audit log track every step.' },
];
const missing: typeof CHUNKS = [];
for (const c of CHUNKS) {
  const ex = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id = $1 AND content = $2', [kbId, c.content]);
  if (!ex.rowCount) missing.push(c);
}
if (missing.length) {
  const embs = await getEmbeddingProvider().embed(missing.map((c) => c.content));
  for (let i = 0; i < missing.length; i++) {
    await db().query(
      `INSERT INTO knowledge_chunks
         (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status)
       VALUES ($1,$2,$3,$4,$5,0.8,'rounds.vin dashboard + Rounds API','2026-06-06','validated')`,
      [kbId, versionId, missing[i].category, missing[i].content, toVector(embs[i])],
    );
  }
  console.log(`  + seeded ${missing.length} rounds.vin knowledge chunks`);
} else console.log('  = rounds.vin knowledge chunks already present');

// DemoGraph — nav is <a href="#/…"> links; self-heal across has-text + route fallback.
const graphId = await upsert('demo_graphs', { product_id: productId, name: 'rounds.vin demo' }, { product_id: productId, name: 'rounds.vin demo' });
const NODES = [
  { intent_label: 'pipeline overview', route: '#/dashboard', personas: { admin: 'Dashboard', default: 'Dashboard' } },
  { intent_label: 'sessions list', route: '#/sessions', personas: { admin: 'Sessions', default: 'Sessions' } },
];
for (const n of NODES) {
  const ex = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id = $1 AND intent_label = $2', [graphId, n.intent_label]);
  if (ex.rowCount) continue;
  await db().query(
    `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels)
     VALUES ($1, $2, $3, $4, $5)`,
    [graphId, n.intent_label, n.route,
     JSON.stringify([{ how: 'css', value: 'a:has-text("{label}")' }, { how: 'text', value: 'text={label}' }]),
     JSON.stringify(n.personas)],
  );
  console.log(`  + seeded DemoGraph node "${n.intent_label}"`);
}

const EXPECTED = [
  'how does a session move through the production pipeline',
  'what happens in the medical review stage',
  'how do I rescue a stuck or failed session',
  'how are sessions transcribed and word-aligned',
  'how do I configure billing and invoices', // not covered → shows a gap
];
for (const intent of EXPECTED) await upsert('expected_intents', { product_id: productId, intent }, { product_id: productId, intent });
console.log(`  = ${EXPECTED.length} expected intents present (coverage)`);

console.log(`\nrounds.vin onboarded. Scope retrieval to it with:\n  ROUNDS_VIN_PRODUCT_ID=${productId}\n`);
process.exit(0);

/**
 * Onboard product #4 — ce.vin (P3.4), by hand. The "CE Course Tool": uploaded sessions
 * (audio + slides) become reviewed continuing-education courses. A DIFFERENT auth stack
 * (token-based, blank /sign-in shell → app at /#/dashboard) — handled by the adapter's
 * postLoginPath. Idempotent. Prints CE_VIN_PRODUCT_ID.  Run: npm run seed:ce
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
const productId = await upsert('products', { workspace_id: wsId, name: 'ce.vin' }, { workspace_id: wsId, name: 'ce.vin' });
const versionId = await upsert(
  'product_versions',
  { product_id: productId, version_label: 'v0.1' },
  { product_id: productId, version_label: 'v0.1', status: 'active' },
);
await upsert(
  'environments',
  { product_id: productId, name: 'ce.vin (production-as-QA)' },
  { product_id: productId, name: 'ce.vin (production-as-QA)', connection_target: 'https://ce.vin', is_production: true, reset_mechanism: 'manual' },
);
const kbId = await upsert('knowledge_bases', { product_id: productId, name: 'ce.vin docs' }, { product_id: productId, name: 'ce.vin docs' });

const CHUNKS: { category: string; content: string }[] = [
  { category: 'docs', content: 'ce.vin (the CE Course Tool) turns an uploaded session — audio plus slides — into a reviewed continuing-education course: you upload, Stage 0 starts, the session passes review gates, and finished courses are published for members.' },
  { category: 'docs', content: 'The Needs-review queue surfaces coverage gaps, gate violations, and low-confidence items that must be resolved before a course is published.' },
  { category: 'docs', content: 'On the Sessions screen you can filter, search, and open any uploaded session; "Awaiting review" means Stage 0 is done and the review gate is open.' },
  { category: 'docs', content: 'Settings holds the AI models, prompt templates, profiles, and diagnostics that drive course production.' },
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
       VALUES ($1,$2,$3,$4,$5,0.8,'ce.vin app (CE Course Tool)','2026-06-06','validated')`,
      [kbId, versionId, missing[i].category, missing[i].content, toVector(embs[i])],
    );
  }
  console.log(`  + seeded ${missing.length} ce.vin knowledge chunks`);
} else console.log('  = ce.vin knowledge chunks already present');

// DemoGraph — nav is <a href="/op/…"> client-side links; click via has-text (route-goto
// renders blank for path routes, so no screen_route fallback).
const graphId = await upsert('demo_graphs', { product_id: productId, name: 'ce.vin demo' }, { product_id: productId, name: 'ce.vin demo' });
const NODES = [
  { intent_label: 'needs-review queue', personas: { admin: 'Needs review', default: 'Needs review' } },
  { intent_label: 'sessions list', personas: { admin: 'Sessions', default: 'Sessions' } },
];
for (const n of NODES) {
  const ex = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id = $1 AND intent_label = $2', [graphId, n.intent_label]);
  if (ex.rowCount) continue;
  await db().query(
    `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels)
     VALUES ($1, $2, NULL, $3, $4)`,
    [graphId, n.intent_label,
     JSON.stringify([{ how: 'css', value: 'a:has-text("{label}")' }, { how: 'text', value: 'text={label}' }]),
     JSON.stringify(n.personas)],
  );
  console.log(`  + seeded DemoGraph node "${n.intent_label}"`);
}

const EXPECTED = [
  'what is in my needs-review queue',
  'how does an uploaded session become a course',
  'what does awaiting review mean',
  'where do I manage AI models and prompt templates',
  'how do I run payroll', // not covered → shows a gap
];
for (const intent of EXPECTED) await upsert('expected_intents', { product_id: productId, intent }, { product_id: productId, intent });
console.log(`  = ${EXPECTED.length} expected intents present (coverage)`);

console.log(`\nce.vin onboarded. Scope retrieval to it with:\n  CE_VIN_PRODUCT_ID=${productId}\n`);
process.exit(0);

/**
 * Onboard product #5 — modelcontract.software (P3.4c). A PUBLIC, no-login VIN Foundation
 * wizard that builds a model employment agreement (a NEW modality: an interactive
 * multi-step form, demoed via a `safe`-mode walkthrough). Idempotent; no DemoGraph
 * (the walkthrough drives the wizard directly). Prints MC_PRODUCT_ID. Run: npm run seed:mc
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
const productId = await upsert('products', { workspace_id: wsId, name: 'modelcontract.software' }, { workspace_id: wsId, name: 'modelcontract.software' });
const versionId = await upsert(
  'product_versions',
  { product_id: productId, version_label: 'v1 · VIN Foundation' },
  { product_id: productId, version_label: 'v1 · VIN Foundation', status: 'active' },
);
await upsert(
  'environments',
  { product_id: productId, name: 'modelcontract.software (public widget)' },
  { product_id: productId, name: 'modelcontract.software (public widget)', connection_target: 'https://modelcontract.software', is_production: true, reset_mechanism: 'none' },
);
const kbId = await upsert('knowledge_bases', { product_id: productId, name: 'modelcontract.software docs' }, { product_id: productId, name: 'modelcontract.software docs' });

const CHUNKS: { category: string; content: string }[] = [
  { category: 'docs', content: 'modelcontract.software is a VIN Foundation wizard that builds a model employment agreement for a veterinary practice, guiding you step by step (about 45 steps) through the terms of the agreement.' },
  { category: 'docs', content: 'The wizard personalizes the agreement by role — Employer (creating it for their business or practice) or Employee (reviewing or creating it for themselves) — and by environment, such as veterinary.' },
  { category: 'docs', content: 'The wizard tracks required-field completion and overall progress; the agreement is only generated once all required steps are complete, so stepping through the questions changes nothing until you generate it.' },
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
       VALUES ($1,$2,$3,$4,$5,0.8,'modelcontract.software (VIN Foundation wizard)','2026-06-06','validated')`,
      [kbId, versionId, missing[i].category, missing[i].content, toVector(embs[i])],
    );
  }
  console.log(`  + seeded ${missing.length} modelcontract.software knowledge chunks`);
} else console.log('  = modelcontract.software knowledge chunks already present');

const EXPECTED = [
  'what does the model employment agreement wizard do',
  'is this agreement for an employer or an employee',
  'how many steps are in the wizard',
  'how do I generate the agreement',
  'how do I file my quarterly taxes', // not covered → shows a gap
];
for (const intent of EXPECTED) await upsert('expected_intents', { product_id: productId, intent }, { product_id: productId, intent });
console.log(`  = ${EXPECTED.length} expected intents present (coverage)`);

console.log(`\nmodelcontract.software onboarded. Scope retrieval to it with:\n  MC_PRODUCT_ID=${productId}\n`);
process.exit(0);

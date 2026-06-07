/**
 * Onboard product #2 — expense.vin (P3.3), by hand. Idempotent: a second Product in
 * the existing workspace, with its active version, environment (https://www.expense.vin),
 * a trust-tagged knowledge base (the manager approval flow, from recon + founder sign-off),
 * a DemoGraph (Approvals + Delegation screens), and expected intents for coverage.
 * Prints EXPENSE_VIN_PRODUCT_ID.  Run: npm run seed:expense
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
const productId = await upsert('products', { workspace_id: wsId, name: 'expense.vin' }, { workspace_id: wsId, name: 'expense.vin' });
const versionId = await upsert(
  'product_versions',
  { product_id: productId, version_label: 'v1' },
  { product_id: productId, version_label: 'v1', status: 'active' },
);
await upsert(
  'environments',
  { product_id: productId, name: 'expense.vin (production-as-QA)' },
  { product_id: productId, name: 'expense.vin (production-as-QA)', connection_target: 'https://www.expense.vin', is_production: true, reset_mechanism: 'manual' },
);
const kbId = await upsert('knowledge_bases', { product_id: productId, name: 'expense.vin docs' }, { product_id: productId, name: 'expense.vin docs' });

// Founder-approved knowledge (source: expense.vin help center / recon).
const CHUNKS: { category: string; content: string }[] = [
  { category: 'docs', content: 'In VIN Expense Reimbursement, an employee submits an expense report; their manager approves; the finance/accounting team checks and codes it; then it is queued and paid — "Reimbursed" means the money is on its way. You are notified at each step.' },
  { category: 'docs', content: 'A manager\'s Approvals queue shows reports submitted by their team and anyone whose approvals are delegated to them, split into "Awaiting your approval", "In clarification", and "Approved this cycle".' },
  { category: 'docs', content: 'Delegation lets a manager hand their approval authority to another user so expense reports are not blocked when they are unavailable.' },
  { category: 'docs', content: 'A flag marks an expense report that needs attention, such as a policy exception, before it can proceed.' },
];
const missing: typeof CHUNKS = [];
for (const c of CHUNKS) {
  const ex = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id = $1 AND content = $2', [kbId, c.content]);
  if (!ex.rowCount) missing.push(c);
}
if (missing.length) {
  const embs = await getEmbeddingProvider().embed(missing.map((c) => c.content)); // one batched embed
  for (let i = 0; i < missing.length; i++) {
    await db().query(
      `INSERT INTO knowledge_chunks
         (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status)
       VALUES ($1,$2,$3,$4,$5,0.8,'expense.vin help center','2026-06-06','validated')`,
      [kbId, versionId, missing[i].category, missing[i].content, toVector(embs[i])],
    );
  }
  console.log(`  + seeded ${missing.length} expense.vin knowledge chunks`);
} else console.log('  = expense.vin knowledge chunks already present');

// DemoGraph — the Manager screens from recon (button-based nav; self-heal across strategies).
const graphId = await upsert('demo_graphs', { product_id: productId, name: 'expense.vin demo' }, { product_id: productId, name: 'expense.vin demo' });
const NODES = [
  { intent_label: 'approvals queue', personas: { manager: 'Approvals', accounting: 'Approvals', admin: 'Approvals', default: 'Approvals' } },
  { intent_label: 'delegation settings', personas: { manager: 'Delegation', admin: 'Delegation', default: 'Delegation' } },
];
for (const n of NODES) {
  const ex = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id = $1 AND intent_label = $2', [graphId, n.intent_label]);
  if (ex.rowCount) continue;
  await db().query(
    `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels)
     VALUES ($1, $2, NULL, $3, $4)`,
    [graphId, n.intent_label,
     JSON.stringify([{ how: 'css', value: 'button:has-text("{label}")' }, { how: 'text', value: 'text={label}' }]),
     JSON.stringify(n.personas)],
  );
  console.log(`  + seeded DemoGraph node "${n.intent_label}"`);
}

// Expected intents for coverage (mix the KB does and does not cover).
const EXPECTED = [
  'how do I approve an expense report',
  'what is waiting for me to approve',
  'how does expense approval delegation work',
  'what is a flag on an expense report',
  'how do I configure spend policies and categories', // not covered → shows a gap
];
for (const intent of EXPECTED) await upsert('expected_intents', { product_id: productId, intent }, { product_id: productId, intent });
console.log(`  = ${EXPECTED.length} expected intents present (coverage)`);

console.log(`\nexpense.vin onboarded. Scope retrieval to it with:\n  EXPENSE_VIN_PRODUCT_ID=${productId}\n`);
process.exit(0);

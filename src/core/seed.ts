/**
 * Idempotent seed: PO.vin as a product with a knowledge base, one trust-tagged
 * approval-delegation chunk (embedded), and its (production-as-QA) environment
 * per ADR-0003. Prints PO_VIN_PRODUCT_ID for the loop runner.
 *
 * Run after applying db/migrations/0001_entity_model.sql:  npm run seed
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';

/** Insert if absent (by the given match), return the row id. */
async function upsert(table: string, match: Record<string, unknown>, insert: Record<string, unknown>): Promise<string> {
  const whereKeys = Object.keys(match);
  const whereSql = whereKeys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
  const found = await db().query<{ id: string }>(`SELECT id FROM ${table} WHERE ${whereSql} LIMIT 1`, Object.values(match));
  if (found.rows[0]) return found.rows[0].id;
  const cols = Object.keys(insert);
  const vals = Object.values(insert);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const res = await db().query<{ id: string }>(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    vals,
  );
  return res.rows[0].id;
}

const orgId = await upsert('organizations', { name: 'VIN Demo (internal)' }, { name: 'VIN Demo (internal)' });
const wsId = await upsert('workspaces', { org_id: orgId, name: 'default' }, { org_id: orgId, name: 'default' });
const productId = await upsert('products', { workspace_id: wsId, name: 'PO.vin' }, { workspace_id: wsId, name: 'PO.vin' });
const versionId = await upsert(
  'product_versions',
  { product_id: productId, version_label: 'v2' },
  { product_id: productId, version_label: 'v2', status: 'active' },
);
await upsert(
  'environments',
  { product_id: productId, name: 'po.vin (production-as-QA)' },
  { product_id: productId, name: 'po.vin (production-as-QA)', connection_target: 'https://po.vin', is_production: true, reset_mechanism: 'manual' },
);
const kbId = await upsert('knowledge_bases', { product_id: productId, name: 'PO.vin docs' }, { product_id: productId, name: 'PO.vin docs' });

const content =
  'In Purchase Hub, a purchase request routes through Manager → Owner approval stages. ' +
  'Delegation lets an approver hand their authority to another user (or auto-route) so a request ' +
  'is not blocked when they are unavailable; delegated/auto-routed approvals appear under "Bypassed". ' +
  'Routing rules are configured in Workflow Settings.';

const exists = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id = $1 AND content = $2', [kbId, content]);
if (!exists.rowCount) {
  const [embedding] = await getEmbeddingProvider().embed([content]);
  await db().query(
    `INSERT INTO knowledge_chunks
       (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status)
     VALUES ($1,$2,'docs',$3,$4,0.82,'po.vin docs · purchase-order-workflow.ts','2026-06-05','validated')`,
    [kbId, versionId, content, toVector(embedding)],
  );
  console.log('  + seeded approval-delegation knowledge chunk');
} else {
  console.log('  = approval-delegation chunk already present');
}

// DemoGraph: the navigator's intent-targets (persona-aware labels + ordered
// locator strategies). The first strategy is intentionally stale to exercise self-heal.
const graphId = await upsert('demo_graphs', { product_id: productId, name: 'PO.vin demo' }, { product_id: productId, name: 'PO.vin demo' });
const nodeExists = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id = $1 AND intent_label = $2', [graphId, 'approvals queue']);
if (!nodeExists.rowCount) {
  await db().query(
    `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels)
     VALUES ($1, 'approvals queue', NULL, $2, $3)`,
    [
      graphId,
      JSON.stringify([
        { how: 'stale-css', value: '#sidebar-approval-queue-v1' },
        { how: 'css', value: 'button:has-text("{label}")' },
        { how: 'text', value: 'text={label}' },
      ]),
      JSON.stringify({ manager: 'Review Queue', owner: 'Approval Queue', admin: 'Manager Queue', default: 'Approval Queue' }),
    ],
  );
  console.log('  + seeded DemoGraph node "approvals queue"');
} else {
  console.log('  = DemoGraph node "approvals queue" already present');
}

// Second node so a mid-flight pivot has a real target (Owner/Admin see "Bypassed").
const bypExists = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id = $1 AND intent_label = $2', [graphId, 'bypassed (delegated approvals)']);
if (!bypExists.rowCount) {
  await db().query(
    `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels)
     VALUES ($1, 'bypassed (delegated approvals)', NULL, $2, $3)`,
    [
      graphId,
      JSON.stringify([
        { how: 'stale-css', value: '.legacy-bypassed-link' },
        { how: 'css', value: 'button:has-text("{label}")' },
        { how: 'text', value: 'text={label}' },
      ]),
      JSON.stringify({ default: 'Bypassed', admin: 'Bypassed', owner: 'Bypassed' }),
    ],
  );
  console.log('  + seeded DemoGraph node "bypassed (delegated approvals)"');
} else {
  console.log('  = DemoGraph node "bypassed" already present');
}

// Expected intents for coverage scoring (P2.4) — deliberately a mix the seeded KB
// does (delegation/bypassed/routing/stages) and does NOT (invoice matching, pricing)
// cover, so coverage reports a real gap rather than a vacuous 100%.
const EXPECTED_INTENTS = [
  'how does approval delegation work',
  'where do delegated or bypassed approvals appear',
  'how are approval routing rules configured',
  'how does a purchase request move through approval stages',
  'how does invoice three-way matching work',
  'what are the subscription pricing tiers',
];
for (const intent of EXPECTED_INTENTS) {
  await upsert('expected_intents', { product_id: productId, intent }, { product_id: productId, intent });
}
console.log(`  = ${EXPECTED_INTENTS.length} expected intents present (coverage)`);

console.log(`\nSeed complete. Set this in .env so the loop scopes retrieval to PO.vin:`);
console.log(`  PO_VIN_PRODUCT_ID=${productId}\n`);
process.exit(0);

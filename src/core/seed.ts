/**
 * Idempotent seed: PO.vin as a product with a knowledge base, one trust-tagged
 * approval-delegation chunk (embedded), and its (production-as-QA) environment
 * per ADR-0003. Prints PO_VIN_PRODUCT_ID for the loop runner.
 *
 * Run after applying db/migrations/0001_entity_model.sql:  npm run seed
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { ensureSource, inferSourceType, mapLifecycle } from './knowledge.js';

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

// Trust-tagged knowledge — DELIBERATELY DIVERSE across the trust dimensions the engine actually gates
// on (category · confidence · validation_status · last_verified), so the real machinery is OBSERVABLE,
// not inert: the 4-gate trust check (retrieval.ts), the graded confidence bands, the per-persona
// minConfidence floor, and the persona knowledge-hierarchy re-rank all fire against real, true content.
// The first two (the product's CORE create/submit action + the approval-delegation scenario) stay
// docs · validated · high-confidence · fresh so the demo + eval-phase1 answer them directly (band=high);
// the rest are genuinely-true PO.vin facts on DISTINCT topics, so a query about (say) "punchout catalog"
// surfaces the unvalidated chunk and gates honestly without disturbing the core delegation/create path.
// Defaults: category 'docs', validation 'validated', verified '2026-06-05'. `verified` is a stable date,
// not now() — so the stale chunk stays stale regardless of when the seed runs.
const FRESH = '2026-06-05';
const CHUNKS: { content: string; source: string; conf: number; category?: string; validation?: string; verified?: string }[] = [
  {
    content:
      'To create a new purchase order in Purchase Hub, click "New Purchase Request", then add one or more ' +
      'line items (vendor, item description, quantity, and unit cost), set the needed-by date and the ' +
      'department, and click Submit. On submit the request is created and routed through the Manager → ' +
      'Owner approval stages; you can track its status any time from "My Requests" (or "Working on" for ' +
      'drafts). Drafts can be saved and submitted later.',
    source: 'po.vin docs · create-purchase-order.ts', conf: 0.9, // docs · validated · fresh → band high
  },
  {
    content:
      'In Purchase Hub, a purchase request routes through Manager → Owner approval stages. ' +
      'Delegation lets an approver hand their authority to another user (or auto-route) so a request ' +
      'is not blocked when they are unavailable; delegated/auto-routed approvals appear under "Bypassed". ' +
      'Routing rules are configured in Workflow Settings.',
    source: 'po.vin docs · purchase-order-workflow.ts', conf: 0.82,
  },
  // ── release note (different category → exercises the knowledge-hierarchy re-rank for "what's new") ──
  {
    content:
      'PO.vin v2 release notes: added bulk approval (approve several pending requests at once), CSV export ' +
      'of purchase history, a redesigned vendor picker, and daily email digests of pending approvals.',
    source: 'po.vin release notes · v2', conf: 0.88, category: 'release_note',
  },
  // ── FAQ at MEDIUM confidence (0.7–0.85 → band "medium": answer + cite) ──
  {
    content:
      'Can I edit a purchase request after submitting it? While a request is in approval it is locked. To ' +
      'change it, recall the request (if your role permits) or ask an approver to send it back; it then ' +
      'returns to draft so you can edit and resubmit.',
    source: 'po.vin help center · FAQ', conf: 0.72, category: 'faq',
  },
  // ── competitor positioning (marketing-class category → the re-rank should rank docs ABOVE this) ──
  {
    content:
      'Compared to legacy procurement suites and spreadsheet-based purchasing, PO.vin replaces email ' +
      'approvals and manual routing with a structured, auditable approval workflow — faster cycle times ' +
      'and a complete audit trail, without a rip-and-replace migration.',
    source: 'po.vin marketing · competitive brief', conf: 0.8, category: 'competitor_positioning',
  },
  // ── SOP that is STALE (verified > 180d ago → trust gate gates on staleness, honestly) ──
  {
    content:
      'Year-end purchasing cutoff procedure: submit all capital purchase requests by December 15 so ' +
      'approvals clear before the fiscal close; requests entered after the cutoff route to the next ' +
      'fiscal year and require finance sign-off.',
    source: 'po.vin SOP · year-end cutoff', conf: 0.9, category: 'sop', verified: '2025-01-01',
  },
  // ── docs that are NOT yet validated (validation_status 'pending' → trust gate gates on validation) ──
  {
    content:
      'Punchout catalog integration (cXML) lets buyers shop a vendor\'s hosted catalog and return the ' +
      'selected cart into PO.vin as a draft purchase request, preserving line items, pricing, and the ' +
      'vendor contract reference.',
    source: 'po.vin docs · punchout-integration (draft)', conf: 0.9, validation: 'pending',
  },
  // ── docs on approval routing (pairs with the competitor chunk above for the re-rank demonstration) ──
  {
    content:
      'PO.vin\'s approval routing engine evaluates each request against configured rules — amount ' +
      'thresholds, department, and vendor — and routes it through the correct Manager → Owner chain, ' +
      'recording every step in the audit trail.',
    source: 'po.vin docs · approval-routing.ts', conf: 0.86,
  },
  // ── FAQ at LOW confidence (0.6–0.7 → band "low": cautious) AND below a 0.7 persona floor (→ gated) ──
  {
    content:
      'Does PO.vin have a mobile app? Yes — approvers can review and approve purchase requests from the ' +
      'PO.vin mobile app, which sends push notifications for items awaiting their decision.',
    source: 'po.vin help center · mobile FAQ', conf: 0.64, category: 'faq',
  },
];
for (const c of CHUNKS) {
  const exists = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id = $1 AND content = $2', [kbId, c.content]);
  if (!exists.rowCount) {
    const [embedding] = await getEmbeddingProvider().embed([c.content]);
    const cat = c.category ?? 'docs';
    // Provenance (0011): every chunk gets a real source row + source_id + lifecycle_state at insert.
    const sourceId = await ensureSource(productId, { title: c.source, sourceType: inferSourceType(cat), owner: 'VIN Demo (internal)', lastVerified: c.verified ?? FRESH, versionId });
    await db().query(
      `INSERT INTO knowledge_chunks
         (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, source_id, lifecycle_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [kbId, versionId, cat, c.content, toVector(embedding), c.conf, c.source, c.verified ?? FRESH, c.validation ?? 'validated', sourceId, mapLifecycle(c.validation ?? 'validated')],
    );
    console.log(`  + seeded knowledge chunk (${c.source}) [${cat} · conf ${c.conf} · ${c.validation ?? 'validated'} · ${c.verified ?? FRESH}]`);
  } else {
    console.log(`  = knowledge chunk already present (${c.source})`);
  }
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

// THE product's core action — create/submit a purchase order. Without this node the navigator could
// only route to approval screens (so "make a new purchase request" wrongly landed on "Manager Queue").
const newPoExists = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id = $1 AND intent_label = $2', [graphId, 'new purchase request']);
if (!newPoExists.rowCount) {
  await db().query(
    `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels)
     VALUES ($1, 'new purchase request', NULL, $2, $3)`,
    [
      graphId,
      JSON.stringify([
        { how: 'stale-css', value: '#btn-new-po-v1' },
        { how: 'css', value: 'button:has-text("{label}")' },
        { how: 'text', value: 'text={label}' },
      ]),
      // The real po.vin button reads "New Purchase Request" (sidebar) / "New Request" (dashboard card).
      JSON.stringify({ default: 'New Purchase Request', employee: 'New Purchase Request', requester: 'New Purchase Request', manager: 'New Purchase Request', owner: 'New Purchase Request', admin: 'New Purchase Request' }),
    ],
  );
  console.log('  + seeded DemoGraph node "new purchase request"');
} else {
  console.log('  = DemoGraph node "new purchase request" already present');
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
  'how do I create a new purchase request',
  'how do I submit a purchase order',
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

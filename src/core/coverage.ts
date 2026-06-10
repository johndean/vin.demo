/**
 * Coverage scoring (P2.4). For each seeded expected intent of a product, does the
 * knowledge base return an ungated, trusted chunk? Reports % covered — a metric, NOT
 * a gate — so KB gaps are visible. Uses the SAME 4-gate check as the live loop
 * (retrieval.ts), and embeds every intent in ONE batch call.  Run: npm run coverage
 */
import { db } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { gateForVector } from './retrieval.js';
import { recordEvalRun } from './eval-record.js';

// Per-product: `coverage <product>` measures that product; otherwise PO_VIN_PRODUCT_ID. The result is
// recorded to eval_runs tagged with product_id (suite 'coverage') so the console shows per-PRODUCT status.
const argName = process.argv[2];
const productId = argName
  ? (await db().query<{ id: string }>('SELECT id FROM products WHERE lower(name)=lower($1) LIMIT 1', [argName])).rows[0]?.id
  : process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error(argName ? `product "${argName}" not found` : 'PO_VIN_PRODUCT_ID not set — run `npm run seed`.');
const { rows: prow } = await db().query<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId]);
const productName = prow[0]?.name ?? productId;

const { rows: intents } = await db().query<{ intent: string }>(
  'SELECT intent FROM expected_intents WHERE product_id = $1 ORDER BY intent',
  [productId],
);
if (!intents.length) {
  console.log('No expected intents seeded for this product — run `npm run seed`.');
  process.exit(0);
}

const vecs = await getEmbeddingProvider().embed(intents.map((i) => i.intent)); // one batched embed call

console.log(`\n══ Coverage — ${productName} (${intents.length} expected intents) ══════════`);
let covered = 0;
for (let i = 0; i < intents.length; i++) {
  const r = await gateForVector(vecs[i], productId);
  const ok = !r.gated;
  if (ok) covered++;
  console.log(`  ${ok ? '✅' : '⚠️ '} ${intents[i].intent}  (${ok ? `covered · dist ${r.top?.distance?.toFixed(3)}` : r.reason})`);
}
const pct = Math.round((covered / intents.length) * 100);
console.log('───────────────────────────────────────────────────');
console.log(`  Coverage: ${covered}/${intents.length} (${pct}%) — a metric, not a gate`);
console.log('═══════════════════════════════════════════════════\n');
// Record as a per-product eval run so the console shows evidence-backed per-PRODUCT coverage status.
await recordEvalRun('coverage', covered, intents.length, { pct, product: productName }, productId);
process.exit(0);

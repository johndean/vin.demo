/**
 * Coverage scoring (P2.4). For each seeded expected intent of a product, does the
 * knowledge base return an ungated, trusted chunk? Reports % covered — a metric, NOT
 * a gate — so KB gaps are visible. Uses the SAME 4-gate check as the live loop
 * (retrieval.ts), and embeds every intent in ONE batch call.  Run: npm run coverage
 */
import { db } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { gateForVector } from './retrieval.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');

const { rows: intents } = await db().query<{ intent: string }>(
  'SELECT intent FROM expected_intents WHERE product_id = $1 ORDER BY intent',
  [productId],
);
if (!intents.length) {
  console.log('No expected intents seeded for this product — run `npm run seed`.');
  process.exit(0);
}

const vecs = await getEmbeddingProvider().embed(intents.map((i) => i.intent)); // one batched embed call

console.log(`\n══ Coverage — PO.vin (${intents.length} expected intents) ══════════`);
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
process.exit(0);

/**
 * Product Lifecycle demo (Gap B, P3.2). On an ISOLATED throwaway product, shows that
 * knowledge written for v1 answers cleanly while v1 is active — then, after a version
 * BUMP (v1 → deprecated, v2 active), that same answer DEGRADES at the trust gate
 * ("superseded version — show the current version"). Fully reversible (resets at the
 * end), so it never touches the real demo products.  Run: npm run lifecycle
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { retrieveAndGate } from './retrieval.js';
import { bumpVersion, listVersions, setVersionStatus } from './lifecycle.js';

async function upsert(table: string, match: Record<string, unknown>, insert: Record<string, unknown>): Promise<string> {
  const whereSql = Object.keys(match).map((k, i) => `${k} = $${i + 1}`).join(' AND ');
  const found = await db().query<{ id: string }>(`SELECT id FROM ${table} WHERE ${whereSql} LIMIT 1`, Object.values(match));
  if (found.rows[0]) return found.rows[0].id;
  const cols = Object.keys(insert);
  const res = await db().query<{ id: string }>(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(insert));
  return res.rows[0].id;
}

const V1 = 'v1 · lifecycle demo';
const V2 = 'v2 · lifecycle demo';
const QUERY = 'how do I export reports';
const CONTENT = 'In the lifecycle-demo product (v1), reports are exported from the Reports tab using the Export button.';

// Isolated throwaway product.
const orgId = await upsert('organizations', { name: 'VIN Demo (internal)' }, { name: 'VIN Demo (internal)' });
const wsId = await upsert('workspaces', { org_id: orgId, name: 'default' }, { org_id: orgId, name: 'default' });
const productId = await upsert('products', { workspace_id: wsId, name: 'lifecycle-demo' }, { workspace_id: wsId, name: 'lifecycle-demo' });
const v1Id = await upsert('product_versions', { product_id: productId, version_label: V1 }, { product_id: productId, version_label: V1, status: 'active' });
const kbId = await upsert('knowledge_bases', { product_id: productId, name: 'lifecycle-demo docs' }, { product_id: productId, name: 'lifecycle-demo docs' });
const chunkExists = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2', [kbId, CONTENT]);
if (!chunkExists.rowCount) {
  const [emb] = await getEmbeddingProvider().embed([CONTENT]);
  await db().query(
    `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status)
     VALUES ($1,$2,'docs',$3,$4,0.9,'lifecycle-demo docs','2026-06-06','validated')`,
    [kbId, v1Id, CONTENT, toVector(emb)],
  );
}

// Clean slate: v1 active, remove any leftover bumped version.
await setVersionStatus(v1Id, 'active');
await db().query(`DELETE FROM product_versions WHERE product_id=$1 AND version_label=$2`, [productId, V2]);

console.log('\n══ Product Lifecycle (Gap B) — version-bump drift ══════════');
console.log(`versions: ${(await listVersions(productId)).map((v) => `${v.version_label}=${v.status}`).join(', ')}`);

const before = await retrieveAndGate(QUERY, productId);
console.log(`\n1) ask "${QUERY}" while v1 is active:`);
console.log(`   ${before.gated ? `GATED (${before.reason})` : `ANSWERED: "${before.top?.content.slice(0, 70)}…"`}  [version ${before.top?.product_version} · ${before.top?.product_version_status}]`);

await bumpVersion(productId, V2);
console.log(`\n2) BUMP to ${V2} → versions: ${(await listVersions(productId)).map((v) => `${v.version_label}=${v.status}`).join(', ')}`);

const after = await retrieveAndGate(QUERY, productId);
console.log(`\n3) ask the same question now that v1 is superseded:`);
console.log(`   ${after.gated ? `GATED (${after.reason})` : `ANSWERED: "${after.top?.content.slice(0, 70)}…"`}  [version ${after.top?.product_version} · ${after.top?.product_version_status}]`);

// Reset for re-runs.
await setVersionStatus(v1Id, 'active');
await db().query(`DELETE FROM product_versions WHERE product_id=$1 AND version_label=$2`, [productId, V2]);

const ok = !before.gated && after.gated && /superseded/.test(after.reason);
console.log('───────────────────────────────────────────────────');
console.log(`  ${ok ? '✅' : '❌'} lifecycle drift: v1 answers, then degrades after the bump`);
console.log('═══════════════════════════════════════════════════\n');
process.exit(ok ? 0 : 1);

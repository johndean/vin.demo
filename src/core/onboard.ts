/**
 * Self-service onboarding (P4.2 "Add" + P4.3 "Train") — provision a product from a
 * declarative MANIFEST, no code. Creates product + version + environment (carrying the
 * interaction `adapter_config`, config-as-data) + KB (embeds knowledge with trust
 * metadata; optional read-only recon of a public docs URL) + DemoGraph + expected intents.
 * The existing loop then demos it. Idempotent.   Run: npm run onboard <manifest.json>
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import type { ProductWebConfig } from './driver.js';

interface KnowledgeItem { category?: string; content: string; confidence?: number; source?: string; lastVerified?: string; validationStatus?: string }
interface DemoNodeManifest { intentLabel: string; screenRoute?: string | null; locatorStrategies: { how: string; value: string }[]; personaLabels: Record<string, string> }
export interface Manifest {
  name: string;
  version: string;
  environment?: { connectionTarget?: string; isProduction?: boolean; resetMechanism?: string };
  adapter?: ProductWebConfig;            // → environments.adapter_config (the interaction config)
  knowledge?: KnowledgeItem[];           // explicit, trust-tagged
  knowledgeRecon?: { url: string };      // optional: read-only ingest of a PUBLIC docs URL
  demoGraph?: DemoNodeManifest[];
  expectedIntents?: string[];
}

async function upsert(table: string, match: Record<string, unknown>, insert: Record<string, unknown>): Promise<string> {
  const whereSql = Object.keys(match).map((k, i) => `${k} = $${i + 1}`).join(' AND ');
  const found = await db().query<{ id: string }>(`SELECT id FROM ${table} WHERE ${whereSql} LIMIT 1`, Object.values(match));
  if (found.rows[0]) return found.rows[0].id;
  const cols = Object.keys(insert);
  const res = await db().query<{ id: string }>(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(insert));
  return res.rows[0].id;
}

export async function onboard(m: Manifest): Promise<string> {
  if (!m.name || !m.version) throw new Error('manifest needs at least { name, version }');

  const orgId = await upsert('organizations', { name: 'VIN Demo (internal)' }, { name: 'VIN Demo (internal)' });
  const wsId = await upsert('workspaces', { org_id: orgId, name: 'default' }, { org_id: orgId, name: 'default' });
  const productId = await upsert('products', { workspace_id: wsId, name: m.name }, { workspace_id: wsId, name: m.name });
  const versionId = await upsert('product_versions', { product_id: productId, version_label: m.version }, { product_id: productId, version_label: m.version, status: 'active' });

  // Environment carries the interaction adapter_config (config-as-data, P4.1).
  const envName = `${m.name} (onboarded)`;
  const envId = await upsert('environments', { product_id: productId, name: envName }, {
    product_id: productId, name: envName,
    connection_target: m.environment?.connectionTarget ?? m.adapter?.baseUrl ?? null,
    is_production: m.environment?.isProduction ?? true,
    reset_mechanism: m.environment?.resetMechanism ?? 'manual',
  });
  if (m.adapter) await db().query('UPDATE environments SET adapter_config = $2 WHERE id = $1', [envId, JSON.stringify(m.adapter)]);

  // Train.
  const kbId = await upsert('knowledge_bases', { product_id: productId, name: `${m.name} docs` }, { product_id: productId, name: `${m.name} docs` });
  const items: KnowledgeItem[] = [...(m.knowledge ?? [])];
  if (m.knowledgeRecon?.url) {
    try {
      const browser = await chromium.launch({ headless: true });
      const page = await (await browser.newContext()).newPage();
      await page.goto(m.knowledgeRecon.url, { waitUntil: 'networkidle', timeout: 30000 });
      const text = (await page.locator('body').innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 1200);
      await browser.close();
      if (text.length > 80) items.push({ content: text, source: `recon: ${m.knowledgeRecon.url}`, confidence: 0.5, validationStatus: 'unverified' });
    } catch (e: any) { console.error('  (recon ingest failed:', e?.message, ')'); }
  }
  const missing = [];
  for (const it of items) {
    const ex = await db().query('SELECT 1 FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2', [kbId, it.content]);
    if (!ex.rowCount) missing.push(it);
  }
  if (missing.length) {
    const embs = await getEmbeddingProvider().embed(missing.map((i) => i.content));
    for (let i = 0; i < missing.length; i++) {
      const it = missing[i];
      await db().query(
        `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [kbId, versionId, it.category ?? 'docs', it.content, toVector(embs[i]), it.confidence ?? 0.8, it.source ?? `${m.name} manifest`, it.lastVerified ?? '2026-06-06', it.validationStatus ?? 'validated'],
      );
    }
  }
  console.log(`  + ${missing.length} knowledge chunk(s) embedded (${items.length} total)`);

  if (m.demoGraph?.length) {
    const graphId = await upsert('demo_graphs', { product_id: productId, name: `${m.name} demo` }, { product_id: productId, name: `${m.name} demo` });
    for (const n of m.demoGraph) {
      const ex = await db().query('SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id=$1 AND intent_label=$2', [graphId, n.intentLabel]);
      if (ex.rowCount) continue;
      await db().query(
        `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels) VALUES ($1,$2,$3,$4,$5)`,
        [graphId, n.intentLabel, n.screenRoute ?? null, JSON.stringify(n.locatorStrategies), JSON.stringify(n.personaLabels)],
      );
    }
    console.log(`  + DemoGraph: ${m.demoGraph.length} node(s)`);
  }
  for (const intent of m.expectedIntents ?? []) await upsert('expected_intents', { product_id: productId, intent }, { product_id: productId, intent });

  return productId;
}

// CLI entry — only when run directly (not when imported by the wizard / eval:phase4).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: npm run onboard <manifest.json>');
  const manifest: Manifest = JSON.parse(await readFile(path, 'utf8'));
  console.log(`\nOnboarding "${manifest.name}" from ${path} …`);
  const pid = await onboard(manifest);
  console.log(`\n✅ ${manifest.name} onboarded from manifest (no code). PRODUCT_ID=${pid}`);
  console.log(`   adapter_config: ${manifest.adapter ? 'set on environment (config-as-data)' : '(none — code-registry fallback)'}\n`);
  process.exit(0);
}

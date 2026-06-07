/**
 * Phase 4 eval — self-service onboarding (P4.5). Asserts a product onboarded purely from
 * a MANIFEST (no code) yields a working, trust-gated demo: product provisioned, adapter
 * config stored as DATA + resolvable by getAdapter, and trained knowledge retrieves
 * ungated + cited. Idempotent (re-onboards the same throwaway product). Run: npm run eval:phase4
 */
import { onboard, type Manifest } from './onboard.js';
import { db } from './db.js';
import { retrieveAndGate } from './retrieval.js';
import { getAdapter } from './driver.js';
import { recordEvalRun } from './eval-record.js';

const m: Manifest = {
  name: 'eval-phase4-product',
  version: 'v1',
  environment: { connectionTarget: 'https://example.test' },
  adapter: { baseUrl: 'https://example.test', credsEnvPrefix: 'EVAL4', loginPath: '/login', emailSelector: '#email', passwordSelector: '#pw', submitSelector: 'button[type="submit"]', loginSuccessUrlIncludes: '/home' },
  knowledge: [{ content: 'The eval-phase4 product lets a user export a quarterly report from the Reports tab using the Export button.', confidence: 0.85, source: 'eval4 manifest', lastVerified: '2026-06-07', validationStatus: 'validated' }],
  demoGraph: [{ intentLabel: 'reports', screenRoute: null, locatorStrategies: [{ how: 'css', value: 'a:has-text("{label}")' }], personaLabels: { default: 'Reports' } }],
  expectedIntents: ['how do I export a quarterly report'],
};

const pid = await onboard(m);
const checks: { name: string; pass: boolean; detail: string }[] = [];

const { rows: pr } = await db().query<{ id: string }>('SELECT id FROM products WHERE name = $1', [m.name]);
checks.push({ name: 'manifest provisioned the product (no code)', pass: !!pr[0], detail: pid });

const { rows: cfg } = await db().query<{ adapter_config: { baseUrl?: string } | null }>(
  'SELECT e.adapter_config FROM environments e JOIN products p ON p.id = e.product_id WHERE p.name = $1 AND e.adapter_config IS NOT NULL', [m.name]);
checks.push({ name: 'adapter config stored as DATA (config-not-code)', pass: !!cfg[0]?.adapter_config?.baseUrl, detail: cfg[0]?.adapter_config?.baseUrl ?? 'none' });

let adapterOk = false;
try { await getAdapter(m.name, 'read-only'); adapterOk = true; } catch { /* */ }
checks.push({ name: 'getAdapter resolves the DB config', pass: adapterOk, detail: adapterOk ? 'resolved' : 'failed' });

const r = await retrieveAndGate('how do I export a quarterly report', pid);
checks.push({ name: 'trained knowledge retrieves ungated + cited', pass: !r.gated && !!r.top?.source && r.top?.confidence != null && !!r.top?.product_version, detail: r.top ? `${r.top.source} · conf ${r.top.confidence} · ${r.top.product_version}` : 'gated/none' });

console.log('\n══ Phase 4 eval (self-service onboarding) ═════════');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase4', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

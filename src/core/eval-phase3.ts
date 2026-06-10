/**
 * Phase 3 eval — the ADAPTER CONTRACT across products + modalities (P3.5). Asserts the
 * SAME retrieve+gate serves every onboarded product with a cited, trust-tagged answer,
 * and that the safe-mode wizard walkthrough never commits. (Live per-product navigation
 * is verified during onboarding; lifecycle drift has its own gate, `npm run lifecycle`.)
 * Run: npm run eval:phase3
 */
import { db } from './db.js';
import { retrieveAndGate } from './retrieval.js';
import { getAdapter } from './driver.js';
import { recordEvalRun } from './eval-record.js';

const PRODUCTS = [
  { name: 'PO.vin', q: 'how does approval delegation work' },
  { name: 'expense.vin', q: 'how do I approve an expense report' },
  { name: 'rounds.vin', q: 'how does a session move through the production pipeline' },
  { name: 'ce.vin', q: 'what is in my needs-review queue' },
  { name: 'modelcontract.software', q: 'what does the model employment agreement wizard do' },
];

const checks: { name: string; pass: boolean; detail: string }[] = [];

// Fixtures from other evals (eval-phase4, lifecycle-demo) are NOT real onboarded products — exclude them
// so the count reflects the real adapter coverage, not vacuous fixtures. (Mirrors console-data.ts.)
const TEST_PRODUCTS = ['eval-phase4-product', 'lifecycle-demo'];
const { rows: prods } = await db().query<{ n: string }>('SELECT count(*)::text n FROM products WHERE name <> ALL($1::text[])', [TEST_PRODUCTS]);
checks.push({ name: 'contract spans ≥5 real products', pass: Number(prods[0].n) >= 5, detail: `${prods[0].n} real products (test fixtures excluded)` });

for (const p of PRODUCTS) {
  const { rows } = await db().query<{ id: string }>('SELECT id FROM products WHERE name = $1', [p.name]);
  const pid = rows[0]?.id;
  const r = pid ? await retrieveAndGate(p.q, pid) : null;
  const ok = !!r && !r.gated && !!r.top?.source && r.top?.confidence != null && !!r.top?.product_version;
  checks.push({ name: `${p.name}: cited answer via the shared contract`, pass: ok, detail: r?.top ? `${r.top.source} · conf ${r.top.confidence} · ${r.top.product_version}` : (pid ? 'gated/none' : 'not onboarded') });
}

// The 2nd modality's safety guarantee: the safe-mode wizard walkthrough never commits.
let wOk = false, wDetail = 'not run';
try {
  const driver = await getAdapter('modelcontract.software', 'safe');
  await driver.open('employer');
  const w = await driver.walkthrough?.(5);
  await driver.close();
  wOk = !!w && !w.committed && (w.steps?.length ?? 0) >= 1;
  wDetail = `${w?.steps.length ?? 0} steps, committed=${w?.committed}`;
} catch (e: any) { wDetail = `error: ${e?.message ?? e}`; }
checks.push({ name: 'safe-mode wizard walkthrough never commits', pass: wOk, detail: wDetail });

console.log('\n══ Phase 3 eval (adapter contract across products + modalities) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase3', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

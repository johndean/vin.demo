/**
 * Phase 2 eval — asserts the P2 hardening increments end-to-end, live, against PO.vin:
 *   P2.1 pause/continue governance · P2.2 discovery captured · P2.3 speaker switch +
 *   per-stakeholder open-item attribution · P2.4 coverage measures a real gap.
 * eval:phase1 remains the MVP gate; this is the harden/enrich gate. Exits non-zero on
 * any failure.  Run: npm run eval:phase2
 */
import { buildGraph } from './graph.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';
import { getDiscovery } from './discovery.js';
import { getStakeholders } from './stakeholders.js';
import { gateForVector } from './retrieval.js';
import { getEmbeddingProvider } from './embeddings.js';
import { recordEvalRun } from './eval-record.js';
import { db } from './db.js';
import type { ExecutionMode } from './safety.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');
const mode = (process.env.PO_VIN_MODE as ExecutionMode) ?? 'read-only';
const role = process.env.PO_VIN_ROLE ?? 'admin';

const session = await createDemoSession(productId, mode);
beginCostSession(session.id);
const graph = buildGraph();
const base = { productId, sessionId: session.id, role, mode };
const thread = { configurable: { thread_id: `eval2-${Date.now()}` } };
const inv = (speaker: string, utterance: string) => graph.invoke({ ...base, speaker, utterance }, thread);

// A short multi-stakeholder conversation that exercises every P2 increment.
const t1 = await inv('Procurement', 'How does approval delegation work?');
const t2 = await inv('CFO', 'Our approvals stall when I am traveling — show me the bypassed / delegated approvals.');
const t3 = await inv('CFO', "Hold on, let's pause for a moment.");      // P2.1 pause
const t4 = await inv('CFO', 'Okay, continue.');                          // P2.1 resume

const disc = await getDiscovery(session.id);
const people = await getStakeholders(session.id);
const cfo = people.find((p) => p.role === 'CFO');

// P2.4 coverage — same gate as the loop, batched embed.
const { rows: intents } = await db().query<{ intent: string }>('SELECT intent FROM expected_intents WHERE product_id = $1', [productId]);
const vecs = intents.length ? await getEmbeddingProvider().embed(intents.map((i) => i.intent)) : [];
let covered = 0;
for (let i = 0; i < intents.length; i++) if (!(await gateForVector(vecs[i], productId)).gated) covered++;

const cost = await sessionCost(session.id);
const signals = disc.painPoints.length + disc.buyingSignals.length + (disc.businessObjective ? 1 : 0);

const checks = [
  { name: 'P2.1 pause → status=paused', pass: t3.sessionStatus === 'paused', detail: `status=${t3.sessionStatus}` },
  { name: 'P2.1 continue → status=active', pass: t4.sessionStatus === 'active', detail: `status=${t4.sessionStatus}` },
  { name: 'P2.2 discovery captured to session_discovery', pass: signals > 0, detail: `pain=${disc.painPoints.length} signal=${disc.buyingSignals.length} obj=${disc.businessObjective ? 'y' : 'n'}` },
  { name: 'P2.3 speaker switch (Procurement → CFO)', pass: t1.activeStakeholder?.role === 'Procurement Manager' && t2.activeStakeholder?.role === 'CFO', detail: `${t1.activeStakeholder?.name ?? '?'} → ${t2.activeStakeholder?.name ?? '?'}` },
  { name: 'P2.3 open item attributed to the active CFO', pass: (cfo?.openItems.length ?? 0) > 0, detail: `CFO open items=${cfo?.openItems.length ?? 0}` },
  { name: 'P2.4 coverage measures a real gap (0<covered<total)', pass: intents.length > 0 && covered > 0 && covered < intents.length, detail: `${covered}/${intents.length}` },
  { name: 'Demo cost recorded', pass: cost.totalUsd > 0 && cost.totalTokens > 0, detail: `$${cost.totalUsd.toFixed(6)} / ${cost.totalTokens} tok` },
];

console.log('\n══ Phase 2 eval (harden + enrich) ═════════════════');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase2', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

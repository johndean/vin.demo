/**
 * Graph verification + drift detection (Phase C). Drives the ACTIVE demo graph for a product against the
 * REAL site using the SAME adapter/gotoNode the live loop uses (via the shared verifyNode). A node that
 * resolves → 'verified'; a node that does NOT resolve → 'broken'. A node that was previously 'verified' and
 * now fails is DRIFT (graph_events('drift')) — the spec's "screen removed / route changed / selector
 * changed → needs review". Then it rolls each workflow's status up from its nodes and recomputes the
 * graph's REAL coverage_score + last_navigation_test. Evidence-based; never invents. Read-only recon.
 *
 * Exported as runGraphVerify so the engine /graph endpoint can call it; CLI-runnable for the npm script.
 * Run: railway run npx tsx src/core/graph-verify.ts "<product>" [role]
 */
import 'dotenv/config';
import { db } from './db.js';
import { getAdapter, type DemoNode } from './driver.js';
import type { ExecutionMode } from './safety.js';
import { verifyNode, rollupWorkflowsForGraph, recomputeGraphScore, recordGraphEvent } from './graph-lifecycle.js';

export interface VerifySummary { product: string; graphId: string; nodes: number; verified: number; broken: number; drift: number; coverageScore: number; log: string[] }

export async function runGraphVerify(productName: string, role = 'admin'): Promise<VerifySummary> {
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(s); };

  const g = (await db().query<{ id: string; product_id: string; name: string }>(`
    SELECT g.id, g.product_id, g.name FROM demo_graphs g JOIN products p ON p.id=g.product_id
     WHERE lower(p.name)=lower($1) AND g.status='active' AND g.archived_at IS NULL ORDER BY g.graph_version DESC LIMIT 1`, [productName])).rows[0];
  if (!g) throw new Error(`no active graph for "${productName}"`);

  const nodes = (await db().query<{ id: string; intent_label: string; screen_route: string | null; locator_strategies: any; persona_labels: any; verification_status: string }>(`
    SELECT id, intent_label, screen_route, locator_strategies, persona_labels, verification_status
      FROM demo_graph_nodes WHERE demo_graph_id=$1`, [g.id])).rows;
  say(`\n══ Graph verify: ${g.name} — ${nodes.length} node(s) ══`);

  let verified = 0, broken = 0, drift = 0;
  const adapter = await getAdapter(productName, 'read-only' as ExecutionMode);
  try {
    await adapter.open(role);
    for (const n of nodes) {
      const node: DemoNode = { intent_label: n.intent_label, screen_route: n.screen_route, locator_strategies: Array.isArray(n.locator_strategies) ? n.locator_strategies : [], persona_labels: n.persona_labels ?? {} };
      const r = await verifyNode(adapter, node, role);
      const status = r.ok ? 'verified' : 'broken';
      const isDrift = !r.ok && n.verification_status === 'verified'; // was verified, now fails = drift
      await db().query(`UPDATE demo_graph_nodes SET verification_status=$2, last_verified=now() WHERE id=$1`, [n.id, status]);
      await recordGraphEvent(isDrift ? 'drift' : 'verify', { graphId: g.id, nodeId: n.id, productId: g.product_id, actor: 'graph-verify',
        before: { verification_status: n.verification_status }, after: { verification_status: status, url: r.url } });
      if (r.ok) verified++; else { broken++; if (isDrift) drift++; }
      say(`  ${r.ok ? '✅' : '❌'} ${n.intent_label}${isDrift ? '  ⚠️ DRIFT (was verified)' : ''}`);
    }
  } finally {
    await adapter.close().catch(() => {});
  }

  await rollupWorkflowsForGraph(g.id, 'graph-verify');
  const coverageScore = await recomputeGraphScore(g.id);
  say('───────────────────────────────────────────────────');
  say(`  ${verified} verified · ${broken} broken (${drift} drift) · coverage_score=${coverageScore}`);
  return { product: productName, graphId: g.id, nodes: nodes.length, verified, broken, drift, coverageScore, log };
}

// ── CLI (npm run graph:verify -- <product> [role]) ──
if (process.argv[1] && process.argv[1].includes('graph-verify')) {
  const productName = process.argv[2];
  const role = process.argv[3] ?? 'admin';
  if (!productName) { console.error('usage: graph-verify.ts <product> [role]'); process.exit(1); }
  runGraphVerify(productName, role)
    .then(() => process.exit(0))
    .catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}

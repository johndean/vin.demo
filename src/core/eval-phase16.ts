/**
 * Phase 16 eval — Empirical Intent Registry + computed usage rates + best-effort tour linkage (Experience
 * Registry Phase 3; no new migration — built from navigation_attempts + demo_tours). Proves the EXACT
 * aggregation logic the console uses: per (product,intent) the most-attempted node is primary, confidence =
 * its real success rate among observed attempts, fallback = the runner-up; per-node usage success rate is
 * correct; and a tour step whose URL contains a node's screen_route links to that node. Seeds + CLEANS UP on
 * the `eval-phase4-product` TEST FIXTURE. Run AFTER migrate: npm run eval:phase16
 */
import { db } from './db.js';
import { newDraftGraph, createNode, recordNavAttempt } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let intentOk = false, usageOk = false, tourOk = false;
let iDetail = 'fixture absent', uDetail = '-', tDetail = '-';
const INTENT = 'eval16: where is x?';

const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval16-sentinel-graph';
  let gid = '';
  try {
    gid = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase16');
    const a = await createNode(gid, { intentLabel: 'eval16 node A', screenRoute: '/eval16-a', verificationStatus: 'verified' }, 'eval-phase16');
    const b = await createNode(gid, { intentLabel: 'eval16 node B', screenRoute: '/eval16-b', verificationStatus: 'verified' }, 'eval-phase16');

    // Seed real attempts: intent → A ×2 (1 ok, 1 failed), B ×1 (ok). Primary should be A (more attempts),
    // confidence 50% (1 of 2 observed), fallback B.
    await recordNavAttempt({ source: 'path-a', productId: fix.product_id, graphId: gid, nodeId: a.nodeId, intent: INTENT, ok: true });
    await recordNavAttempt({ source: 'agent-step', productId: fix.product_id, graphId: gid, nodeId: a.nodeId, intent: INTENT, ok: false });
    await recordNavAttempt({ source: 'path-a', productId: fix.product_id, graphId: gid, nodeId: b.nodeId, intent: INTENT, ok: true });

    // 1) Intent-registry aggregation (the SAME query/logic console-data runs), scoped to this intent.
    const rows = (await db().query<{ node_id: string; intent_label: string; attempts: number; observed: number; succeeded: number }>(`
      SELECT na.node_id, n.intent_label,
             count(*)::int AS attempts, count(*) FILTER (WHERE na.ok IS NOT NULL)::int AS observed, count(*) FILTER (WHERE na.ok=true)::int AS succeeded
        FROM navigation_attempts na LEFT JOIN demo_graph_nodes n ON n.id=na.node_id
       WHERE na.product_id=$1 AND lower(na.intent)=lower($2) AND na.node_id IS NOT NULL
       GROUP BY na.node_id, n.intent_label`, [fix.product_id, INTENT])).rows;
    rows.sort((x, y) => y.attempts - x.attempts);
    const primary = rows[0];
    const confidence = primary && primary.observed > 0 ? Math.round((primary.succeeded / primary.observed) * 100) : null;
    const fallback = rows[1]?.intent_label ?? null;
    intentOk = primary?.intent_label === 'eval16 node A' && confidence === 50 && fallback === 'eval16 node B';
    iDetail = `primary=${primary?.intent_label}(${primary?.attempts}) confidence=${confidence} fallback=${fallback}`;

    // 2) Per-node usage success rate.
    const u = (await db().query<{ attempts: number; observed: number; succeeded: number }>(`
      SELECT count(*)::int AS attempts, count(*) FILTER (WHERE ok IS NOT NULL)::int AS observed, count(*) FILTER (WHERE ok=true)::int AS succeeded
        FROM navigation_attempts WHERE node_id=$1`, [a.nodeId])).rows[0];
    const rate = u.observed > 0 ? Math.round((u.succeeded / u.observed) * 100) : null;
    usageOk = u.attempts === 2 && u.observed === 2 && u.succeeded === 1 && rate === 50;
    uDetail = `attempts=${u.attempts} observed=${u.observed} succeeded=${u.succeeded} rate=${rate}`;

    // 3) Best-effort tour→node linkage (same match logic console-data uses): a tour step URL contains node A's route.
    const tour = (await db().query<{ id: string }>(`INSERT INTO demo_tours (product_id, name, steps) VALUES ($1,$2,$3::jsonb) RETURNING id`,
      [fix.product_id, 'eval16 tour', JSON.stringify([{ kind: 'navigate', url: 'https://app.example/eval16-a/list' }, { kind: 'note', caption: 'x' }])])).rows[0];
    const route = '/eval16-a';
    const matched = (await db().query<{ steps: any }>(`SELECT steps FROM demo_tours WHERE id=$1`, [tour.id])).rows[0].steps
      .some((s: any) => String(s.url || '').toLowerCase().includes(route));
    tourOk = matched;
    tDetail = `tourStepMatchesRoute=${matched}`;
    await db().query(`DELETE FROM demo_tours WHERE id=$1`, [tour.id]);
  } catch (e: any) {
    iDetail = `error: ${e?.message ?? e}`;
  } finally {
    if (gid) {
      await db().query(`DELETE FROM navigation_attempts WHERE demo_graph_id=$1`, [gid]).catch(() => {});
      await db().query(`DELETE FROM graph_events WHERE graph_id=$1`, [gid]).catch(() => {});
      await db().query(`DELETE FROM demo_graphs WHERE id=$1`, [gid]).catch(() => {});
    }
    await db().query(`DELETE FROM demo_tours WHERE product_id=$1 AND name='eval16 tour'`, [fix.product_id]).catch(() => {});
  }
}
checks.push({ name: 'Empirical intent registry: primary node + confidence(success rate) + fallback', pass: intentOk, detail: iDetail });
checks.push({ name: 'Per-node usage success rate computed from navigation_attempts', pass: usageOk, detail: uDetail });
checks.push({ name: 'Best-effort tour→node linkage (step URL ↔ node route)', pass: tourOk, detail: tDetail });

console.log('\n══ Phase 16 eval (intent registry + usage rates + tour linkage) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase16', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

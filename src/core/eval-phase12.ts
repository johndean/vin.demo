/**
 * Phase 12 eval — workflow-aware navigation selection (Phase D). Deterministic (no live site — the live
 * drive is the manual keystone run + the existing loop evals): proves the loop's selection truth via the
 * shared selectFromGraph helper that driveTo uses — (1) a stakeholder whose role matches a verified
 * workflow gets that workflow's nodes; (2) a non-matching role falls back to all verified nodes; (3) a
 * BROKEN node is NEVER a navigation candidate (the AI degrades honestly instead of driving it). Runs on the
 * eval-phase4-product TEST FIXTURE; cleans up. Run: npm run eval:phase12
 */
import { db } from './db.js';
import { selectFromGraph, newDraftGraph } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];

let cfoMatched = false, janFallback = false, brokenExcluded = false, detail = 'fixture absent';
if (fix) {
  const NAME = 'eval12-sentinel — autogen';
  try {
    const gid = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase12');
    // 3 nodes — two verified, one broken (drifted).
    await db().query(`INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, locator_strategies, persona_labels, verification_status) VALUES
       ($1,'cfo dashboard','[]'::jsonb,'{}'::jsonb,'verified'),
       ($1,'approvals','[]'::jsonb,'{}'::jsonb,'verified'),
       ($1,'broken screen','[]'::jsonb,'{}'::jsonb,'broken')`, [gid]);
    // A verified + APPROVED CFO/finance workflow over the two verified nodes. Editorial gate (0015): the
    // live loop selects only operator-APPROVED workflows, so the fixture must approve it to be selectable.
    await db().query(`INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, stakeholder_type, persona_type, node_sequence, verification_status, approved_at, approved_by) VALUES
       ($1,'CFO review','CFO','finance','["cfo dashboard","approvals"]'::jsonb,'verified', now(), 'eval-phase12')`, [gid]);

    const cfo = await selectFromGraph(gid, 'CFO');
    cfoMatched = cfo.workflow?.name === 'CFO review' && cfo.candidates.length === 2
      && cfo.candidates.every((c) => c.verification_status === 'verified')
      && !cfo.candidates.some((c) => c.intent_label === 'broken screen');

    const jan = await selectFromGraph(gid, 'janitor');
    janFallback = jan.workflow === null && jan.candidates.length === 2
      && !jan.candidates.some((c) => c.intent_label === 'broken screen');

    brokenExcluded = !cfo.allVerified.some((c) => c.intent_label === 'broken screen');
    detail = `cfoWf=${cfo.workflow?.name ?? 'none'}(${cfo.candidates.length}) · fallback=${jan.workflow === null}(${jan.candidates.length}) · brokenInVerified=${!brokenExcluded}`;

    await db().query(`DELETE FROM graph_events WHERE graph_id=$1`, [gid]);
    await db().query(`DELETE FROM demo_graphs WHERE id=$1`, [gid]); // cascade-deletes nodes + workflows
  } catch (e: any) {
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]).catch(() => {});
    detail = `error: ${e?.message ?? e}`;
  }
}
checks.push({ name: 'Matching stakeholder role selects its verified workflow (CFO → CFO review)', pass: cfoMatched, detail });
checks.push({ name: 'Non-matching role falls back to all verified screens', pass: janFallback, detail });
checks.push({ name: 'Broken nodes are never navigation candidates (verified-only)', pass: brokenExcluded, detail });

console.log('\n══ Phase 12 eval (workflow-aware navigation selection) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase12', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

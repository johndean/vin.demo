/**
 * Phase 9 eval — Demo Graph schema hardening + lifecycle + mutation audit (migration 0013).
 * Proves: the backfill is real (every graph has a status; every existing graph has a first-class workflow;
 * graphs are bound to an environment); the version lifecycle works end-to-end through the REAL functions
 * (newDraftGraph → publishGraph deprecates the prior active + activates the new version → archiveGraph
 * soft-archives); and recordGraphEvent round-trips before/after. The version-lifecycle probe creates and
 * then CLEANS UP throwaway graphs on the `eval-phase4-product` TEST FIXTURE so real graphs are never
 * mutated. Run AFTER migrate: npm run eval:phase9
 */
import { db } from './db.js';
import { newDraftGraph, publishGraph, archiveGraph, recordGraphEvent } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

// 1) Backfill — every graph has a non-null status (column DEFAULT filled existing rows).
const nullStatus = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM demo_graphs WHERE status IS NULL`)).rows[0].n);
checks.push({ name: 'Every graph has a status (backfilled)', pass: nullStatus === 0, detail: `${nullStatus} graphs without status` });

// 2) Backfill — every active graph has ≥1 first-class workflow (so the console workflow count is truthful).
const noWf = Number((await db().query<{ n: string }>(`
  SELECT count(*)::text n FROM demo_graphs g
   WHERE g.status='active' AND g.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM demo_graph_workflows w WHERE w.demo_graph_id=g.id AND w.archived_at IS NULL)`)).rows[0].n);
checks.push({ name: 'Every active graph has a first-class workflow', pass: noWf === 0, detail: `${noWf} active graphs with 0 workflows` });

// 3) Backfill — existing graphs are bound to an environment (env-scoping seam is real).
const boundEnv = Number((await db().query<{ n: string }>(`
  SELECT count(*)::text n FROM demo_graphs g WHERE g.environment_id IS NOT NULL`)).rows[0].n);
checks.push({ name: 'Graphs are environment-scoped (backfilled environment_id)', pass: boundEnv >= 1, detail: `${boundEnv} graphs bound to an environment` });

// 4) recordGraphEvent round-trips before/after jsonb (then clean up the probe event).
await recordGraphEvent('verify', { graphId: null, actor: 'eval-phase9', before: { x: 1 }, after: { x: 2, note: 'roundtrip' } });
const rt = (await db().query<{ before: any; after: any }>(`SELECT before, after FROM graph_events WHERE actor='eval-phase9' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
checks.push({ name: 'recordGraphEvent round-trips before/after', pass: rt?.before?.x === 1 && rt?.after?.x === 2, detail: JSON.stringify(rt?.after ?? null) });

// 5) Version lifecycle on the eval-phase4-product TEST FIXTURE: draft→publish (v1 active) → draft→publish
// (v2 active, v1 deprecated) → archive (v2). Asserts the deprecate-prior + soft-archive semantics + audit.
let lifecycleOk = false, lifeDetail = 'fixture absent';
const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval9-sentinel-graph';
  try {
    const g1 = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase9');
    await publishGraph(g1, 'eval-phase9');
    const a1 = (await db().query<{ status: string; v: number }>(`SELECT status, graph_version v FROM demo_graphs WHERE id=$1`, [g1])).rows[0];
    const g2 = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase9');
    await publishGraph(g2, 'eval-phase9');
    const a2 = (await db().query<{ status: string; v: number }>(`SELECT status, graph_version v FROM demo_graphs WHERE id=$1`, [g2])).rows[0];
    const d1 = (await db().query<{ status: string }>(`SELECT status FROM demo_graphs WHERE id=$1`, [g1])).rows[0];
    await archiveGraph(g2, 'eval-phase9');
    const arch = (await db().query<{ status: string; aa: string | null }>(`SELECT status, archived_at::text aa FROM demo_graphs WHERE id=$1`, [g2])).rows[0];
    const acts = (await db().query<{ action: string }>(`SELECT action FROM graph_events WHERE graph_id IN ($1,$2) ORDER BY occurred_at`, [g1, g2])).rows.map((r) => r.action);
    lifecycleOk = a1?.status === 'active' && a1?.v === 1 && a2?.status === 'active' && a2?.v === 2
      && d1?.status === 'deprecated' && arch?.status === 'archived' && !!arch?.aa
      && ['create', 'publish', 'archive'].every((x) => acts.includes(x));
    lifeDetail = `v1=${a1?.status}/v${a1?.v} v2=${a2?.status}/v${a2?.v} priorAfterPublish=${d1?.status} archived=${arch?.status} events=[${acts.join(',')}]`;
    await db().query(`DELETE FROM graph_events WHERE graph_id IN ($1,$2)`, [g1, g2]);
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]);
  } catch (e: any) {
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]).catch(() => {});
    lifeDetail = `error: ${e?.message ?? e}`;
  }
}
checks.push({ name: 'Graph version lifecycle (draft→publish→deprecate-prior→archive + audit)', pass: lifecycleOk, detail: lifeDetail });

await db().query(`DELETE FROM graph_events WHERE actor='eval-phase9'`);

console.log('\n══ Phase 9 eval (demo graph schema + lifecycle + mutation audit) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase9', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

/**
 * Phase 14 eval — Demo Graph → Experience Registry, Phase 1 (provenance + ownership + node CRUD/override +
 * dependency reverse-query). Proves: migration 0018 columns exist; manual node CRUD through the REAL audited
 * functions stamps authorship + verification_source + writes graph_events; archive soft-removes a node from
 * navigation (selectFromGraph) without deleting it; and the "who consumes me" reverse-query (node_sequence
 * containment — the dependency registry) is correct. All probes run on the `eval-phase4-product` TEST FIXTURE
 * and CLEAN UP after themselves, so real graphs are never mutated. Run AFTER migrate: npm run eval:phase14
 */
import { db } from './db.js';
import { newDraftGraph, createNode, updateNode, archiveNode, selectFromGraph, createWorkflow } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
const hasCols = async (table: string, cols: string[]): Promise<string[]> => {
  const rows = (await db().query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table])).rows.map((r) => r.column_name);
  return cols.filter((c) => !rows.includes(c));
};

// 1) Migration 0018 — node provenance + ownership + soft-archive columns present.
const missNode = await hasCols('demo_graph_nodes', ['business_purpose', 'business_outcome', 'derived_evidence', 'source_chunk_id', 'verification_source', 'created_by', 'created_at', 'updated_by', 'updated_at', 'archived_at', 'archived_by']);
checks.push({ name: 'demo_graph_nodes has provenance/ownership/archive columns (0018)', pass: missNode.length === 0, detail: missNode.length ? `missing: ${missNode.join(', ')}` : 'all present' });

// 2) Migration 0018 — workflow ownership/version columns present.
const missWf = await hasCols('demo_graph_workflows', ['version', 'created_by', 'updated_by', 'updated_at']);
checks.push({ name: 'demo_graph_workflows has version + ownership columns (0018)', pass: missWf.length === 0, detail: missWf.length ? `missing: ${missWf.join(', ')}` : 'all present' });

// 3–6) Node CRUD / override / archive / consumer reverse-query on the TEST FIXTURE.
let createOk = false, editOk = false, archiveOk = false, consumerOk = false;
let cDetail = 'fixture absent', eDetail = '-', aDetail = '-', conDetail = '-';
const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval14-sentinel-graph';
  try {
    const gid = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase14');

    // CREATE (manual, verified-by-hand → verification_source='manual', created_by stamped + audit 'create').
    const { nodeId } = await createNode(gid, { intentLabel: 'eval14 screen', screenRoute: '/eval14', screenName: 'Eval 14', screenType: 'list', verificationStatus: 'verified' }, 'eval-phase14');
    const c = (await db().query<{ created_by: string; vs: string; status: string }>(
      `SELECT created_by, verification_source vs, verification_status status FROM demo_graph_nodes WHERE id=$1`, [nodeId])).rows[0];
    const createEv = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM graph_events WHERE node_id=$1 AND action='create'`, [nodeId])).rows[0].n);
    createOk = c?.created_by === 'eval-phase14' && c?.vs === 'manual' && c?.status === 'verified' && createEv === 1;
    cDetail = `created_by=${c?.created_by} source=${c?.vs} status=${c?.status} createEvents=${createEv}`;

    // Reverse consumer query (dependency registry): a workflow whose node_sequence contains the node label.
    await createWorkflow(gid, { name: 'eval14 journey', nodeSequence: ['eval14 screen'] }, true, 'eval-phase14');
    const con = (await db().query<{ n: string }>(`
      SELECT count(*)::text n FROM demo_graph_workflows w WHERE w.demo_graph_id=$1 AND w.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(w.node_sequence) e WHERE lower(e)=lower($2))`, [gid, 'eval14 screen'])).rows[0];
    consumerOk = Number(con.n) === 1;
    conDetail = `consumers found=${con.n}`;

    // EDIT (manual override): change route + label; updated_by stamped + audit 'edit'.
    await updateNode(nodeId, { intentLabel: 'eval14 screen', screenRoute: '/eval14-edited' }, 'eval-phase14b');
    const e = (await db().query<{ route: string; updated_by: string }>(`SELECT screen_route route, updated_by FROM demo_graph_nodes WHERE id=$1`, [nodeId])).rows[0];
    const editEv = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM graph_events WHERE node_id=$1 AND action='edit'`, [nodeId])).rows[0].n);
    editOk = e?.route === '/eval14-edited' && e?.updated_by === 'eval-phase14b' && editEv === 1;
    eDetail = `route=${e?.route} updated_by=${e?.updated_by} editEvents=${editEv}`;

    // selectFromGraph returns the verified node BEFORE archive…
    const before = (await selectFromGraph(gid)).allVerified.some((n) => n.intent_label.toLowerCase() === 'eval14 screen');
    // ARCHIVE (soft) → archived_at set + node DROPS OUT of navigation (selectFromGraph) without deletion + audit.
    await archiveNode(nodeId, 'eval-phase14');
    const arch = (await db().query<{ aa: string | null }>(`SELECT archived_at::text aa FROM demo_graph_nodes WHERE id=$1`, [nodeId])).rows[0];
    const after = (await selectFromGraph(gid)).allVerified.some((n) => n.intent_label.toLowerCase() === 'eval14 screen');
    const archEv = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM graph_events WHERE node_id=$1 AND action='archive'`, [nodeId])).rows[0].n);
    archiveOk = before && !!arch?.aa && after === false && archEv === 1;
    aDetail = `inNavBefore=${before} archived=${!!arch?.aa} inNavAfter=${after} archiveEvents=${archEv}`;

    // Cleanup — remove the throwaway graph + its nodes/workflows/events (fixture left pristine).
    const nodeIds = (await db().query<{ id: string }>(`SELECT id FROM demo_graph_nodes WHERE demo_graph_id=$1`, [gid])).rows.map((r) => r.id);
    const wfIds = (await db().query<{ id: string }>(`SELECT id FROM demo_graph_workflows WHERE demo_graph_id=$1`, [gid])).rows.map((r) => r.id);
    await db().query(`DELETE FROM graph_events WHERE graph_id=$1 OR node_id = ANY($2::uuid[]) OR workflow_id = ANY($3::uuid[])`, [gid, nodeIds, wfIds]);
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]);
  } catch (err: any) {
    cDetail = `error: ${err?.message ?? err}`;
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]).catch(() => {});
  }
}
checks.push({ name: 'createNode stamps authorship + verification_source + audits', pass: createOk, detail: cDetail });
checks.push({ name: 'Dependency reverse-query finds the consuming workflow', pass: consumerOk, detail: conDetail });
checks.push({ name: 'updateNode (manual override) edits + stamps updated_by + audits', pass: editOk, detail: eDetail });
checks.push({ name: 'archiveNode soft-removes node from navigation (no delete) + audits', pass: archiveOk, detail: aDetail });

console.log('\n══ Phase 14 eval (Experience Registry — provenance/ownership/node-CRUD/dependency) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase14', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

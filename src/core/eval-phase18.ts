/**
 * Phase 18 eval — Business Outcome Registry + Stakeholder Registry (V5 Guided Experience Platform, Phase 1;
 * migration 0020). Proves the REAL functions on the `eval-phase4-product` TEST FIXTURE, then CLEANS UP every
 * sentinel row it created:
 *   • createOutcome persists + recordOutcomeEvent round-trips (outcome_events 'create'); updateOutcome bumps
 *     version + audits; archiveOutcome soft-removes (gone from getOutcomes).
 *   • setWorkflowOutcome links a workflow→outcome (FK stored + readable) — the free-text→governed seam.
 *   • createProductStakeholder persists the NEW registry fields (decision_criteria/goals/objections/questions).
 *   • addStakeholderRelationship inserts an influence edge; archive removes it from the active read.
 * Run AFTER migrate: npm run eval:phase18
 */
import { db } from './db.js';
import { createOutcome, updateOutcome, archiveOutcome, getOutcomes, setWorkflowOutcome } from './outcomes.js';
import { createProductStakeholder, getStakeholderRegistry, addStakeholderRelationship, getStakeholderRelationships, archiveStakeholderRelationship } from './stakeholders.js';
import { newDraftGraph, createWorkflow } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let outcomeOk = false, linkOk = false, stakeOk = false, relOk = false;
let oDetail = 'fixture absent', lDetail = '-', sDetail = '-', rDetail = '-';

const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];

if (fix) {
  const SENTINEL = 'eval18-sentinel';
  let outcomeId: string | null = null, graphId: string | null = null;
  let stakeholderId: string | null = null, otherStakeholderId: string | null = null, relId: string | null = null;
  try {
    // 1. Outcome: create + event round-trip + update(version bump) + archive(soft-remove from getOutcomes).
    const c = await createOutcome(fix.product_id, { title: `${SENTINEL} reduce approval delays`, metric: 'avg approval hours', status: 'active' }, 'eval-phase18');
    outcomeId = c.outcomeId;
    const ev = (await db().query<{ n: string }>(`SELECT count(*)::text n FROM outcome_events WHERE outcome_id=$1 AND action='create'`, [outcomeId])).rows[0];
    await updateOutcome(outcomeId, { target: '< 24h' }, 'eval-phase18');
    const after = (await db().query<{ version: number; target: string | null }>(`SELECT version, target FROM business_outcomes WHERE id=$1`, [outcomeId])).rows[0];
    const liveBefore = (await getOutcomes(fix.product_id)).some((o) => o.id === outcomeId);
    await archiveOutcome(outcomeId, 'eval-phase18');
    const liveAfter = (await getOutcomes(fix.product_id)).some((o) => o.id === outcomeId);
    outcomeOk = (+ev.n >= 1) && after.version === 2 && after.target === '< 24h' && liveBefore && !liveAfter;
    oDetail = `events=${ev.n} version=${after.version} target=${after.target} liveBefore=${liveBefore} liveAfter=${liveAfter}`;

    // 2. Workflow→outcome link (the seam): a draft graph + workflow + a fresh outcome to link to.
    const c2 = await createOutcome(fix.product_id, { title: `${SENTINEL} audit readiness` }, 'eval-phase18');
    graphId = await newDraftGraph(fix.product_id, `${SENTINEL}-graph`, fix.env, 'eval-phase18');
    const wf = await createWorkflow(graphId, { name: `${SENTINEL} wf`, nodeSequence: [] }, false, 'eval-phase18');
    await setWorkflowOutcome(wf.workflowId, c2.outcomeId, 'eval-phase18');
    const stored = (await db().query<{ business_outcome_id: string | null }>(`SELECT business_outcome_id FROM demo_graph_workflows WHERE id=$1`, [wf.workflowId])).rows[0];
    linkOk = stored?.business_outcome_id === c2.outcomeId;
    lDetail = `linkedOutcome==created=${linkOk}`;
    await archiveOutcome(c2.outcomeId, 'eval-phase18');

    // 3. Stakeholder registry persists the NEW fields (criteria/objections/decision authority).
    const s = await createProductStakeholder(fix.product_id, { name: `${SENTINEL} CFO`, role: 'CFO', influence: 'high', decisionAuthority: 'economic_buyer', decisionCriteria: ['ROI', 'compliance'], objections: ['too costly'] }, 'eval-phase18');
    stakeholderId = s.stakeholderId;
    const reg = (await getStakeholderRegistry(fix.product_id)).find((x) => x.id === stakeholderId);
    stakeOk = !!reg && reg.decisionCriteria.includes('ROI') && reg.objections.includes('too costly') && reg.decisionAuthority === 'economic_buyer';
    sDetail = `criteria=${reg?.decisionCriteria?.join('|')} objections=${reg?.objections?.join('|')} authority=${reg?.decisionAuthority}`;

    // 4. Influence edge insert + soft-archive removes it from the active read.
    const s2 = await createProductStakeholder(fix.product_id, { name: `${SENTINEL} Procurement`, role: 'Procurement' }, 'eval-phase18');
    otherStakeholderId = s2.stakeholderId;
    const rel = await addStakeholderRelationship(fix.product_id, otherStakeholderId, stakeholderId, 'reports_to', 'high', 'eval-phase18');
    relId = rel.relationshipId;
    const relsBefore = (await getStakeholderRelationships(fix.product_id)).some((x) => x.id === relId);
    await archiveStakeholderRelationship(relId, 'eval-phase18');
    const relsAfter = (await getStakeholderRelationships(fix.product_id)).some((x) => x.id === relId);
    relOk = relsBefore && !relsAfter;
    rDetail = `edgeBefore=${relsBefore} edgeAfter=${relsAfter}`;
  } catch (e: any) {
    oDetail = `error: ${e?.message ?? e}`;
  } finally {
    // CLEANUP — hard-delete every sentinel row (restore fixture cleanliness; mirrors phase17's finally).
    void [outcomeId, otherStakeholderId];
    if (stakeholderId) await db().query(`DELETE FROM stakeholder_relationships WHERE from_stakeholder_id=$1 OR to_stakeholder_id=$1`, [stakeholderId]).catch(() => {});
    await db().query(`DELETE FROM product_stakeholders WHERE product_id=$1 AND name LIKE $2`, [fix.product_id, `${SENTINEL}%`]).catch(() => {});
    if (graphId) {
      await db().query(`DELETE FROM demo_graph_workflows WHERE demo_graph_id=$1`, [graphId]).catch(() => {});
      await db().query(`DELETE FROM graph_events WHERE graph_id=$1`, [graphId]).catch(() => {});
      await db().query(`DELETE FROM demo_graphs WHERE id=$1`, [graphId]).catch(() => {});
    }
    await db().query(`DELETE FROM outcome_events WHERE product_id=$1 AND actor='eval-phase18'`, [fix.product_id]).catch(() => {});
    await db().query(`DELETE FROM business_outcomes WHERE product_id=$1 AND title LIKE $2`, [fix.product_id, `${SENTINEL}%`]).catch(() => {});
  }
}

checks.push({ name: 'createOutcome persists + event round-trips + update bumps version + archive soft-removes', pass: outcomeOk, detail: oDetail });
checks.push({ name: 'setWorkflowOutcome links workflow→outcome (free-text→governed seam)', pass: linkOk, detail: lDetail });
checks.push({ name: 'stakeholder registry persists decision_criteria/goals/objections/questions', pass: stakeOk, detail: sDetail });
checks.push({ name: 'stakeholder_relationships influence edge inserts + soft-archives', pass: relOk, detail: rDetail });

console.log('\n══ Phase 18 eval (Outcome Registry + Stakeholder Registry) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase18', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

/**
 * Phase 19 eval — Journey Layer (V5 Guided Experience Platform, Phase 2; migration 0021). Proves the REAL
 * functions on the `eval-phase4-product` TEST FIXTURE, then CLEANS UP every sentinel row:
 *   • createJourney persists + recordJourneyEvent round-trips; updateJourney bumps version; archiveJourney
 *     soft-removes (gone from getJourneys).
 *   • resolveStoryFlow REFERENCE INTEGRITY: a real workflow ref resolves ok=true with its name; a note step is
 *     ok=true; a dangling (bogus-uuid) ref is FLAGGED ok=false and KEPT (never dropped — resolved length == steps).
 *   • startJourneyRun → a 'running' row; completeJourneyRun → 'completed' + completed_at (the Phase 5 telemetry seam).
 * Run AFTER migrate: npm run eval:phase19
 */
import { db } from './db.js';
import { createJourney, updateJourney, archiveJourney, getJourneys, resolveStoryFlow, startJourneyRun, completeJourneyRun, type StoryStep } from './journeys.js';
import { newDraftGraph, createWorkflow } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let journeyOk = false, integrityOk = false, runOk = false;
let jDetail = 'fixture absent', iDetail = '-', rDetail = '-';

const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];

if (fix) {
  const SENTINEL = 'eval19-sentinel';
  const BOGUS = '00000000-0000-0000-0000-000000000000';
  let journeyId: string | null = null, graphId: string | null = null;
  try {
    // A real workflow to reference, so the story_flow composes a REAL asset (not a fabricated one).
    graphId = await newDraftGraph(fix.product_id, `${SENTINEL}-graph`, fix.env, 'eval-phase19');
    const wf = await createWorkflow(graphId, { name: `${SENTINEL} wf`, nodeSequence: [] }, false, 'eval-phase19');
    const story: StoryStep[] = [
      { kind: 'workflow', refId: wf.workflowId, caption: 'show approval delegation' },
      { kind: 'note', refId: null, caption: 'narrate the business value' },
      { kind: 'workflow', refId: BOGUS, caption: 'deliberately broken ref' },
    ];

    // 1. create + event round-trip + update(version bump) + archive(soft-remove).
    const c = await createJourney(fix.product_id, { name: `${SENTINEL} journey`, businessGoal: 'cut approval delays', storyFlow: story, status: 'draft' }, 'eval-phase19');
    journeyId = c.journeyId;
    const ev = (await db().query<{ n: string }>(`SELECT count(*)::text n FROM journey_events WHERE journey_id=$1 AND action='create'`, [journeyId])).rows[0];
    await updateJourney(journeyId, { successCriteria: 'CFO sees delegated approvals' }, 'eval-phase19');
    const ver = (await db().query<{ version: number }>(`SELECT version FROM journeys WHERE id=$1`, [journeyId])).rows[0]?.version;
    const liveBefore = (await getJourneys(fix.product_id)).some((j) => j.id === journeyId);

    // 2. reference integrity — real workflow ok + name, note ok, bogus ref FLAGGED (not dropped).
    const resolved = await resolveStoryFlow(fix.product_id, story);
    integrityOk = resolved.length === 3 && resolved[0].ok && resolved[0].label === `${SENTINEL} wf`
      && resolved[1].ok && resolved[1].kind === 'note' && resolved[2].ok === false;
    iDetail = `steps=${resolved.length} wf.ok=${resolved[0].ok}(${resolved[0].label}) note.ok=${resolved[1].ok} broken.ok=${resolved[2].ok}`;

    // 3. run telemetry — running → completed (+ completed_at).
    const run = await startJourneyRun(journeyId, null);
    const r1 = (await db().query<{ status: string }>(`SELECT status FROM journey_runs WHERE id=$1`, [run?.runId])).rows[0]?.status;
    if (run) await completeJourneyRun(run.runId, 'completed');
    const r2 = (await db().query<{ status: string; done: string | null }>(`SELECT status, completed_at::text done FROM journey_runs WHERE id=$1`, [run?.runId])).rows[0];
    runOk = !!run && r1 === 'running' && r2?.status === 'completed' && r2?.done != null;
    rDetail = `start=${r1} end=${r2?.status} completedAt=${r2?.done != null}`;

    await archiveJourney(journeyId, 'eval-phase19');
    const liveAfter = (await getJourneys(fix.product_id)).some((j) => j.id === journeyId);
    journeyOk = (+ev.n >= 1) && ver === 2 && liveBefore && !liveAfter;
    jDetail = `events=${ev.n} version=${ver} liveBefore=${liveBefore} liveAfter=${liveAfter}`;
  } catch (e: any) {
    jDetail = `error: ${e?.message ?? e}`;
  } finally {
    // CLEANUP — hard-delete every sentinel row (restore fixture cleanliness; mirrors phase17/18 finally).
    if (journeyId) {
      await db().query(`DELETE FROM journey_runs WHERE journey_id=$1`, [journeyId]).catch(() => {});
      await db().query(`DELETE FROM journey_events WHERE journey_id=$1`, [journeyId]).catch(() => {});
    }
    await db().query(`DELETE FROM journeys WHERE product_id=$1 AND name LIKE $2`, [fix.product_id, `${SENTINEL}%`]).catch(() => {});
    if (graphId) {
      await db().query(`DELETE FROM demo_graph_workflows WHERE demo_graph_id=$1`, [graphId]).catch(() => {});
      await db().query(`DELETE FROM graph_events WHERE graph_id=$1`, [graphId]).catch(() => {});
      await db().query(`DELETE FROM demo_graphs WHERE id=$1`, [graphId]).catch(() => {});
    }
  }
}

checks.push({ name: 'createJourney persists + event round-trips + update bumps version + archive soft-removes', pass: journeyOk, detail: jDetail });
checks.push({ name: 'resolveStoryFlow reference integrity (real ok + named · note ok · dangling FLAGGED not dropped)', pass: integrityOk, detail: iDetail });
checks.push({ name: 'startJourneyRun → completeJourneyRun telemetry round-trip', pass: runOk, detail: rDetail });

console.log('\n══ Phase 19 eval (Journey Layer — orchestration + reference integrity + run telemetry) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase19', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

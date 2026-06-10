/**
 * Phase 22 eval — Journey-aware evaluation framework (V5 Guided Experience Platform, Phase 5; NO new
 * migration). Proves each dimension computes from REAL seeded telemetry AND is HONEST when empty, then cleans
 * up every sentinel row:
 *   • journeySuccess — completion rate from journey_runs (2 seeded: 1 completed + 1 aborted → 50%); empty filter → null + "no run telemetry yet".
 *   • specialistAccuracy — grounding + citation rate from audit_turns (2 seeded: 1 grounded+cited, 1 bare → 50%).
 *   • outcomeSuccess — withTarget counts outcomes READY to measure; achievement honestly NOT auto-measured (measured=0).
 *   • decisionReadiness — committee-with-criteria structural signal; criteria-addressed honestly flagged as needing a not-yet-captured signal.
 * Run AFTER migrate (no new migration this phase): npm run eval:phase22
 */
import { db } from './db.js';
import { journeySuccess, specialistAccuracy, outcomeSuccess, decisionReadiness } from './experience-evals.js';
import { createOutcome } from './outcomes.js';
import { createProductStakeholder } from './stakeholders.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let jsOk = false, saOk = false, osOk = false, drOk = false;
let jsD = 'fixture absent', saD = '-', osD = '-', drD = '-';

const fix = (await db().query<{ product_id: string }>(`SELECT id AS product_id FROM products WHERE name='eval-phase4-product' LIMIT 1`)).rows[0];
const ws = (await db().query<{ id: string }>(`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`)).rows[0];

if (fix) {
  const S = 'eval22-sentinel';
  const J = '00000000-0000-0000-0000-0000000e2202'; // sentinel journey_id (denormalized — no FK on journey_runs)
  const BOGUS = '00000000-0000-0000-0000-000000000000';
  let personaId: string | null = null;
  try {
    // 1. journeySuccess — completion rate from seeded runs + honest null when empty.
    await db().query(`INSERT INTO journey_runs (journey_id, product_id, status, completed_at) VALUES ($1,$2,'completed',now())`, [J, fix.product_id]);
    await db().query(`INSERT INTO journey_runs (journey_id, product_id, status) VALUES ($1,$2,'aborted')`, [J, fix.product_id]);
    const js = await journeySuccess({ journeyId: J });
    const empty = await journeySuccess({ journeyId: BOGUS });
    jsOk = js.runs === 2 && js.completed === 1 && js.aborted === 1 && js.completionRate === 50 && empty.completionRate === null && empty.note.includes('no run telemetry yet');
    jsD = `runs=${js.runs} rate=${js.completionRate} empty.rate=${empty.completionRate}`;

    // 2. specialistAccuracy — grounding/citation rate from seeded audit_turns.
    if (ws) {
      personaId = (await db().query<{ id: string }>(`INSERT INTO personas (workspace_id, name, definition, status) VALUES ($1,'${S}-specialist','{}'::jsonb,'approved') RETURNING id`, [ws.id])).rows[0].id;
      await db().query(`INSERT INTO audit_turns (demo_session_id, persona_id, knowledge_used, citations) VALUES (NULL,$1,'[{"source":"x"}]'::jsonb,'[{"source":"x"}]'::jsonb)`, [personaId]);
      await db().query(`INSERT INTO audit_turns (demo_session_id, persona_id, knowledge_used, citations) VALUES (NULL,$1,'[]'::jsonb,'[]'::jsonb)`, [personaId]);
      const sa = await specialistAccuracy(personaId);
      saOk = sa.turns === 2 && sa.grounded === 1 && sa.cited === 1 && sa.groundingRate === 50 && sa.citationRate === 50;
      saD = `turns=${sa.turns} grounding=${sa.groundingRate}% citation=${sa.citationRate}%`;
    } else { saD = 'no workspace'; }

    // 3. outcomeSuccess — withTarget = ready-to-measure; achievement honestly NOT auto-measured.
    await createOutcome(fix.product_id, { title: `${S} reduce delays`, target: '< 24h' }, 'eval-phase22');
    const os = await outcomeSuccess(fix.product_id);
    osOk = os.withTarget >= 1 && os.measured === 0 && os.note.includes('not auto-measured');
    osD = `outcomes=${os.outcomes} withTarget=${os.withTarget} measured=${os.measured}`;

    // 4. decisionReadiness — committee-with-criteria structural signal + honest "needs per-turn signal".
    await createProductStakeholder(fix.product_id, { name: `${S} CFO`, role: 'CFO', decisionCriteria: ['ROI', 'security'] }, 'eval-phase22');
    const dr = await decisionReadiness(fix.product_id);
    drOk = dr.committee >= 1 && dr.withCriteria >= 1 && dr.note.includes('per-turn topic signal not yet captured');
    drD = `committee=${dr.committee} withCriteria=${dr.withCriteria} journeysForCommittee=${dr.journeysForCommittee}`;
  } catch (e: any) { jsD = `error: ${e?.message ?? e}`; }
  finally {
    await db().query(`DELETE FROM journey_runs WHERE journey_id=$1`, [J]).catch(() => {});
    if (personaId) {
      await db().query(`DELETE FROM audit_turns WHERE persona_id=$1`, [personaId]).catch(() => {});
      await db().query(`DELETE FROM personas WHERE id=$1`, [personaId]).catch(() => {});
    }
    await db().query(`DELETE FROM outcome_events WHERE product_id=$1 AND actor='eval-phase22'`, [fix.product_id]).catch(() => {});
    await db().query(`DELETE FROM business_outcomes WHERE product_id=$1 AND title LIKE $2`, [fix.product_id, `${S}%`]).catch(() => {});
    await db().query(`DELETE FROM product_stakeholders WHERE product_id=$1 AND name LIKE $2`, [fix.product_id, `${S}%`]).catch(() => {});
  }
}

checks.push({ name: 'journeySuccess: completion rate from journey_runs + honest null when no runs', pass: jsOk, detail: jsD });
checks.push({ name: 'specialistAccuracy: grounding + citation rate from audit_turns (objective proxy)', pass: saOk, detail: saD });
checks.push({ name: 'outcomeSuccess: ready-to-measure counted; achievement honestly NOT auto-measured', pass: osOk, detail: osD });
checks.push({ name: 'decisionReadiness: committee-criteria structural signal + honest "needs per-turn signal"', pass: drOk, detail: drD });

console.log('\n══ Phase 22 eval (journey-aware evaluation framework — real + honest) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase22', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

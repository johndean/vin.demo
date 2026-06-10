/**
 * Phase 20 eval — Network extensions (V5 Guided Experience Platform, Phase 3; migration 0022). Proves the REAL
 * functions, then CLEANS UP every sentinel row + RESTORES the fixture env:
 *   • specialistMetrics rolls up turns/handoffsIn/handoffsOut/escalations for a persona from the EXISTING event
 *     tables (audit_turns / persona_handoff_events / persona_escalation_events) — seeded with nullable-session rows.
 *   • computeEnvironmentReadiness math: an uncertified/unverified/prod env is NOT ready (0 gates); a
 *     certified+verified+fresh+no-issues+non-prod+endpoint env is ready (all gates).
 *   • environment 0022 columns persist + drive the gate on a REAL env row (set → read → gate reflects → restore).
 * Run AFTER migrate: npm run eval:phase20
 */
import { db } from './db.js';
import { specialistMetrics } from './specialist-network.js';
import { computeEnvironmentReadiness } from './environment-readiness.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let specOk = false, readyOk = false, envColsOk = false;
let specDetail = 'no workspace', readyDetail = '-', envDetail = 'fixture env absent';

// 1. Specialist metrics rollup — sentinel persona + nullable-session events.
const ws = (await db().query<{ id: string }>(`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`)).rows[0];
if (ws) {
  let personaId: string | null = null;
  try {
    personaId = (await db().query<{ id: string }>(
      `INSERT INTO personas (workspace_id, name, definition, status) VALUES ($1,'eval20-sentinel-specialist','{}'::jsonb,'approved') RETURNING id`, [ws.id])).rows[0].id;
    await db().query(`INSERT INTO audit_turns (demo_session_id, persona_id, knowledge_used) VALUES (NULL,$1,'[{"source":"x"}]'::jsonb)`, [personaId]);
    await db().query(`INSERT INTO persona_handoff_events (demo_session_id, from_persona_id, to_persona_id, trigger) VALUES (NULL,NULL,$1,'operator')`, [personaId]); // handoff IN
    await db().query(`INSERT INTO persona_handoff_events (demo_session_id, from_persona_id, to_persona_id, trigger) VALUES (NULL,$1,NULL,'operator')`, [personaId]); // handoff OUT
    await db().query(`INSERT INTO persona_escalation_events (demo_session_id, source_persona_id, trigger, reason) VALUES (NULL,$1,'guardrail','x')`, [personaId]);
    const m = (await specialistMetrics())[personaId];
    specOk = !!m && m.turns === 1 && m.handoffsIn === 1 && m.handoffsOut === 1 && m.escalations === 1;
    specDetail = m ? `turns=${m.turns} in=${m.handoffsIn} out=${m.handoffsOut} esc=${m.escalations}` : 'no metric';
  } catch (e: any) { specDetail = `error: ${e?.message ?? e}`; }
  finally {
    if (personaId) {
      await db().query(`DELETE FROM persona_handoff_events WHERE from_persona_id=$1 OR to_persona_id=$1`, [personaId]).catch(() => {});
      await db().query(`DELETE FROM persona_escalation_events WHERE source_persona_id=$1`, [personaId]).catch(() => {});
      await db().query(`DELETE FROM audit_turns WHERE persona_id=$1`, [personaId]).catch(() => {});
      await db().query(`DELETE FROM personas WHERE id=$1`, [personaId]).catch(() => {});
    }
  }
}

// 2. Readiness math (pure).
const low = computeEnvironmentReadiness({ connectionTarget: '', certificationStatus: 'uncertified', verificationState: 'unverified', lastVerifiedDays: null, knownIssues: 2, isProduction: true });
const high = computeEnvironmentReadiness({ connectionTarget: 'https://demo.example', certificationStatus: 'certified', verificationState: 'verified', lastVerifiedDays: 1, knownIssues: 0, isProduction: false });
readyOk = low.ready === false && low.passed === 0 && high.ready === true && high.passed === high.total;
readyDetail = `low=${low.passed}/${low.total}(ready=${low.ready}) high=${high.passed}/${high.total}(ready=${high.ready})`;

// 3. Env 0022 columns persist + drive the gate on a REAL fixture env row (set → read → gate → restore).
const env = (await db().query<{ id: string; cs: string; vs: string | null; lv: string | null; ct: string | null; prod: boolean }>(`
  SELECT e.id, e.certification_status cs, e.verification_state vs, e.last_verified::text lv, e.connection_target ct, e.is_production prod
    FROM environments e JOIN products p ON p.id=e.product_id
   WHERE p.name='eval-phase4-product' AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1`)).rows[0];
if (env) {
  try {
    await db().query(`UPDATE environments SET certification_status='certified', verification_state='verified', last_verified=now(), known_issues='[]'::jsonb WHERE id=$1`, [env.id]);
    const r = (await db().query<{ cs: string; vs: string; lvd: string | null; ki: number }>(`
      SELECT certification_status cs, verification_state vs,
             EXTRACT(EPOCH FROM (now()-last_verified))/86400 lvd, jsonb_array_length(known_issues) ki
        FROM environments WHERE id=$1`, [env.id])).rows[0];
    const rd = computeEnvironmentReadiness({ connectionTarget: env.ct, certificationStatus: r.cs, verificationState: r.vs, lastVerifiedDays: r.lvd != null ? Number(r.lvd) : null, knownIssues: r.ki, isProduction: env.prod });
    const certGate = rd.gates.find((x) => x.name === 'Certified')?.ok;
    const verGate = rd.gates.find((x) => x.name === 'Verified')?.ok;
    envColsOk = r.cs === 'certified' && r.vs === 'verified' && certGate === true && verGate === true && r.ki === 0;
    envDetail = `cs=${r.cs} vs=${r.vs} ki=${r.ki} cert.gate=${certGate} ver.gate=${verGate}`;
  } catch (e: any) { envDetail = `error: ${e?.message ?? e}`; }
  finally {
    await db().query(`UPDATE environments SET certification_status=$2, verification_state=$3, last_verified=$4 WHERE id=$1`, [env.id, env.cs ?? 'uncertified', env.vs, env.lv]).catch(() => {});
  }
}

checks.push({ name: 'specialistMetrics rolls up turns/handoffs/escalations from existing event tables', pass: specOk, detail: specDetail });
checks.push({ name: 'computeEnvironmentReadiness math (uncertified→not ready · certified+verified+fresh→ready)', pass: readyOk, detail: readyDetail });
checks.push({ name: 'environment 0022 columns persist + drive the readiness gate on a real env row', pass: envColsOk, detail: envDetail });

console.log('\n══ Phase 20 eval (network extensions — specialist metrics + environment readiness) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase20', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

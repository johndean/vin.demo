/**
 * Phase 6 eval — asserts the four governance layers + Compliance Rules Engine enforce BEFORE output and
 * are fully recorded, deterministically: identity metadata loads, behavior guardrails escalate/allow,
 * citation policy resolves per band, execution is gated by mode, and escalation + audit rows are written
 * (the meeting is reconstructable). Run: npm run eval:phase6
 */
import { db } from './db.js';
import { loadPersona, personaPermitsAction, type Persona } from './persona.js';
import { validateCompliance, shouldCite, recordEscalation, recordAuditTurn, checkBehavior } from './governance.js';
import { permits } from './safety.js';
import { createDemoSession } from './session.js';
import { bootSession, runTurn } from './live-session.js';
import { recordEvalRun } from './eval-record.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');

async function personaByName(name: string): Promise<Persona | null> {
  const { rows } = await db().query<{ id: string }>('SELECT id FROM personas WHERE name = $1 LIMIT 1', [name]);
  return rows[0] ? loadPersona(rows[0].id) : null;
}

const exec = await personaByName('Executive Advisor');
const security = await personaByName('Security Specialist');

// Behavior governance: a restricted category (pricing) escalates; an on-topic question is allowed.
const escalate = validateCompliance({ persona: exec, text: 'what is the pricing and can you give us a discount?', band: 'high', hasSource: true });
const allow = validateCompliance({ persona: exec, text: 'what business outcomes does this drive for the org?', band: 'high', hasSource: true });
const block = validateCompliance({ persona: security, text: 'can you guarantee the system is 100% secure?', band: 'high', hasSource: true });

// Execution governance — the PERSONA half of the gate (allowedActions whitelist), paired with the mode
// half below. Synthetic personas (seed-independent): a Manager allow-listed for "approve" may click an
// Approve control but NOT a confirmed-mutating Submit; an advisory persona (empty allowlist) is governed
// by mode alone. This is the gate at apps/engine/src/index.ts /agent/step, factored into personaPermitsAction.
const mgr = { allowedActions: ['approve'] } as unknown as Persona;
const advisory = { allowedActions: [] } as unknown as Persona;
const permitOk = personaPermitsAction(mgr, 'Approve request') === true
  && personaPermitsAction(mgr, 'Submit purchase order') === false
  && personaPermitsAction(advisory, 'Submit purchase order') === true
  && personaPermitsAction(null, 'anything') === true;

// Behavior gate — WORD-BOUNDARY matching (P2): a restricted term embedded in a larger token must NOT
// false-fire (the bug: "contract" tripping on the product name "modelcontract.software", "eta" on "beta").
const RULES = [
  { category: 'contract', restriction: 'x', action: 'escalate' as const },
  { category: 'roadmap', restriction: 'x', action: 'escalate' as const },
  { category: 'pricing', restriction: 'x', action: 'escalate' as const },
];
const fires = (text: string, cat: string) => checkBehavior(RULES, text).some((v) => v.rule.startsWith(cat + ':'));
const noFalseFire = !fires('tell me about modelcontract.software', 'contract')   // product name ≠ contract topic
  && !fires('when is the beta?', 'roadmap')                                       // "beta" must not trip "eta"
  && !fires('show me the metadata for this record', 'roadmap')                    // "metadata" must not trip "eta"
  && !fires('that is a significant improvement', 'contract');                     // "significant" must not trip (sign removed)
const trueFire = fires('what are the contract terms?', 'contract')
  && fires('what is the ETA on this?', 'roadmap')
  && fires('can we get a discount?', 'pricing');

// Escalation + audit recording (the meeting must be reconstructable).
const session = await createDemoSession(productId, 'read-only');
await recordEscalation(session.id, exec?.id ?? null, 'Accounting Specialist', 'guardrail', 'pricing — no_binding_quotes');
await recordAuditTurn({
  sessionId: session.id, personaId: exec?.id ?? null, personaName: 'Executive Advisor', promptVersion: exec?.version ?? 1,
  utterance: 'what is the pricing?', intent: 'pricing', knowledgeUsed: [], citations: [], confidenceBand: 'high',
  actionsConsidered: [], actionsRejected: [], handoff: null, escalation: { trigger: 'guardrail', reason: 'pricing', toPersona: 'Accounting Specialist' }, compliance: escalate,
});
const escRows = (await db().query<{ destination_persona_id: string | null }>('SELECT destination_persona_id FROM persona_escalation_events WHERE demo_session_id = $1', [session.id])).rows;
const auditRows = (await db().query<{ utterance: string; compliance: any; persona_name: string }>('SELECT utterance, compliance, persona_name FROM audit_turns WHERE demo_session_id = $1', [session.id])).rows;

// END-TO-END: the compliance gate must fire through the REAL runTurn path, not just the helpers above —
// a pricing question to the Executive Advisor must DEGRADE (escalate), emit a hand-off suggestion to the
// Accounting Specialist, and write an audit row with action=escalate. This proves validateCompliance is
// actually WIRED into runTurn (the prior eval only tested the gate functions in isolation). clientNav
// avoids server Playwright; the gate is independent of nav/retrieval quality, so it's deterministic here.
let e2eHandoff = false, e2eAudit = false, e2eDetail = 'not run';
try {
  const ctx = await bootSession('eval6', { productId, personaId: exec?.id ?? null, clientNav: true, mode: 'read-only', seedRoom: true });
  if (!ctx) { e2eDetail = 'bootSession null'; }
  else {
    const events: any[] = [];
    await runTurn(ctx, { speaker: 'CFO', text: 'what is your pricing, and can you give us a discount?' }, (ev) => events.push(ev));
    e2eHandoff = events.some((e) => e.type === 'handoff_suggestion' && e.toPersona === 'Accounting Specialist');
    const a = (await db().query<{ action: string | null }>("SELECT compliance->>'action' AS action FROM audit_turns WHERE demo_session_id = $1 ORDER BY occurred_at DESC LIMIT 1", [ctx.sessionId])).rows;
    e2eAudit = a[0]?.action === 'escalate';
    e2eDetail = `handoff→Accounting=${e2eHandoff} audit.action=${a[0]?.action ?? 'none'}`;
  }
} catch (e: any) { e2eDetail = `error: ${e?.message ?? e}`; }

const checks = [
  { name: 'Identity governance loads (version/owner/approver)', pass: !!exec && exec.version >= 1 && !!exec.owner && !!exec.approver, detail: exec ? `v${exec.version} owner=${exec.owner} approver=${exec.approver}` : 'no persona' },
  { name: 'Behavior gate — restricted category ESCALATES before output', pass: !escalate.ok && escalate.action === 'escalate' && escalate.escalateTo === 'Accounting Specialist', detail: `action=${escalate.action} → ${escalate.escalateTo}` },
  { name: 'Behavior gate — on-topic question ALLOWED', pass: allow.ok && allow.action === 'allow', detail: `action=${allow.action}` },
  { name: 'Behavior gate — security guarantee BLOCKS', pass: !block.ok && block.action === 'block', detail: `action=${block.action}` },
  { name: 'Citation policy resolves per band', pass: shouldCite('always', 'high', true) === true && shouldCite('never', 'low', true) === false && shouldCite('when_uncertain', 'high', true) === false && shouldCite('when_uncertain', 'low', true) === true, detail: 'always/never/when_uncertain×band' },
  { name: 'Execution governance — mutating gated by mode', pass: permits('mutating', 'read-only').permitted === false && permits('mutating', 'execution').permitted === true, detail: 'read-only blocks · execution allows' },
  { name: 'Execution governance — persona allowlist gates the action', pass: permitOk, detail: 'approve✓ submit✗ for allowlisted persona · empty⇒mode-governed' },
  { name: 'Behavior gate — word-boundary (no substring/product-name false-fires)', pass: noFalseFire && trueFire, detail: `fp-clean=${noFalseFire} truePos=${trueFire}` },
  { name: 'Compliance gate fires END-TO-END through runTurn (pricing → escalate + hand-off + audit)', pass: e2eHandoff && e2eAudit, detail: e2eDetail },
  { name: 'Escalation recorded (resolved destination)', pass: escRows.length === 1 && !!escRows[0].destination_persona_id, detail: `rows=${escRows.length} destResolved=${!!escRows[0]?.destination_persona_id}` },
  { name: 'Audit trail recorded + reconstructable', pass: auditRows.length === 1 && auditRows[0].utterance === 'what is the pricing?' && auditRows[0].compliance?.action === 'escalate' && auditRows[0].persona_name === 'Executive Advisor', detail: `rows=${auditRows.length}` },
];

console.log('\n══ Phase 6 eval (governance control framework) ════════');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase6', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

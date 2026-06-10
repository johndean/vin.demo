/**
 * Phase 5 eval — asserts Personas behave as HUMAN-LEVEL specialist simulations, deterministically &
 * auditably: the rich layers load, the preamble encodes cognition/communication/decision, the same
 * objection yields DIFFERENT per-specialist responses, hand-off conditions route, confidence bands
 * grade, and grounded composition materially differs by persona. Run: npm run eval:phase5
 */
import { db } from './db.js';
import { loadPersona, personaPreamble, handoffSuggestionFor, type Persona } from './persona.js';
import { retrieveAndGate } from './retrieval.js';
import { getLlm } from './llm.js';
import { recordEvalRun } from './eval-record.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed`.');

async function personaByName(name: string): Promise<Persona | null> {
  const { rows } = await db().query<{ id: string }>('SELECT id FROM personas WHERE name = $1 LIMIT 1', [name]);
  return rows[0] ? loadPersona(rows[0].id) : null;
}

const integration = await personaByName('Integration Engineer');
const executive = await personaByName('Executive Advisor');
const accounting = await personaByName('Accounting Specialist');

const iPre = personaPreamble(integration);
const ePre = personaPreamble(executive);

// Band checks (real retrieval): the seeded create-PO knowledge answers; an off-topic query gates.
const createGate = await retrieveAndGate('how do I create a new purchase request', productId);
const offGate = await retrieveAndGate('what is the capital of France', productId);

// Objection differentiation (config-level, deterministic): same objection → different responses.
const eObj = executive?.objectionPlaybook.find((o) => /expensive/i.test(o.objection));
const aObj = accounting?.objectionPlaybook.find((o) => /expensive/i.test(o.objection));

// Grounded composition differs by persona (LLM, 2 calls) — same source, different voice/framework.
const SOURCE = { content: 'Purchase Hub routes a request through Manager → Owner approval; delegation auto-routes when an approver is out.', source: 'po.vin docs · workflow' };
let iAns = '', eAns = '';
try {
  iAns = integration ? await getLlm().answerAs({ personaPreamble: iPre, question: 'How should we think about adopting this?', intent: 'adoption', band: 'high', source: SOURCE }) : '';
  eAns = executive ? await getLlm().answerAs({ personaPreamble: ePre, question: 'How should we think about adopting this?', intent: 'adoption', band: 'high', source: SOURCE }) : '';
} catch { /* soft check */ }

const checks = [
  { name: 'Rich layers load (Integration)', pass: !!integration && integration.mentalModels.length > 0 && !!integration.communicationStyle && integration.decisionFramework.length > 0 && integration.objectionPlaybook.length > 0 && integration.handoffConditions.length > 0, detail: integration ? `mm=${integration.mentalModels.length} df=${integration.decisionFramework.length} ob=${integration.objectionPlaybook.length} ho=${integration.handoffConditions.length}` : 'no persona' },
  { name: 'Preamble encodes cognition + communication + framework', pass: /mental models/i.test(iPre) && /communication style/i.test(iPre) && iPre.includes(integration?.decisionFramework[0]?.replace(/_/g, ' ') ?? '∅'), detail: `${iPre.length} chars` },
  { name: 'Two personas → materially different brains', pass: iPre !== ePre && /standards|systems/i.test(iPre) && /roi|strategic/i.test(ePre), detail: 'integration≠executive' },
  { name: 'Hand-off routes (Integration: security → Security Specialist)', pass: handoffSuggestionFor(integration, 'can you cover the security model and SSO?')?.toPersona === 'Security Specialist', detail: handoffSuggestionFor(integration, 'security model and SSO')?.toPersona ?? 'none' },
  { name: 'Hand-off routes (Executive: pricing → Accounting Specialist)', pass: handoffSuggestionFor(executive, "what's the pricing?")?.toPersona === 'Accounting Specialist', detail: handoffSuggestionFor(executive, 'pricing')?.toPersona ?? 'none' },
  { name: 'Confidence band — create-PO answerable (not gated)', pass: !createGate.gated && createGate.band !== 'very_low', detail: `band=${createGate.band} gated=${createGate.gated}` },
  { name: 'Confidence band — off-topic gates (very_low)', pass: offGate.gated && offGate.band === 'very_low', detail: `band=${offGate.band} gated=${offGate.gated}` },
  { name: 'Same objection → different specialist responses', pass: !!eObj && !!aObj && JSON.stringify(eObj.response) !== JSON.stringify(aObj.response), detail: `exec=[${eObj?.response.join(',')}] acct=[${aObj?.response.join(',')}]` },
  { name: 'Grounded composition differs by persona (voice)', pass: iAns.length > 0 && eAns.length > 0 && iAns !== eAns, detail: `i=${iAns.length}c e=${eAns.length}c` },
];

console.log('\n══ Phase 5 eval (human-level specialist simulations) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase5', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

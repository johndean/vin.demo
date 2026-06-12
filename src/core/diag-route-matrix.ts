/**
 * Routing-matrix harness for the phase1 interpret→pickNode fix. Applies candidate prompt OVERRIDES
 * (in-process, no DB write) for `interpret` and/or `pickNode`, then runs a matrix of utterances through
 * interpret→pickNode against the LIVE model + the product's real navigable labels, printing the chosen
 * node per utterance. Equivalent to editing the default span (rp() returns the override when set).
 *
 *   npx tsx src/core/diag-route-matrix.ts                 # baseline (current defaults)
 *   npx tsx src/core/diag-route-matrix.ts /tmp/cand.json  # {"interpret":"...","pickNode":"..."} (either optional)
 */
import { setOverrides } from './prompts.js';
import { getLlm } from './llm.js';
import { selectNavigation } from './graph-lifecycle.js';
import { readFileSync } from 'node:fs';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set');

const candPath = process.argv[2];
if (candPath) {
  const cand = JSON.parse(readFileSync(candPath, 'utf8'));
  const rows: { prompt_key: string; text: string }[] = [];
  if (cand.interpret && String(cand.interpret).trim()) rows.push({ prompt_key: 'interpret', text: String(cand.interpret) });
  if (cand.pickNode && String(cand.pickNode).trim()) rows.push({ prompt_key: 'pickNode', text: String(cand.pickNode) });
  setOverrides(rows);
  console.log('OVERRIDES APPLIED:', rows.map((r) => r.prompt_key).join(', ') || '(none)');
} else {
  console.log('BASELINE (current defaults — no override)');
}

const sel = await selectNavigation(productId, null);
const labels = sel.candidates.map((r) => r.intent_label);

// Matrix: the failing usage question + a config question (must STILL go to settings) + a sub-view + an outcome.
const MATRIX = [
  { u: 'How does approval delegation work?', expect: 'WORKING screen (approvals queue) — NOT a settings/config screen' },
  { u: 'How do I set up or configure approval delegation rules?', expect: 'SETTINGS/config screen (this one SHOULD go to settings — must not regress)' },
  { u: 'Show me the bypassed or delegated approvals', expect: 'the bypassed/delegated sub-view list' },
  { u: 'How can I reduce approval delays for my team?', expect: 'WORKING screen (queue/list) — NOT settings' },
];

for (const m of MATRIX) {
  const intent = (await getLlm().interpret(m.u)).intent;
  const picked = await getLlm().pickNode(intent, labels, true); // mirror the RUNTIME nav path (fast tier) so this diagnostic stays faithful (#5)
  console.log(`\nQ: ${m.u}`);
  console.log(`   expect : ${m.expect}`);
  console.log(`   intent : ${JSON.stringify(intent)}`);
  console.log(`   → node : ${JSON.stringify(picked)}`);
}

console.log('\nNAVIGABLE LABELS (' + labels.length + '): ' + labels.join(' · '));
process.exit(0);

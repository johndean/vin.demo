/**
 * Multi-turn demo: proves the mid-flight pivot. One thread, four stakeholder
 * turns — answer → "why did you show that?" → pivot to a different feature →
 * "take me back" — showing interrupt + return-to-context, with cost accruing
 * across the whole session.  Run: npm run convo
 */
import { buildGraph } from './graph.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';
import type { ExecutionMode } from './safety.js';

const productId = process.env.PO_VIN_PRODUCT_ID;
if (!productId) throw new Error('PO_VIN_PRODUCT_ID not set — run `npm run seed` first.');
const mode = (process.env.PO_VIN_MODE as ExecutionMode) ?? 'read-only';
const role = process.env.PO_VIN_ROLE ?? 'admin';

const session = await createDemoSession(productId, mode);
beginCostSession(session.id);
const graph = buildGraph();
const thread = { configurable: { thread_id: `convo-${Date.now()}` } };

const turns = [
  'How does approval delegation work?',
  'Wait — why did you show me that screen?',
  "Hold on — let's pause for a moment.", // P2.1: interrupt governance (pause)
  'Okay, continue.',                      // P2.1: resume the session
  'Got it. Now show me the bypassed / delegated approvals.',
  'Okay, take me back to where we were.',
];

for (const utterance of turns) {
  console.log(`\n══ Stakeholder: "${utterance}"`);
  const out = await graph.invoke({ utterance, productId, sessionId: session.id, role, mode }, thread);

  if (out.explanation) console.log(`VIN Demo${out.interpretation?.isMetaExplain ? ' (why)' : ''}: ${out.explanation}`);
  else if (out.gated) console.log(`VIN Demo: I'm not certain about that — let me show you the source rather than guess.`);
  else if (!out.interpretation?.isResume && out.retrieved?.[0]) console.log(`VIN Demo: ${out.retrieved[0].content.slice(0, 150)}…`);
  if (out.interpretation?.isResume) console.log('VIN Demo: Sure — coming back to where we were.');

  if (out.navigation?.url) console.log(`  → on ${out.navigation.url}${out.navigation.healedVia ? `  [self-heal: ${out.navigation.healedVia}]` : ''}`);
  if (out.blockedMutations?.length) console.log(`  ⛔ ${mode} blocked: ${out.blockedMutations.join(', ')}`);
  console.log(`  stack depth: ${out.contextStack?.length ?? 0}`);
  console.log(`  trace: ${out.trace.slice(-2).join('  |  ')}`);
}

const c = await sessionCost(session.id);
console.log(`\nDemo cost (4 turns): $${c.totalUsd.toFixed(6)} · ${c.totalTokens} tokens (${c.byType.map((b) => `${b.type} $${b.usd.toFixed(6)}`).join(', ')})`);
process.exit(0);

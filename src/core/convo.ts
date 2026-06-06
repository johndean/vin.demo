/**
 * Multi-turn demo: proves the mid-flight pivot. One thread, four stakeholder
 * turns — answer → "why did you show that?" → pivot to a different feature →
 * "take me back" — showing interrupt + return-to-context, with cost accruing
 * across the whole session.  Run: npm run convo
 */
import { buildGraph } from './graph.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';
import { getDiscovery } from './discovery.js';
import { getStakeholders } from './stakeholders.js';
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
  { speaker: 'Procurement', text: 'How does approval delegation work?' },
  { speaker: 'Procurement', text: 'Wait — why did you show me that screen?' },
  { speaker: 'CFO', text: "Hold on — let's pause for a moment." },  // P2.1: interrupt governance (pause)
  { speaker: 'CFO', text: 'Okay, continue.' },                       // P2.1: resume the session
  { speaker: 'CFO', text: 'Our approvals stall when I travel. Show me the bypassed / delegated approvals.' },
  { speaker: 'Procurement', text: 'Okay, take me back to where we were.' },
];

for (const { speaker, text } of turns) {
  console.log(`\n══ ${speaker}: "${text}"`);
  const out = await graph.invoke({ utterance: text, speaker, productId, sessionId: session.id, role, mode }, thread);

  if (out.activeStakeholder) console.log(`  (speaking: ${out.activeStakeholder.name} — ${out.activeStakeholder.role})`);
  if (out.explanation) console.log(`VIN Demo${out.interpretation?.isMetaExplain ? ' (why)' : ''}: ${out.explanation}`);
  else if (out.gated) console.log(`VIN Demo: I'm not certain about that — let me show you the source rather than guess.`);
  else if (!out.interpretation?.isResume && out.retrieved?.[0]) console.log(`VIN Demo: ${out.retrieved[0].content.slice(0, 150)}…`);
  if (out.interpretation?.isResume) console.log('VIN Demo: Sure — coming back to where we were.');

  if (out.navigation?.url) console.log(`  → on ${out.navigation.url}${out.navigation.healedVia ? `  [self-heal: ${out.navigation.healedVia}]` : ''}`);
  if (out.blockedMutations?.length) console.log(`  ⛔ ${mode} blocked: ${out.blockedMutations.join(', ')}`);
  if (out.discoveryPrompt) console.log(`  ↳ discovery: ${out.discoveryPrompt}`);
  console.log(`  stack depth: ${out.contextStack?.length ?? 0}`);
  console.log(`  trace: ${out.trace.slice(-2).join('  |  ')}`);
}

const c = await sessionCost(session.id);
console.log(`\nDemo cost (${turns.length} turns): $${c.totalUsd.toFixed(6)} · ${c.totalTokens} tokens (${c.byType.map((b) => `${b.type} $${b.usd.toFixed(6)}`).join(', ')})`);
const disc = await getDiscovery(session.id);
console.log(`Discovery — pain: [${disc.painPoints.join('; ')}] · signals: [${disc.buyingSignals.join('; ')}] · objective: ${disc.businessObjective ?? '—'}`);
const people = await getStakeholders(session.id);
for (const p of people) console.log(`Stakeholder ${p.name} (${p.role})${p.isActive ? ' *active' : ''} — interests: [${p.interests.join('; ')}] · open items: [${p.openItems.join('; ')}]`);
process.exit(0);

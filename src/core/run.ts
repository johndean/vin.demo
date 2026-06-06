/** Run the loop for a single utterance. Increment 1: interpret → retrieve.
 *  Usage: npm run loop -- "How does approval delegation work?" */
import { buildGraph } from './graph.js';
import type { ExecutionMode } from './safety.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';

const utterance = process.argv.slice(2).join(' ') || 'How does approval delegation work?';
const productId = process.env.PO_VIN_PRODUCT_ID ?? null;
const mode = (process.env.PO_VIN_MODE as ExecutionMode) ?? 'read-only';

// Open a demo session so state + cost events hang off a real session row.
let sessionId: string | null = null;
if (productId) {
  const s = await createDemoSession(productId, mode);
  sessionId = s.id;
  beginCostSession(sessionId);
}

const graph = buildGraph();
const out = await graph.invoke(
  { utterance, productId, sessionId, role: process.env.PO_VIN_ROLE ?? 'admin', mode },
  { configurable: { thread_id: `cli-${Date.now()}` } },
);

if (out.explanation) console.log(`\nVIN Demo${out.interpretation?.isMetaExplain ? ' (why)' : ''}: ${out.explanation}`);

console.log(`\nStakeholder: "${utterance}"`);
console.log(`Interpretation: kind=${out.interpretation?.kind} intent="${out.interpretation?.intent}" control=${out.interpretation?.control ?? 'none'}`);
const top = out.retrieved?.[0];
if (out.gated) {
  console.log("VIN Demo: I'm not certain about that — let me show you the source rather than guess.");
} else if (top) {
  const dist = top.distance == null ? 'n/a' : top.distance.toFixed(3);
  console.log(`Top knowledge (${top.category}, distance ${dist}):`);
  console.log(`  ${top.content}`);
  console.log(`  ↳ source: ${top.source} · confidence: ${top.confidence} · version: ${top.product_version} · ${top.validation_status}`);
}
if (out.navigation) {
  console.log(`\nNavigated (${out.mode}, as ${out.role}): ${out.navigation.ok ? out.navigation.url : 'FAILED'}` +
    (out.navigation.healedVia ? `  [self-heal: ${out.navigation.healedVia}]` : '  [primary selector ok]'));
  if (out.blockedMutations.length) {
    console.log(`⛔ ${out.mode} guard blocked ${out.blockedMutations.length} mutating action(s): ${out.blockedMutations.join(', ')}`);
  }
} else if (!out.gated && top) {
  console.log('\nNavigation: skipped (no productId or DemoGraph node configured).');
}
if (out.discoveryPrompt) console.log(`\nVIN Demo (discovery): ${out.discoveryPrompt}`);

console.log('\nTrace:');
for (const t of out.trace) console.log(`  • ${t}`);

if (sessionId) {
  const c = await sessionCost(sessionId);
  const breakdown = c.byType.map((b) => `${b.type} $${b.usd.toFixed(6)}`).join(', ');
  console.log(`\nDemo cost: $${c.totalUsd.toFixed(6)} · ${c.totalTokens} tokens (${breakdown})`);
}
console.log();
process.exit(0);

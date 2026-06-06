/** Run the loop for a single utterance. Increment 1: interpret → retrieve.
 *  Usage: npm run loop -- "How does approval delegation work?" */
import { buildGraph } from './graph.js';

const utterance = process.argv.slice(2).join(' ') || 'How does approval delegation work?';

const graph = buildGraph();
const out = await graph.invoke({ utterance, productId: process.env.PO_VIN_PRODUCT_ID ?? null });

console.log(`\nStakeholder: "${utterance}"`);
console.log(`Interpretation: kind=${out.interpretation?.kind} intent="${out.interpretation?.intent}"`);
if (out.gated) {
  console.log("VIN Demo: I'm not certain about that — let me show you the source rather than guess.");
} else {
  const top = out.retrieved[0];
  const dist = top.distance == null ? 'n/a' : top.distance.toFixed(3);
  console.log(`Top knowledge (${top.category}, distance ${dist}):`);
  console.log(`  ${top.content}`);
  console.log(`  ↳ source: ${top.source} · confidence: ${top.confidence} · version: ${top.product_version} · ${top.validation_status}`);
}
console.log('\nTrace:');
for (const t of out.trace) console.log(`  • ${t}`);
console.log();
process.exit(0);

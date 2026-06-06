/**
 * Drive the demo loop against ANY onboarded product, by name — the product-agnostic
 * counterpart to `npm run loop` (which is wired to po.vin). This is how you *watch* the
 * engine work on a given product from the terminal: it logs into the real site read-only,
 * navigates a real screen, answers with cited knowledge, and blocks any mutating action.
 *
 *   npm run demo:product -- <product-name> ["a stakeholder question"] ["a follow-up"] ...
 *   e.g.  npm run demo:product -- defensive.software "show me live activity"
 */
import { buildGraph } from './graph.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';
import { db } from './db.js';
import type { ExecutionMode } from './safety.js';

const productName = process.argv[2];
if (!productName) throw new Error('usage: npm run demo -- <product-name> ["question"] ["follow-up"] …');
const turns = process.argv.slice(3);
if (!turns.length) turns.push('How does this product work?');

const { rows } = await db().query<{ id: string }>('SELECT id FROM products WHERE lower(name) = lower($1) LIMIT 1', [productName]);
if (!rows[0]) throw new Error(`No onboarded product named "${productName}". Onboard it first (npm run onboard <manifest> / npm run onboard:wizard).`);
const productId = rows[0].id;

const mode = (process.env.DEMO_MODE as ExecutionMode) ?? 'read-only';
const role = process.env.DEMO_ROLE ?? 'admin';
const session = await createDemoSession(productId, mode);
beginCostSession(session.id);
const graph = buildGraph();
const thread = { configurable: { thread_id: `demo-${productName}-${turns.length}` } };

console.log(`\n── VIN Demo · ${productName} · mode=${mode} · as ${role} ──`);
for (const text of turns) {
  console.log(`\n══ Stakeholder: "${text}"`);
  const out = await graph.invoke({ utterance: text, productId, sessionId: session.id, role, mode }, thread);

  if (out.explanation) console.log(`VIN Demo${out.interpretation?.isMetaExplain ? ' (why)' : ''}: ${out.explanation}`);
  const top = out.retrieved?.[0];
  if (out.gated) {
    console.log(`VIN Demo: I'm not certain about that — let me show you the source rather than guess.`);
  } else if (top) {
    console.log(`VIN Demo: ${top.content.slice(0, 200)}${top.content.length > 200 ? '…' : ''}`);
    console.log(`  ↳ source: ${top.source} · confidence: ${top.confidence} · version: ${top.product_version} · ${top.validation_status}`);
  }
  if (out.navigation) {
    console.log(`  → navigated (${out.mode}, as ${out.role}): ${out.navigation.ok ? out.navigation.url : 'FAILED'}` +
      (out.navigation.healedVia ? `  [self-heal: ${out.navigation.healedVia}]` : out.navigation.ok ? '  [primary selector ok]' : ''));
  }
  if (out.blockedMutations?.length) console.log(`  ⛔ ${out.mode} blocked ${out.blockedMutations.length} mutating action(s): ${out.blockedMutations.slice(0, 6).join(', ')}`);
  if (out.discoveryPrompt) console.log(`  ↳ discovery: ${out.discoveryPrompt}`);
  console.log(`  trace: ${out.trace.slice(-3).join('  |  ')}`);
}

const c = await sessionCost(session.id);
console.log(`\nDemo cost (${turns.length} turn${turns.length > 1 ? 's' : ''}): $${c.totalUsd.toFixed(6)} · ${c.totalTokens} tokens`);
process.exit(0);

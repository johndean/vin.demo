/**
 * Safe-mode wizard walkthrough demo (P3.4c) — the project's first non-"navigate-and-read"
 * modality. Drives modelcontract.software's public, no-login model-employment-agreement
 * wizard in `safe` execution mode: it steps THROUGH the form (Next = non-destructive) while
 * NEVER firing the final commit (Generate/Submit → mutating → blocked even in safe mode).
 * Run: npm run walkthrough
 */
import { db } from './db.js';
import { getAdapter } from './driver.js';
import { retrieveAndGate } from './retrieval.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';

const { rows } = await db().query<{ id: string }>("SELECT id FROM products WHERE name = 'modelcontract.software' LIMIT 1");
const productId = rows[0]?.id;
if (!productId) throw new Error('modelcontract.software not seeded — run `npm run seed:mc` first.');

const session = await createDemoSession(productId, 'safe');
beginCostSession(session.id);

// Narrate from product knowledge (grounded, trust-gated).
const r = await retrieveAndGate('what does the model employment agreement wizard do', productId);
console.log(`\nStakeholder: "Walk me through the model employment agreement."`);
console.log(`VIN Demo: ${r.gated ? "I'm not certain — let me show you the source instead." : r.top?.content}`);
console.log(`  ↳ source: ${r.top?.source} · confidence: ${r.top?.confidence} · ${r.top?.validation_status}`);

// Walk the wizard in SAFE mode — steps through, never commits.
const driver = await getAdapter('modelcontract.software', 'safe');
await driver.open('employer');
const w = await driver.walkthrough?.(6);
await driver.close();

console.log(`\nSafe-mode walkthrough — ${w?.steps.length ?? 0} step(s):`);
for (const s of w?.steps ?? []) console.log(`  ${s.n}. ${s.heading}  — ${s.action}`);
console.log(`stopped: ${w?.stopped}`);
console.log(`⛔ committed an agreement? ${w?.committed ? 'YES (BUG!)' : 'no — safe mode never fired a commit'}`);

const c = await sessionCost(session.id);
console.log(`\nDemo cost: $${c.totalUsd.toFixed(6)} · ${c.totalTokens} tokens`);
process.exit(0);

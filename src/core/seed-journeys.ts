/**
 * Seed one ASSEMBLED draft journey per product (the Journey Assembler, mig 0025) — to give every product a
 * first guided narrative + surface its gap backlog. Picks each product's PRIMARY (first-seeded) active outcome
 * + its full committee, runs assembleJourney (consume-only: references existing assets, records Gap Records for
 * anything missing, creates nothing else). IDEMPOTENT: skips a product that already has an assembler-owned
 * journey. Run: railway run npm run seed:journeys
 */
import 'dotenv/config';
import { db } from './db.js';
import { assembleJourney } from './journey-assembler.js';
import { getJourneys } from './journeys.js';
import { getOutcomes } from './outcomes.js';
import { getStakeholderRegistry } from './stakeholders.js';

const PRODUCTS = ['PO.vin', 'expense.vin', 'rounds.vin', 'ce.vin', 'modelcontract.software', 'defensive.software'];
const ACTOR = 'journey-assembler';
let made = 0, skipped = 0, totalGaps = 0;

for (const name of PRODUCTS) {
  const prod = (await db().query<{ id: string }>(`SELECT id FROM products WHERE lower(name)=lower($1) LIMIT 1`, [name])).rows[0];
  if (!prod) { console.log(`✗ ${name}: product not found`); continue; }
  const existing = (await getJourneys(prod.id)).filter((j) => j.owner === ACTOR);
  if (existing.length) { console.log(`= ${name}: already has ${existing.length} assembled journey(s) — skip`); skipped++; continue; }
  const outcomes = await getOutcomes(prod.id);                 // newest-first
  const outcome = outcomes[outcomes.length - 1] ?? outcomes[0]; // oldest = the primary outcome (#1 seeded)
  if (!outcome) { console.log(`✗ ${name}: no outcomes — seed outcomes-committee first`); continue; }
  const committeeIds = (await getStakeholderRegistry(prod.id)).map((s) => s.id);
  const res = await assembleJourney({ productId: prod.id, outcomeId: outcome.id, committeeIds, organization: name, industry: '' }, ACTOR);
  made++; totalGaps += res.gaps.length;
  console.log(`+ ${name}: “${outcome.title}” → ${res.confidence}% confidence · ${res.storyFlowLen} steps · refs ${res.assets.workflows}wf/${res.assets.knowledge}kn/${res.assets.tours}tour · ${res.gaps.length} gap(s)`);
}

console.log('\n───────────────────────────────────────────────────');
console.log(`  ${made} draft journeys assembled, ${skipped} skipped (already seeded), ${totalGaps} gap records surfaced.`);
console.log('  Review them in the console → Journeys (per product): confidence badge + Gap Records panel.\n');
process.exit(0);

/**
 * Eval: the Journey ASSEMBLER (mig 0025) is a CONSUMER, not a creator. Runs the real assembler on a real
 * product and proves: (1) confidence is in [0,100]; (2) ZERO upstream assets created — products / workflows /
 * tours / knowledge / personas / outcomes / committee / org-people counts are UNCHANGED; only journeys (+1)
 * and gap_records (+N) grow; (3) the assembled story_flow references ONLY real assets (resolveStoryFlow → no
 * broken refs); (4) gap records are persisted; (5) the journey is saved as a draft. Then it CLEANS UP its test
 * journey + gaps so the eval is repeatable and leaves no residue. Run: npm run eval:phase23
 */
import 'dotenv/config';
import { db } from './db.js';
import { assembleJourney } from './journey-assembler.js';
import { resolveStoryFlow, getJourneys } from './journeys.js';
import { getGapsForJourney } from './gap-records.js';
import { getOutcomes } from './outcomes.js';
import { getStakeholderRegistry } from './stakeholders.js';
import { recordEvalRun } from './eval-record.js';

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });
const count = async (sql: string): Promise<number> => {
  try { return Number((await db().query<{ n: string }>(sql)).rows[0]?.n ?? 0); } catch { return -1; }
};
const snapshot = async () => ({
  products: await count(`SELECT count(*) n FROM products`),
  workflows: await count(`SELECT count(*) n FROM demo_graph_workflows WHERE archived_at IS NULL`),
  tours: await count(`SELECT count(*) n FROM demo_tours WHERE archived_at IS NULL`),
  knowledge: await count(`SELECT count(*) n FROM knowledge_chunks WHERE archived_at IS NULL`),
  personas: await count(`SELECT count(*) n FROM personas WHERE archived_at IS NULL`),
  outcomes: await count(`SELECT count(*) n FROM business_outcomes WHERE archived_at IS NULL`),
  committee: await count(`SELECT count(*) n FROM product_stakeholders WHERE archived_at IS NULL`),
  orgPeople: await count(`SELECT count(*) n FROM org_people WHERE archived_at IS NULL`),
  journeys: await count(`SELECT count(*) n FROM journeys WHERE archived_at IS NULL`),
  gaps: await count(`SELECT count(*) n FROM gap_records WHERE archived_at IS NULL`),
});
const UPSTREAM = ['products', 'workflows', 'tours', 'knowledge', 'personas', 'outcomes', 'committee', 'orgPeople'] as const;

const prod = (await db().query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE lower(name)='po.vin' LIMIT 1`)).rows[0];
if (!prod) { console.log('✗ PO.vin not found — cannot run assembler eval'); process.exit(1); }
const outcome = (await getOutcomes(prod.id))[0];
if (!outcome) { console.log('✗ PO.vin has no outcomes — seed outcomes-committee first'); process.exit(1); }
const committeeIds = (await getStakeholderRegistry(prod.id)).map((s) => s.id);

const before = await snapshot();
const res = await assembleJourney({ productId: prod.id, outcomeId: outcome.id, committeeIds, organization: 'Eval Org', industry: 'veterinary' }, 'eval-phase23');
const after = await snapshot();

ok('confidence in [0,100]', res.confidence >= 0 && res.confidence <= 100, `${res.confidence}%`);

const changedUpstream = UPSTREAM.filter((k) => before[k] !== after[k]);
ok('consume-not-create: NO upstream asset created/changed', changedUpstream.length === 0,
  changedUpstream.length ? `changed: ${changedUpstream.map((k) => `${k} ${before[k]}→${after[k]}`).join(', ')}` : 'products/workflows/tours/knowledge/personas/outcomes/committee/org all unchanged');

ok('created exactly one journey', after.journeys === before.journeys + 1, `${before.journeys}→${after.journeys}`);
ok('persisted gap records match returned count', after.gaps === before.gaps + res.gaps.length && (await getGapsForJourney(res.journeyId)).length === res.gaps.length, `${res.gaps.length} gaps`);

const journey = (await getJourneys(prod.id)).find((j) => j.id === res.journeyId);
ok('journey saved as draft', !!journey && journey.status === 'draft', journey?.status ?? 'missing');
const resolved = journey ? await resolveStoryFlow(prod.id, journey.storyFlow) : [];
const broken = resolved.filter((s) => !s.ok);
ok('story_flow references ONLY real assets (no broken refs)', !!journey && broken.length === 0,
  broken.length ? `${broken.length} broken: ${broken.slice(0, 2).map((s) => `${s.kind}:${s.reason}`).join('; ')}` : `${resolved.length} steps, all resolve`);

// ── CLEANUP — remove the test journey + its gaps/events/runs so the eval is repeatable + residue-free ──
await db().query(`DELETE FROM gap_records WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_runs WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journey_events WHERE journey_id = $1`, [res.journeyId]).catch(() => {});
await db().query(`DELETE FROM journeys WHERE id = $1`, [res.journeyId]).catch(() => {});
const cleaned = await snapshot();
ok('cleanup: journeys + gaps back to baseline', cleaned.journeys === before.journeys && cleaned.gaps === before.gaps, `journeys ${cleaned.journeys}, gaps ${cleaned.gaps}`);

console.log('\n══ Journey Assembler eval (phase23) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase23', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name), product: prod.name, confidence: res.confidence, gaps: res.gaps.length });
process.exit(failed.length ? 1 : 0);

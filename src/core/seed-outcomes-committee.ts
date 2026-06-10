/**
 * Seed the Business Outcome Registry (0020) + per-product Buying Committee (product_stakeholders 0012+0020)
 * for all 6 products from the AUTHORED rich data (docs/seed/committee/*.json via loadRichSeed).
 *
 * UPSERT: an outcome/stakeholder created by a PRIOR run of this seed is UPDATED in place — outcomes gain a
 * description + measurable success indicators (joined into `metric`); committee members gain a real person
 * name, influence / risk / decision-authority, and full interests / criteria / goals / objections / questions.
 * RECONCILE: any prior-seed outcome/role NOT in the authored set is soft-archived — this drops the superseded
 * ce.vin / rounds.vin roles + outcomes after the 2026-06-10 domain correction (ce.vin = CE course production;
 * rounds.vin = transcript operations). Only rows owned by THIS seed (actor below) are ever archived — a
 * human-authored committee member is never touched. Idempotent; audited via the existing event trails.
 * Run: railway run npm run seed:outcomes-committee
 */
import 'dotenv/config';
import { db } from './db.js';
import { createOutcome, updateOutcome, getOutcomes, archiveOutcome } from './outcomes.js';
import { createProductStakeholder, updateProductStakeholder, getStakeholderRegistry, archiveProductStakeholder } from './stakeholders.js';
import { loadRichSeed, AUTHORITIES, INFLUENCES, RISKS } from './outcomes-committee-data.js';

const ACTOR = 'outcomes-committee-seed';   // KEEP CONSTANT — identifies prior-seed rows for reconcile-archive
const norm = (s: string) => (s || '').trim().toLowerCase();

const seed = loadRichSeed();
let cOut = 0, uOut = 0, aOut = 0, cSt = 0, uSt = 0, aSt = 0;
const missing: string[] = [];
const warn: string[] = [];

for (const p of Object.values(seed)) {
  const prod = (await db().query<{ id: string }>(`SELECT id FROM products WHERE lower(name)=lower($1) LIMIT 1`, [p.product])).rows[0];
  if (!prod) { missing.push(p.product); console.log(`\n✗ ${p.product}: product not found — skipped`); continue; }

  // ── Business Outcomes: upsert authored (description + indicators→metric); archive superseded prior-seed ──
  const outByTitle = new Map((await getOutcomes(prod.id)).map((o) => [norm(o.title), o.id]));
  const desiredTitles = new Set(p.outcomes.map((o) => norm(o.title)));
  let pcO = 0, puO = 0;
  for (const o of p.outcomes) {
    const metric = (o.successIndicators ?? []).map((s) => (s || '').trim()).filter(Boolean).join(' · ') || null;
    const id = outByTitle.get(norm(o.title));
    if (id) { await updateOutcome(id, { description: o.description ?? null, metric }, ACTOR); uOut++; puO++; }
    else { await createOutcome(prod.id, { title: o.title, description: o.description ?? null, metric, status: 'active', owner: 'VIN demo' }, ACTOR); cOut++; pcO++; }
  }
  const staleOut = (await db().query<{ id: string; title: string }>(
    `SELECT id, title FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL AND created_by=$2`, [prod.id, ACTOR],
  )).rows.filter((r) => !desiredTitles.has(norm(r.title)));
  for (const r of staleOut) { await archiveOutcome(r.id, ACTOR); aOut++; }

  // ── Buying Committee: upsert authored (match by role); archive superseded prior-seed roles ──
  const stByRole = new Map((await getStakeholderRegistry(prod.id)).map((s) => [norm(s.role || ''), s.id]));
  const desiredRoles = new Set(p.committee.map((s) => norm(s.role)));
  let pcS = 0, puS = 0;
  for (const s of p.committee) {
    if (s.decisionAuthority && !AUTHORITIES.includes(s.decisionAuthority)) warn.push(`${p.product}/${s.role}: bad decisionAuthority "${s.decisionAuthority}"`);
    if (s.influence && !INFLUENCES.includes(s.influence)) warn.push(`${p.product}/${s.role}: bad influence "${s.influence}"`);
    if (s.riskLevel && !RISKS.includes(s.riskLevel)) warn.push(`${p.product}/${s.role}: bad riskLevel "${s.riskLevel}"`);
    const input = {
      name: s.role, role: s.role, interests: s.interests ?? [], influence: s.influence ?? null,  // identify by ROLE (no fabricated person names)
      riskLevel: s.riskLevel ?? null, decisionAuthority: s.decisionAuthority ?? null,
      decisionCriteria: s.decisionCriteria ?? [], goals: s.goals ?? [], objections: s.objections ?? [],
      questions: s.openQuestions ?? [], sortOrder: s.sortOrder ?? 0,
    };
    const id = stByRole.get(norm(s.role));
    if (id) { await updateProductStakeholder(id, input, ACTOR); uSt++; puS++; }
    else { await createProductStakeholder(prod.id, input, ACTOR); cSt++; pcS++; }
  }
  const staleSt = (await db().query<{ id: string; role: string }>(
    `SELECT id, role FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL AND updated_by=$2`, [prod.id, ACTOR],
  )).rows.filter((r) => !desiredRoles.has(norm(r.role || '')));
  for (const r of staleSt) { await archiveProductStakeholder(r.id, ACTOR); aSt++; }

  console.log(`══ ${p.product} ══  outcomes +${pcO}/~${puO}${staleOut.length ? ` (archived ${staleOut.length})` : ''} · committee +${pcS}/~${puS}${staleSt.length ? ` (archived ${staleSt.length})` : ''}`);
}

console.log('\n───────────────────────────────────────────────────');
console.log(`  outcomes: ${cOut} created, ${uOut} updated, ${aOut} archived`);
console.log(`  committee: ${cSt} created, ${uSt} updated, ${aSt} archived`);
if (warn.length) { console.log(`  ⚠︎ ${warn.length} enum warning(s):`); for (const w of warn) console.log(`     - ${w}`); }
if (missing.length) console.log(`  ✗ missing products: ${missing.join(', ')}`);
console.log('  Run npm run eval:outcomes-committee to confirm richness + correctness.\n');
process.exit(0);

/**
 * Eval: every product has its full, RICH Business Outcome set + Buying Committee — and the authored source
 * itself meets the quality bar (the eval doubles as content QC). Read-only. Run AFTER seed.
 * Checks, per product: authored data present + product exists; outcomes ≥20 each with description + ≥3
 * indicators; committee ≥10 each with a person name (name≠role), valid influence/risk/authority enums, and
 * ≥10 interests/criteria/goals/objections + ≥15 questions; ≥1 decision_maker; the DB reflects all of it; and
 * NO superseded prior-seed row survives (reconcile worked — e.g. the old ce.vin/rounds.vin roles are gone).
 * Run: npm run eval:outcomes-committee
 */
import 'dotenv/config';
import { db } from './db.js';
import { getOutcomes } from './outcomes.js';
import { getStakeholderRegistry } from './stakeholders.js';
import { recordEvalRun } from './eval-record.js';
import { loadRichSeed, EXPECTED_PRODUCTS, AUTHORITIES, INFLUENCES, RISKS, type ProductRich } from './outcomes-committee-data.js';

const ACTOR = 'outcomes-committee-seed';
const MIN = { outcomes: 20, indicators: 3, committee: 10, interests: 10, criteria: 10, goals: 10, objections: 10, questions: 15 };
const norm = (s: string) => (s || '').trim().toLowerCase();
interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
const ok = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

const seed = loadRichSeed();

for (const name of EXPECTED_PRODUCTS) {
  const p: ProductRich | undefined = seed[name.toLowerCase()];
  if (!p) { ok(`${name}: authored data present`, false, 'no docs/seed/committee file'); continue; }

  const prod = (await db().query<{ id: string }>(`SELECT id FROM products WHERE lower(name)=lower($1) LIMIT 1`, [name])).rows[0];
  if (!prod) { ok(`${name}: product exists`, false, 'not found'); continue; }

  // ── Authored richness (validate the JSON source itself) ──
  const thinOut = p.outcomes.filter((o) => !o.description?.trim() || (o.successIndicators ?? []).filter(Boolean).length < MIN.indicators);
  ok(`${name}: ≥${MIN.outcomes} outcomes, each with description + ≥${MIN.indicators} indicators`,
    p.outcomes.length >= MIN.outcomes && thinOut.length === 0,
    p.outcomes.length < MIN.outcomes ? `only ${p.outcomes.length}` : thinOut.length ? `${thinOut.length} thin: ${thinOut.slice(0, 2).map((o) => o.title).join('; ')}` : `${p.outcomes.length} ok`);

  const thinSt = p.committee.filter((s) =>
    !s.role?.trim() ||
    !INFLUENCES.includes(s.influence) || !RISKS.includes(s.riskLevel) || !AUTHORITIES.includes(s.decisionAuthority) ||
    (s.interests ?? []).length < MIN.interests || (s.decisionCriteria ?? []).length < MIN.criteria ||
    (s.goals ?? []).length < MIN.goals || (s.objections ?? []).length < MIN.objections || (s.openQuestions ?? []).length < MIN.questions);
  ok(`${name}: ≥${MIN.committee} committee, each role-identified with valid enums + full ≥10/≥15 lists`,
    p.committee.length >= MIN.committee && thinSt.length === 0,
    p.committee.length < MIN.committee ? `only ${p.committee.length}` : thinSt.length ? `${thinSt.length} thin: ${thinSt.slice(0, 2).map((s) => s.role).join('; ')}` : `${p.committee.length} ok`);

  ok(`${name}: ≥1 decision_maker`, p.committee.some((s) => s.decisionAuthority === 'decision_maker'),
    p.committee.some((s) => s.decisionAuthority === 'decision_maker') ? 'ok' : 'none');

  // ── DB reflects the authored set (loaded correctly) ──
  const dbOut = await getOutcomes(prod.id);
  const dbOutByTitle = new Map(dbOut.map((o) => [norm(o.title), o]));
  const missOut = p.outcomes.filter((o) => { const d = dbOutByTitle.get(norm(o.title)); return !d || !d.description?.trim() || !d.metric?.trim(); });
  const staleOut = (await db().query<{ title: string }>(
    `SELECT title FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL AND created_by=$2`, [prod.id, ACTOR],
  )).rows.filter((r) => !p.outcomes.some((o) => norm(o.title) === norm(r.title)));
  ok(`${name}: DB outcomes loaded (desc+indicators) with no superseded rows`,
    missOut.length === 0 && staleOut.length === 0,
    missOut.length ? `${missOut.length} missing/thin in DB` : staleOut.length ? `${staleOut.length} stale survive: ${staleOut.slice(0, 2).map((r) => r.title).join('; ')}` : `${dbOut.length} in DB`);

  const reg = await getStakeholderRegistry(prod.id);
  const regByRole = new Map(reg.map((s) => [norm(s.role || ''), s]));
  const missSt = p.committee.filter((s) => {
    const d = regByRole.get(norm(s.role));
    return !d || !AUTHORITIES.includes(d.decisionAuthority || '') ||
      (d.questions ?? []).length < MIN.questions || (d.objections ?? []).length < MIN.objections || (d.interests ?? []).length < MIN.interests;
  });
  const staleSt = (await db().query<{ role: string }>(
    `SELECT role FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL AND updated_by=$2`, [prod.id, ACTOR],
  )).rows.filter((r) => !p.committee.some((s) => norm(s.role) === norm(r.role || '')));
  ok(`${name}: DB committee loaded (role, enums, full lists) with no superseded roles`,
    missSt.length === 0 && staleSt.length === 0,
    missSt.length ? `${missSt.length} missing/thin: ${missSt.slice(0, 2).map((s) => s.role).join('; ')}` : staleSt.length ? `${staleSt.length} stale survive: ${staleSt.slice(0, 3).map((r) => r.role).join('; ')}` : `${reg.length} in DB`);
}

console.log('\n══ Outcomes + Buying Committee eval (rich, per product) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('outcomes-committee', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name), products: EXPECTED_PRODUCTS.length });
process.exit(failed.length ? 1 : 0);

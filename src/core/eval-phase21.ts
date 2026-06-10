/**
 * Phase 21 eval — Unified Experience Model (V5 Guided Experience Platform, Phase 4; NO new migration). Proves
 * assembleExperience(productId) answers the constitution's 13 operator questions FROM PERSISTED DATA, then
 * CLEANS UP every sentinel row:
 *   • shape: returns all 13 questions + the product name (the operator can answer them without reading code).
 *   • honesty + binding: on the bare fixture the chain questions are GAPS; after seeding a real outcome +
 *     committee member (with objections) + journey, room/outcome/journey/concerns FLIP to ok=true and their
 *     summaries reflect the SEEDED data (not fabricated).
 *   • monotonic: modeled-count rises with real data.
 * Run AFTER migrate (no new migration this phase): npm run eval:phase21
 */
import { db } from './db.js';
import { assembleExperience } from './experience.js';
import { createOutcome } from './outcomes.js';
import { createProductStakeholder } from './stakeholders.js';
import { createJourney } from './journeys.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];
let shapeOk = false, flipOk = false, monoOk = false;
let sDetail = 'fixture absent', fDetail = '-', mDetail = '-';

const fix = (await db().query<{ product_id: string }>(`SELECT id AS product_id FROM products WHERE name='eval-phase4-product' LIMIT 1`)).rows[0];

if (fix) {
  const S = 'eval21-sentinel';
  try {
    const bare = await assembleExperience(fix.product_id);
    shapeOk = !!bare && bare.total === 13 && bare.questions.length === 13 && !!bare.productName;
    sDetail = bare ? `total=${bare.total} name=${bare.productName} modeled(bare)=${bare.modeled}` : 'null';
    const bareModeled = bare?.modeled ?? 0;

    await createOutcome(fix.product_id, { title: `${S} reduce delays`, metric: 'avg hours' }, 'eval-phase21');
    await createProductStakeholder(fix.product_id, { name: `${S} CFO`, role: 'CFO', objections: ['too costly'], decisionCriteria: ['ROI'] }, 'eval-phase21');
    await createJourney(fix.product_id, { name: `${S} journey`, storyFlow: [{ kind: 'note', refId: null, caption: 'opening beat' }] }, 'eval-phase21');

    const seeded = await assembleExperience(fix.product_id);
    const byKey: Record<string, { ok: boolean; summary: string }> = Object.fromEntries((seeded?.questions ?? []).map((q) => [q.key, q]));
    flipOk = !!byKey.room?.ok && !!byKey.outcome?.ok && !!byKey.journey?.ok && !!byKey.concerns?.ok
      && byKey.outcome.summary.includes(`${S} reduce delays`) && byKey.room.summary.includes(`${S} CFO`);
    fDetail = `room=${byKey.room?.ok} outcome=${byKey.outcome?.ok}(${byKey.outcome?.summary?.includes(S)}) journey=${byKey.journey?.ok} concerns=${byKey.concerns?.ok}`;
    monoOk = !!seeded && seeded.modeled > bareModeled;
    mDetail = `modeled bare=${bareModeled} seeded=${seeded?.modeled}`;
  } catch (e: any) { sDetail = `error: ${e?.message ?? e}`; }
  finally {
    await db().query(`DELETE FROM journey_events WHERE product_id=$1 AND actor='eval-phase21'`, [fix.product_id]).catch(() => {});
    await db().query(`DELETE FROM journeys WHERE product_id=$1 AND name LIKE $2`, [fix.product_id, `${S}%`]).catch(() => {});
    await db().query(`DELETE FROM outcome_events WHERE product_id=$1 AND actor='eval-phase21'`, [fix.product_id]).catch(() => {});
    await db().query(`DELETE FROM business_outcomes WHERE product_id=$1 AND title LIKE $2`, [fix.product_id, `${S}%`]).catch(() => {});
    await db().query(`DELETE FROM product_stakeholders WHERE product_id=$1 AND name LIKE $2`, [fix.product_id, `${S}%`]).catch(() => {});
  }
}

checks.push({ name: 'assembleExperience returns all 13 operator questions + product name', pass: shapeOk, detail: sDetail });
checks.push({ name: 'seeding real outcome/committee/journey flips room/outcome/journey/concerns to answered (from seeded data)', pass: flipOk, detail: fDetail });
checks.push({ name: 'modeled-count is monotonic with real data (no fabrication)', pass: monoOk, detail: mDetail });

console.log('\n══ Phase 21 eval (Unified Experience Model — the 13 operator questions) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase21', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

/**
 * Phase 10 eval — Knowledge→Graph auto-generation invariants (Phase B). Proves the guarantees that make
 * autogen safe, WITHOUT depending on the live site (that's the manual keystone run): (1) the faithfulness
 * gate REJECTS an unsupported screen and ACCEPTS a supported one — autogen never invents a screen the
 * knowledge doesn't describe; (2) draft-node seeding is IDEMPOTENT (dedupe by lower(intent_label)) and a
 * reused verified node's real selectors are NOT clobbered; (3) the autogen graph is created as DRAFT — it
 * is never auto-activated. The DB mechanics run on the eval-phase4-product TEST FIXTURE and clean up.
 * Run: npm run eval:phase10
 */
import { db } from './db.js';
import { getLlm } from './llm.js';
import { newDraftGraph } from './graph-lifecycle.js';
import { recordEvalRun } from './eval-record.js';

const checks: { name: string; pass: boolean; detail: string }[] = [];

// 1) Faithfulness gate — the anti-invention guarantee (a clear-cut unsupported screen → false; supported → true).
const SRC = 'The product turns recorded continuing-education lectures into quizzes, handouts, and games. Learners earn XP, streaks, and badges. Operators review content in a needs-review queue.';
const llm = getLlm();
const reject = await llm.verifyFaithful({ statement: 'The product has a Spaceship Launch Console where pilots schedule orbital flights.', source: SRC });
const accept = await llm.verifyFaithful({ statement: 'The product has a needs-review queue where operators review content.', source: SRC });
checks.push({ name: 'Faithfulness gate rejects an unsupported screen, accepts a supported one', pass: reject === false && accept === true, detail: `reject=${reject} accept=${accept}` });

// 2 + 3) Draft-graph mechanics on the eval-phase4-product TEST FIXTURE (idempotent seed · don't-clobber · draft-not-active).
let mech = false, mechDetail = 'fixture absent';
const fix = (await db().query<{ product_id: string; env: string | null }>(`
  SELECT p.id AS product_id,
         (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) AS env
    FROM products p WHERE p.name='eval-phase4-product' LIMIT 1`)).rows[0];
if (fix) {
  const NAME = 'eval10-sentinel — autogen';
  try {
    const draftId = await newDraftGraph(fix.product_id, NAME, fix.env, 'eval-phase10');
    const draftStatus = (await db().query<{ s: string }>(`SELECT status s FROM demo_graphs WHERE id=$1`, [draftId])).rows[0]?.s;
    // Seed a node representing a reused verified active screen with a REAL selector — twice (idempotent guard).
    const seed = () => db().query(
      `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, locator_strategies, persona_labels, screen_name, verification_status)
       SELECT $1,'approvals queue','[{"how":"css","value":"#real-approvals"}]'::jsonb,'{}'::jsonb,'Approvals','verified'
        WHERE NOT EXISTS (SELECT 1 FROM demo_graph_nodes WHERE demo_graph_id=$1 AND lower(intent_label)='approvals queue')`, [draftId]);
    await seed(); await seed(); // second insert must be a no-op
    const cnt = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM demo_graph_nodes WHERE demo_graph_id=$1 AND lower(intent_label)='approvals queue'`, [draftId])).rows[0].n);
    const loc = JSON.stringify((await db().query<{ l: any }>(`SELECT locator_strategies l FROM demo_graph_nodes WHERE demo_graph_id=$1 AND lower(intent_label)='approvals queue'`, [draftId])).rows[0]?.l);
    const idempotent = cnt === 1;
    const preserved = loc.includes('#real-approvals'); // the real, hand-tuned selector survived the re-run
    const draftNotActive = draftStatus === 'draft';
    mech = idempotent && preserved && draftNotActive;
    mechDetail = `nodes=${cnt} · selectorPreserved=${preserved} · graphStatus=${draftStatus}`;
    await db().query(`DELETE FROM graph_events WHERE graph_id=$1`, [draftId]);
    await db().query(`DELETE FROM demo_graphs WHERE id=$1`, [draftId]); // cascade-deletes its nodes
  } catch (e: any) {
    await db().query(`DELETE FROM demo_graphs WHERE product_id=$1 AND name=$2`, [fix.product_id, NAME]).catch(() => {});
    mechDetail = `error: ${e?.message ?? e}`;
  }
}
checks.push({ name: 'Draft seeding idempotent · reused selectors not clobbered · graph stays draft', pass: mech, detail: mechDetail });

console.log('\n══ Phase 10 eval (knowledge→graph autogen invariants) ══');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('phase10', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name) });
process.exit(failed.length ? 1 : 0);

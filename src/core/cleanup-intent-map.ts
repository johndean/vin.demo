/**
 * One-time cleanup of the Empirical Intent Registry (navigation_attempts) — removes the BOGUS intent→node rows
 * created by the old force-map bug (graph.ts `|| labels[0]`), where an off-domain request ("capital of france")
 * was mapped to a random screen and recorded as a confident mapping.
 *
 * Method (precise, not heuristic): for each distinct (product, intent) that has a node mapping, re-score the
 * intent through the SAME pickNode the runtime uses, against the product's CURRENT navigable screens. If pickNode
 * returns '' (no screen fits — i.e. off-domain / out of scope), the rows for that intent were force-mapped → delete
 * them. Intents that still resolve to a real screen are KEPT untouched.
 *
 *   npx tsx src/core/cleanup-intent-map.ts            # DRY RUN — prints what it would delete
 *   npx tsx src/core/cleanup-intent-map.ts --apply    # actually delete (gated)
 */
import { db } from './db.js';
import { selectNavigation } from './graph-lifecycle.js';
import { getLlm } from './llm.js';

const APPLY = process.argv.includes('--apply');
const pool = db();
const llm = getLlm();

const rows = (await pool.query<{ product_id: string; intent: string; n: number }>(
  `SELECT product_id, lower(intent) AS intent, count(*)::int AS n
     FROM navigation_attempts
    WHERE intent IS NOT NULL AND node_id IS NOT NULL
    GROUP BY product_id, lower(intent)
    ORDER BY product_id, n DESC`,
)).rows;

const byProd = new Map<string, { intent: string; n: number }[]>();
for (const r of rows) { (byProd.get(r.product_id) ?? byProd.set(r.product_id, []).get(r.product_id)!).push({ intent: r.intent, n: r.n }); }

const toDelete: { pid: string; pname: string; intent: string; n: number }[] = [];
for (const [pid, intents] of byProd) {
  const sel = await selectNavigation(pid, null);
  const labels = sel.candidates.map((c) => c.intent_label);
  const pname = sel.graph?.productName ?? pid;
  if (!labels.length) { console.log(`[skip] ${pname}: no navigable nodes`); continue; }
  for (const it of intents) {
    // pickNode is stochastic — a single '' could be a borderline miss on a VALID intent, and a delete is
    // destructive (all rows for the intent). Require a MAJORITY of 3 samples to return '' before flagging it
    // off-domain. A genuinely off-domain intent ("capital of france") returns '' every time; a valid one won't.
    const votes = await Promise.all([0, 1, 2].map(() => llm.pickNode(it.intent, labels)));
    const empties = votes.filter((v) => !v).length;
    if (empties >= 2) { toDelete.push({ pid, pname, intent: it.intent, n: it.n }); console.log(`OFF-DOMAIN  [${pname}] "${it.intent}"  (${it.n} row${it.n === 1 ? '' : 's'}) → none-fit ${empties}/3 votes, will remove`); }
    else if (empties === 1) console.log(`KEEP (borderline) [${pname}] "${it.intent}" → ${empties}/3 empty; not deleting`);
  }
}

const rowsAffected = toDelete.reduce((s, x) => s + x.n, 0);
console.log(`\n${toDelete.length} off-domain intent(s) across ${new Set(toDelete.map((d) => d.pid)).size} product(s) — ${rowsAffected} navigation_attempts row(s).`);
if (!toDelete.length) { console.log('Registry is clean — nothing to remove.'); process.exit(0); }
if (APPLY) {
  let deleted = 0;
  for (const d of toDelete) deleted += (await pool.query(`DELETE FROM navigation_attempts WHERE product_id=$1 AND lower(intent)=$2`, [d.pid, d.intent])).rowCount ?? 0;
  console.log(`APPLIED — deleted ${deleted} row(s). The registry will rebuild clean from corrected navigation going forward.`);
} else {
  console.log('DRY RUN — re-run with --apply to delete.');
}
process.exit(0);

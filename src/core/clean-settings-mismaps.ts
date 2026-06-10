/**
 * Clean the Empirical Intent Registry of SETTINGS mis-maps — rows where an OPERATIONAL intent was recorded
 * against a configuration/settings screen (the old pickNode keyword-matched "reduce approval delays" →
 * "workflow settings"). With pickNode now grounded to prefer the operational screen, re-score each recorded
 * (intent → settings-node) row; if the improved pickNode now (3-vote majority) resolves it to a DIFFERENT,
 * non-settings screen, the recorded mapping was a mis-map → delete it so the registry re-learns correctly.
 * Rows that genuinely belong to a settings screen (the intent is about configuration) are kept.
 *
 *   npx tsx src/core/clean-settings-mismaps.ts            # DRY RUN
 *   npx tsx src/core/clean-settings-mismaps.ts --apply
 */
import { db } from './db.js';
import { getLlm } from './llm.js';
import { selectNavigation } from './graph-lifecycle.js';

const APPLY = process.argv.includes('--apply');
const pool = db();
const llm = getLlm();
const isSettings = (l: string) => /settings|config/i.test(l);

const rows = (await pool.query<{ product_id: string; intent: string; label: string; n: number }>(
  `SELECT na.product_id, lower(na.intent) AS intent, n.intent_label AS label, count(*)::int AS n
     FROM navigation_attempts na JOIN demo_graph_nodes n ON n.id = na.node_id
    WHERE na.intent IS NOT NULL AND n.archived_at IS NULL
    GROUP BY na.product_id, lower(na.intent), n.intent_label`)).rows;

const byProd = new Map<string, { intent: string; label: string; n: number }[]>();
for (const r of rows) (byProd.get(r.product_id) ?? byProd.set(r.product_id, []).get(r.product_id)!).push({ intent: r.intent, label: r.label, n: r.n });

const toDelete: { pid: string; pname: string; intent: string; label: string; now: string; n: number }[] = [];
for (const [pid, recs] of byProd) {
  const sel = await selectNavigation(pid, null);
  const labels = sel.candidates.map((c) => c.intent_label);
  const pname = sel.graph?.productName ?? pid;
  if (!labels.length) continue;
  for (const rec of recs) {
    if (!isSettings(rec.label)) continue; // only re-examine settings-mapped rows
    const votes = await Promise.all([0, 1, 2].map(() => llm.pickNode(rec.intent, labels)));
    const counts: Record<string, number> = {};
    for (const v of votes) if (v) counts[v] = (counts[v] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2 && top[0].toLowerCase() !== rec.label.toLowerCase() && !isSettings(top[0])) {
      toDelete.push({ pid, pname, intent: rec.intent, label: rec.label, now: top[0], n: rec.n });
      console.log(`MIS-MAP  [${pname}] "${rec.intent}"  was→ "${rec.label}"  now→ "${top[0]}" (${top[1]}/3)  — ${rec.n} row(s), will remove the stale mapping`);
    }
  }
}
console.log(`\n${toDelete.length} settings mis-map(s) — ${toDelete.reduce((s, x) => s + x.n, 0)} row(s).`);
if (!toDelete.length) { console.log('No settings mis-maps — registry clean.'); process.exit(0); }
if (APPLY) {
  let del = 0;
  for (const d of toDelete) del += (await pool.query(`DELETE FROM navigation_attempts na USING demo_graph_nodes n WHERE na.node_id=n.id AND na.product_id=$1 AND lower(na.intent)=$2 AND lower(n.intent_label)=$3`, [d.pid, d.intent, d.label.toLowerCase()])).rowCount ?? 0;
  console.log(`APPLIED — deleted ${del} stale settings-mapped row(s). They re-learn to the operational screen on next navigation (engine redeploy required for the grounded pickNode).`);
} else console.log('DRY RUN — re-run with --apply.');
process.exit(0);

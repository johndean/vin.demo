/**
 * Assemble one journey per (product, outcome) across all real products, gap-free. Idempotent: per product it
 * first archives prior "Assembled — *" journeys and archives stale open gap_records, then re-assembles fresh.
 *   npx tsx src/core/assemble-all.ts            # DRY RUN (counts only; mutates nothing)
 *   npx tsx src/core/assemble-all.ts --apply
 */
import { db } from './db.js';
import { assembleJourney } from './journey-assembler.js';
import { archiveJourney } from './journeys.js';

const APPLY = process.argv.includes('--apply');
const ACTOR = 'zero-gap-assembler';
const pool = db();
const SKIP = new Set(['eval-phase4-product', 'lifecycle-demo']);
const prods = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows.filter(p => !SKIP.has(p.name));

let totalJourneys = 0, totalGaps = 0;
const summary: { product: string; outcomes: number; minConf: number; avgConf: number; gaps: number }[] = [];
for (const p of prods) {
  const outcomes = (await pool.query<{ id: string; title: string }>(`SELECT id, title FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY title`, [p.id])).rows;
  if (APPLY) {
    // clear prior assembled journeys + stale open gaps for a clean regenerate
    const old = (await pool.query<{ id: string }>(`SELECT id FROM journeys WHERE product_id=$1 AND archived_at IS NULL AND name LIKE 'Assembled — %'`, [p.id])).rows;
    for (const j of old) await archiveJourney(j.id, ACTOR);
    await pool.query(`UPDATE gap_records SET archived_at=now(), archived_by=$2 WHERE product_id=$1 AND archived_at IS NULL`, [p.id, ACTOR]);
  }
  const confs: number[] = []; let gaps = 0;
  if (APPLY) {
    for (const o of outcomes) {
      const r = await assembleJourney({ productId: p.id, outcomeId: o.id, organization: 'VIN Demo', industry: null }, ACTOR);
      confs.push(r.confidence); gaps += r.gaps.length; totalJourneys++;
      if (r.gaps.length) console.log(`   ⚠ ${p.name} / "${o.title}" conf=${r.confidence} gaps=${r.gaps.map(g => `${g.kind}:${g.severity}`).join(',')}`);
    }
  }
  totalGaps += gaps;
  const minConf = confs.length ? Math.min(...confs) : 0;
  const avgConf = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
  summary.push({ product: p.name, outcomes: outcomes.length, minConf, avgConf, gaps });
  console.log(`${APPLY ? '✓' : '·'} ${p.name}: ${outcomes.length} outcome(s)${APPLY ? `  avgConf=${avgConf} minConf=${minConf} gaps=${gaps}` : ' (dry)'}`);
}
console.log(`\n=== SUMMARY ===`);
for (const s of summary) console.log(`  ${s.product.padEnd(24)} outcomes=${s.outcomes}  avgConf=${s.avgConf}  minConf=${s.minConf}  openGaps=${s.gaps}`);
console.log(`\n${APPLY ? `APPLIED — ${totalJourneys} journeys assembled, ${totalGaps} open gap(s) total.` : `DRY RUN — would assemble ${prods.reduce((n, p) => n, 0)} products' outcomes.`}`);
process.exit(0);

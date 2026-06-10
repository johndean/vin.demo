/** Functional proof that the validated KB now SERVES (not gated): embed a representative query per product
 *  and run the real retrieval gate. Run: railway run npx tsx src/core/verify-kb.ts */
import { db } from './db.js';
import { retrieveAndGate } from './retrieval.js';

const probes: [string, string][] = [
  ['PO.vin', 'how do I create a new purchase request'],
  ['PO.vin', 'how does approval delegation work'],
  ['PO.vin', 'what does an AMBIGUOUS vendor enrichment status mean'],
  ['expense.vin', 'how do I submit an expense report'],
  ['rounds.vin', 'how does the transcription pipeline work'],
  ['ce.vin', 'what is the CE Course Tool'],
  ['defensive.software', 'what is the command center'],
  ['modelcontract.software', 'how do I create an employment agreement'],
];
console.log('\n══ Retrieval gate probe (validated KB) ══');
for (const [pname, q] of probes) {
  const p = (await db().query<{ id: string }>(`SELECT id FROM products WHERE name=$1 LIMIT 1`, [pname])).rows[0];
  if (!p) { console.log(`  ? ${pname}: not found`); continue; }
  const r = await retrieveAndGate(q, p.id);
  const flag = r.gated ? '⚠️ GATED' : '✅ serves';
  console.log(`  ${flag}  [${pname}] "${q}"\n        band=${r.band} conf=${r.top?.confidence ?? '—'} src="${r.top?.source ?? '—'}" :: "${(r.top?.content ?? '').slice(0, 64)}…"`);
}
process.exit(0);

/**
 * Roll out the knowledge→graph autogen across one or ALL real products, then PUBLISH each (non-regressive:
 * publishGraph carries forward the prior active graph's verified nodes + leaves exactly one active graph).
 * autogen derives screens/workflows from validated knowledge (grounded, faithfulness-gated) and recon-
 * verifies against the real site; publish makes that graph live without losing any recon-verified
 * navigation. Idempotent. Run: railway run npx tsx src/core/graph-rollout.ts [<product>|all] [role]
 */
import 'dotenv/config';
import { db } from './db.js';
import { runAutogen } from './graph-autogen.js';
import { publishGraph } from './graph-lifecycle.js';

const arg = process.argv[2] ?? 'all';
const role = process.argv[3] ?? 'admin';
const actor = 'john@vetvision.org';

const products = arg.toLowerCase() === 'all'
  ? (await db().query<{ name: string }>(`SELECT name FROM products WHERE name NOT LIKE 'eval%' AND name <> 'lifecycle-demo' AND archived_at IS NULL ORDER BY name`)).rows.map((r) => r.name)
  : [arg];

console.log(`\n══ Graph rollout (autogen → verify → publish) — ${products.length} product(s) ══`);
const summary: string[] = [];
for (const p of products) {
  try {
    const s = await runAutogen(p, role, { verify: true });
    await publishGraph(s.draftGraphId, actor);
    const line = `  ✓ ${p.padEnd(24)} ${s.screensKept} screens · ${s.workflowsKept} workflows · ${s.verified} verified / ${s.pending} pending → PUBLISHED`;
    console.log(line); summary.push(line);
  } catch (e: any) {
    const line = `  ✗ ${p.padEnd(24)} ${String(e?.message ?? e)}`;
    console.log(line); summary.push(line);
  }
}
console.log(`\n══ Rollout complete ══`);
summary.forEach((l) => console.log(l));
process.exit(0);

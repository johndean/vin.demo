/**
 * PO.vin coverage eval — proves Knowledge + Demo Graph cover every documented page (zero gaps, 100%) via the
 * shared coverage asserter (coverage-seed.ts). Read-only. Run AFTER seed: npm run eval:povin-coverage
 */
import { assertProductCoverage } from './coverage-seed.js';
import { recordEvalRun } from './eval-record.js';
import { PRODUCT, PAGES, WORKFLOWS, EXTRA_KNOWLEDGE } from './povin-sitemap.js';

const { checks } = await assertProductCoverage({ product: PRODUCT, pages: PAGES, workflows: WORKFLOWS, extraKnowledge: EXTRA_KNOWLEDGE });
console.log(`\n══ ${PRODUCT} coverage eval (Knowledge + Demo Graph — zero gaps) ══`);
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}  (${c.detail})`);
const failed = checks.filter((c) => !c.pass);
console.log('───────────────────────────────────────────────────');
console.log(`  ${checks.length - failed.length}/${checks.length} passed — ${failed.length ? 'FAIL' : 'PASS'}`);
console.log('═══════════════════════════════════════════════════\n');
await recordEvalRun('povin-coverage', checks.length - failed.length, checks.length, { failed: failed.map((c) => c.name), pages: PAGES.length, workflows: WORKFLOWS.length });
process.exit(failed.length ? 1 : 0);

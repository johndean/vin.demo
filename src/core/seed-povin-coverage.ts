/**
 * Seed PO.vin to 100% coverage from its deterministic sitemap (povin-sitemap.ts) via the shared coverage
 * engine (coverage-seed.ts) — one business-facing validated chunk per page + each FAQ + cross-page facts,
 * a graph node per page with its elements + page_facts, and the documented workflows (approved). Idempotent.
 * Run: railway run npm run seed:povin-coverage
 */
import 'dotenv/config';
import { seedProductCoverage } from './coverage-seed.js';
import { PRODUCT, PAGES, WORKFLOWS, EXTRA_KNOWLEDGE } from './povin-sitemap.js';

await seedProductCoverage({ product: PRODUCT, pages: PAGES, workflows: WORKFLOWS, extraKnowledge: EXTRA_KNOWLEDGE }, 'povin-coverage-seed');
console.log(`\n  ${PRODUCT} now covers ${PAGES.length} pages + ${WORKFLOWS.length} workflows across knowledge + graph. Run npm run eval:povin-coverage to confirm 100%.\n`);
process.exit(0);

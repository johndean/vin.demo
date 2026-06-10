/**
 * Seed rounds.vin to 100% coverage from its deterministic sitemap (rounds-sitemap.ts) via the shared
 * coverage engine. Idempotent. Run: railway run npm run seed:rounds-coverage
 */
import 'dotenv/config';
import { seedProductCoverage } from './coverage-seed.js';
import { PRODUCT, PAGES, WORKFLOWS, EXTRA_KNOWLEDGE } from './rounds-sitemap.js';

await seedProductCoverage({ product: PRODUCT, pages: PAGES, workflows: WORKFLOWS, extraKnowledge: EXTRA_KNOWLEDGE }, 'rounds-coverage-seed');
console.log(`\n  ${PRODUCT} now covers ${PAGES.length} pages + ${WORKFLOWS.length} workflows across knowledge + graph. Run npm run eval:rounds-coverage to confirm 100%.\n`);
process.exit(0);

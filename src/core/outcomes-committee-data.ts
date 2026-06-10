/**
 * Rich per-product Business Outcomes + Buying Committee — the shared source of truth for
 * seed-outcomes-committee.ts + eval-outcomes-committee.ts. The content is AUTHORED (per product, grounded in
 * the real product) and lives as reviewable JSON under docs/seed/committee/<product>.<a|b>.json — one file
 * per product-part, schema in docs/seed/committee/_SPEC.md. This module just loads + merges + validates SHAPE.
 *
 * FRAMING (load-bearing): realistic OPERATIONAL stakeholders of SMB/mid-market orgs (BambooHR-style) —
 * owner/operator/manager roles, NOT enterprise-only titles. Every record is product- AND role-specific.
 * The two veterinary-content products are authored to their REAL domain (founder-confirmed 2026-06-10):
 * ce.vin = continuing-education course production; rounds.vin = transcript operations.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));        // …/src/core
export const COMMITTEE_DIR = join(HERE, '..', '..', 'docs', 'seed', 'committee');

// Enums the platform expects (decision_authority is free text in the DB; these are the authoring contract).
export const INFLUENCES = ['high', 'medium', 'low'];
export const RISKS = ['high', 'medium', 'low'];
export const AUTHORITIES = ['decision_maker', 'approver', 'champion', 'influencer', 'evaluator'];
// The 6 products this seed covers (canonical display names; DB lookup is case-insensitive on name).
export const EXPECTED_PRODUCTS = ['PO.vin', 'expense.vin', 'rounds.vin', 'ce.vin', 'modelcontract.software', 'defensive.software'];

export interface RichOutcome { title: string; description: string; successIndicators: string[] }
export interface RichStakeholder {
  name: string; role: string; influence: string; riskLevel: string; decisionAuthority: string; sortOrder: number;
  interests: string[]; decisionCriteria: string[]; goals: string[]; objections: string[]; openQuestions: string[];
}
export interface ProductRich { product: string; outcomes: RichOutcome[]; committee: RichStakeholder[] }

interface FilePart { product?: string; outcomes?: RichOutcome[]; committee?: RichStakeholder[] }
const arr = <T>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : []);

/**
 * Load every docs/seed/committee/*.json part, merge by product (committee concatenated + sorted by sortOrder,
 * outcomes de-duped by title), and return one ProductRich per product keyed by lowercased name.
 * Throws on malformed JSON or a missing "product" field — a bad authoring file must fail loudly, never silently.
 */
export function loadRichSeed(): Record<string, ProductRich> {
  const files = readdirSync(COMMITTEE_DIR).filter((f) => f.endsWith('.json')).sort();
  const byProduct: Record<string, ProductRich> = {};
  for (const f of files) {
    let part: FilePart;
    try { part = JSON.parse(readFileSync(join(COMMITTEE_DIR, f), 'utf8')) as FilePart; }
    catch (e) { throw new Error(`committee seed: ${f} is not valid JSON — ${(e as Error).message}`); }
    const name = (part.product || '').trim();
    if (!name) throw new Error(`committee seed: ${f} is missing a "product" field`);
    const key = name.toLowerCase();
    const acc = (byProduct[key] ||= { product: name, outcomes: [], committee: [] });
    for (const o of arr(part.outcomes)) {
      if (!acc.outcomes.some((x) => x.title.toLowerCase() === o.title.toLowerCase())) acc.outcomes.push(o);
    }
    acc.committee.push(...arr(part.committee));
  }
  for (const p of Object.values(byProduct)) p.committee.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return byProduct;
}

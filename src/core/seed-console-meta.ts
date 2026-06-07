/**
 * Console real-data seed (P2): presentation metadata for the REAL sites the engine targets
 * (mk/color/tagline — real product config, not fabricated metrics), the 3 specialist personas,
 * a touch of department metadata, and the Flowint-label cleanup. Idempotent.
 *   Run: tsx src/core/seed-console-meta.ts
 */
import { db } from './db.js';

// The real products/sites the LangGraph engine demos (matched case-insensitively by name).
const PRODUCT_META: Record<string, { mk: string; color: string; tagline: string }> = {
  'po.vin': { mk: 'PO', color: '#002855', tagline: 'Purchasing & approvals' },
  'expense.vin': { mk: 'EX', color: '#0097A9', tagline: 'Staff expense capture & reimbursement' },
  'ce.vin': { mk: 'CE', color: '#007D61', tagline: 'Continuing-education credits & compliance tracking' },
  'rounds.vin': { mk: 'RD', color: '#4D6995', tagline: 'Case rounds & team discussion boards' },
  'modelcontract.software': { mk: 'MC', color: '#0861CE', tagline: 'Employment-contract builder + embeddable wizard' },
  'defensive.software': { mk: 'DF', color: '#B9975B', tagline: 'Defensible record documentation' },
};

for (const [name, meta] of Object.entries(PRODUCT_META)) {
  const r = await db().query('UPDATE products SET metadata = metadata || $2::jsonb WHERE lower(name) = lower($1)', [name, JSON.stringify(meta)]);
  console.log(`  product ${name}: ${r.rowCount} updated`);
}

const ws = await db().query<{ id: string }>(
  "SELECT w.id FROM workspaces w JOIN organizations o ON o.id = w.org_id WHERE o.name = 'VIN Demo (internal)' AND w.name = 'default' LIMIT 1",
);
const wsId = ws.rows[0]?.id;
if (wsId) {
  const PERSONAS = [
    { name: 'Compliance Specialist', definition: { scope: 'Audit trails, SOC 2, segregation of duties', limits: 'No legal commitments · cites docs only', color: '#4D6995', brand: 'Approved', calls: 0 } },
    { name: 'Integration Engineer', definition: { scope: 'REST API, ERP/SSO/SCIM connectors, webhooks', limits: 'No custom-dev promises', color: '#0097A9', brand: 'Approved', calls: 0 } },
    { name: 'Pricing Specialist', definition: { scope: 'Packaging, volume discounts, ROI framing', limits: 'No binding quotes · ranges only', color: '#B9975B', brand: 'Approved', calls: 0 } },
  ];
  for (const p of PERSONAS) {
    const ex = await db().query('SELECT id FROM personas WHERE workspace_id = $1 AND name = $2', [wsId, p.name]);
    if (ex.rowCount) { console.log(`  persona ${p.name} (exists)`); continue; }
    await db().query('INSERT INTO personas (workspace_id, name, definition) VALUES ($1, $2, $3)', [wsId, p.name, JSON.stringify(p.definition)]);
    console.log(`  + persona ${p.name}`);
  }
  const c = await db().query("UPDATE customers SET metadata = metadata || $1::jsonb WHERE workspace_id = $2 AND metadata->>'seg' IS NULL", [JSON.stringify({ seg: 'Evaluating the VIN product suite' }), wsId]);
  console.log(`  department metadata: ${c.rowCount} updated`);
}

const f = await db().query("UPDATE product_versions SET version_label = btrim(replace(version_label, 'Flowint SSOT', ''), ' ·') WHERE version_label ILIKE '%flowint%'");
console.log(`  Flowint cleaned: ${f.rowCount} version label(s)`);
process.exit(0);

/**
 * READ-ONLY: dump per-product JSON work-files for the gap-closure workflow agents.
 * Writes /tmp/gapwork/<slug>.json with outcomes, active-graph workflows, committee, the exact uncovered
 * high-influence objections, and a validated-knowledge sample (for grounding evidence).
 *   npx tsx src/core/dump-gapwork.ts
 */
import { db } from './db.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const pool = db();
const asArr = (v: any): any[] => (Array.isArray(v) ? v : []);
const norm = (s: any) => (s || '').toLowerCase();
const sig = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w: string) => w.length > 3));
const overlap = (a: string, b: string) => { const A = sig(a); let n = 0; for (const w of sig(b)) if (A.has(w)) n++; return n; };
mkdirSync('/tmp/gapwork', { recursive: true });

const SKIP = new Set(['eval-phase4-product', 'lifecycle-demo']);
const prods = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;
const manifest: { slug: string; name: string; id: string; outcomes: number; workflows: number; uncoveredObjections: number }[] = [];
for (const p of prods) {
  if (SKIP.has(p.name)) continue;
  const slug = p.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const outcomes = (await pool.query<any>(`SELECT id, title, description, metric FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY title`, [p.id])).rows;
  const workflows = (await pool.query<any>(`SELECT w.id, w.workflow_name AS name, w.business_purpose, w.success_criteria, w.node_sequence, w.stakeholder_type, w.business_outcome_id, (w.approved_at IS NOT NULL) AS approved FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND w.archived_at IS NULL ORDER BY w.workflow_name`, [p.id])).rows;
  const committee = (await pool.query<any>(`SELECT id, role, name, influence, objections FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL ORDER BY sort_order, created_at`, [p.id])).rows;
  const knowledge = (await pool.query<any>(`SELECT kc.content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND (kc.lifecycle_state='validated' OR kc.validation_status='validated') ORDER BY kc.confidence DESC`, [p.id])).rows.map(r => r.content);
  const uncovered = committee.filter((c: any) => norm(c.influence) === 'high').map((c: any) => ({ role: c.role || c.name, objection: String(asArr(c.objections)[0] || '') }))
    .filter((x: any) => x.objection && !knowledge.some(k => overlap(x.objection, k) >= 2));
  writeFileSync(`/tmp/gapwork/${slug}.json`, JSON.stringify({
    product: { id: p.id, name: p.name },
    outcomes: outcomes.map((o: any) => ({ id: o.id, title: o.title, description: (o.description || '').slice(0, 400) })),
    workflows: workflows.map((w: any) => ({ id: w.id, name: w.name, purpose: w.business_purpose, nodeSequence: w.node_sequence, stakeholder: w.stakeholder_type, approved: w.approved, currentOutcomeLink: w.business_outcome_id })),
    committee: committee.map((c: any) => ({ role: c.role || c.name, influence: c.influence })),
    uncoveredObjections: uncovered,
    knowledgeSample: knowledge.slice(0, 60).map(k => k.replace(/\s+/g, ' ').slice(0, 360)),
  }, null, 2));
  manifest.push({ slug, name: p.name, id: p.id, outcomes: outcomes.length, workflows: workflows.length, uncoveredObjections: uncovered.length });
}
writeFileSync('/tmp/gapwork/_manifest.json', JSON.stringify(manifest, null, 2));
console.log('Wrote per-product work-files to /tmp/gapwork/:');
for (const m of manifest) console.log(`  ${m.slug}.json  (${m.name}) — ${m.outcomes} outcomes, ${m.workflows} workflows, ${m.uncoveredObjections} uncovered objection(s)`);
process.exit(0);

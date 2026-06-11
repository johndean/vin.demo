/**
 * READ-ONLY cross-product GAP MATRIX. Replicates the Journey Assembler's gap logic offline (no writes) so we
 * can see, per product × outcome, exactly which gaps the assembler WOULD emit — the precise work-list for
 * "zero gaps for all outcomes". Also reports workspace, personas-in-workspace, environments, existing journeys.
 *   npx tsx src/core/gap-matrix.ts
 */
import { db } from './db.js';
const pool = db();
const asArr = (v: any): any[] => (Array.isArray(v) ? v : []);
const norm = (s: string | null | undefined) => (s || '').toLowerCase();
const sigWords = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const overlap = (a: string, b: string): number => { const A = sigWords(a); let n = 0; for (const w of sigWords(b)) if (A.has(w)) n++; return n; };

const SKIP = new Set(['eval-phase4-product', 'lifecycle-demo']);
const prods = (await pool.query<{ id: string; name: string; workspace_id: string }>(`SELECT id, name, workspace_id FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;

let grandGaps = 0, grandOutcomes = 0;
for (const p of prods) {
  if (SKIP.has(p.name)) continue;
  const outcomes = (await pool.query<any>(`SELECT id, title, description, metric, baseline, target FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY title`, [p.id])).rows;
  const committee = (await pool.query<any>(`SELECT id, name, role, influence, decision_authority, objections, decision_criteria FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL ORDER BY sort_order, created_at`, [p.id])).rows;
  const workflows = (await pool.query<any>(`SELECT w.id, w.workflow_name AS name, w.business_purpose, w.success_criteria, w.business_outcome_id, w.stakeholder_type, (w.approved_at IS NOT NULL) AS approved FROM demo_graph_workflows w JOIN demo_graphs g ON g.id=w.demo_graph_id WHERE g.product_id=$1 AND g.status='active' AND w.archived_at IS NULL`, [p.id])).rows;
  const knowledge = (await pool.query<any>(`SELECT kc.id, kc.content, kc.confidence FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND (kc.lifecycle_state='validated' OR kc.validation_status='validated')`, [p.id])).rows;
  const personas = (await pool.query<any>(`SELECT id, name, definition FROM personas WHERE workspace_id=$1 AND archived_at IS NULL`, [p.workspace_id])).rows;
  const envs = (await pool.query<any>(`SELECT id, name, readiness_state, certification_status FROM environments WHERE product_id=$1 AND archived_at IS NULL`, [p.id])).rows;
  const env = envs.find((e) => norm(e.readiness_state) === 'ready' || norm(e.certification_status) === 'certified') ?? envs[0] ?? null;
  const journeys = (await pool.query<any>(`SELECT id, name, status FROM journeys WHERE product_id=$1 AND archived_at IS NULL`, [p.id])).rows;
  const openGaps = (await pool.query<{ n: string }>(`SELECT count(*) n FROM gap_records WHERE product_id=$1 AND status='open' AND archived_at IS NULL`, [p.id])).rows[0].n;

  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`### ${p.name}  ws=${p.workspace_id.slice(0,8)}  | outcomes=${outcomes.length} committee=${committee.length} workflows=${workflows.length} (linked=${workflows.filter(w=>w.business_outcome_id).length}) validKnowledge=${knowledge.length} personas(ws)=${personas.length} journeys=${journeys.length} openGaps=${openGaps}`);
  console.log(`    env: ${env ? `"${env.name}" ready=${env.readiness_state||'—'} cert=${env.certification_status||'—'}` : 'NONE'}`);
  const hiObj = committee.filter((c)=>norm(c.influence)==='high').map((c)=>({role:c.role||c.name, top:String(asArr(c.objections)[0]||'')})).filter(x=>x.top);
  console.log(`    high-influence committee w/ objections: ${hiObj.length ? hiObj.map(h=>h.role).join(', ') : '(none high-influence or no objections)'}`);

  // per-product structural gaps
  const struct: string[] = [];
  if (!knowledge.length) struct.push('knowledge/BLOCKS: no validated knowledge');
  if (!committee.length) struct.push('committee/BLOCKS: no committee');
  if (!env) struct.push('environment/weakens: no env');
  else if (norm(env.readiness_state)!=='ready' && norm(env.certification_status)!=='certified') struct.push(`environment/weakens: not ready/certified`);
  if (!personas.length) struct.push('persona/weakens: no personas in workspace');
  // NOTE: assembler currently reads personas.expertise (missing col) → always sees 0 personas → persona gap ALWAYS fires
  if (struct.length) console.log(`    STRUCTURAL: ${struct.join(' | ')}`);

  // per-outcome gaps (the core)
  const outcomeText = (o:any)=>`${o.title} ${o.description??''} ${o.metric??''}`;
  let prodGaps = struct.length; // structural gaps repeat per outcome but count once for sizing the unique work
  console.log(`    PER-OUTCOME workflow coverage:`);
  for (const o of outcomes) {
    grandOutcomes++;
    const ot = outcomeText(o);
    const linked = workflows.filter(w=>w.business_outcome_id===o.id);
    const matched = workflows.filter(w=>overlap(ot, `${w.name} ${w.business_purpose??''}`)>=2);
    const wfForOutcome = workflows.filter(w=>w.business_outcome_id===o.id || overlap(ot,`${w.name} ${w.business_purpose??''}`)>=2);
    const noWfGap = workflows.length && !wfForOutcome.length;
    const noMetricGap = !o.metric && !o.target;
    // high-influence objection evidence
    const objGaps = committee.filter(c=>norm(c.influence)==='high').map(c=>{ const top=String(asArr(c.objections)[0]||''); return {role:c.role||c.name, top, covered: !top || knowledge.some(k=>overlap(top,k.content)>=2)};}).filter(x=>x.top && !x.covered);
    const flags = [
      noWfGap ? 'NO-WF' : (linked.length?`linked(${linked.length})`:`matched(${matched.length})`),
      noMetricGap ? 'NO-METRIC/TARGET' : '',
      objGaps.length ? `obj-uncovered(${objGaps.length})` : '',
    ].filter(Boolean);
    if (noWfGap) prodGaps++;
    if (noMetricGap) prodGaps++;
    prodGaps += objGaps.length;
    console.log(`      • "${o.title.slice(0,52)}"  ${flags.join('  ')}`);
  }
  grandGaps += prodGaps;
  console.log(`    → approx unique gaps to close for this product: ${prodGaps}`);
}
console.log(`\n══════════════════════════════════════════════════════════════════════`);
console.log(`TOTALS: ${grandOutcomes} outcomes across real products; ~${grandGaps} gap-instances to close (excl. the always-on persona-query bug).`);
console.log(`NOTE: assembler reads personas.expertise (column absent) → persona gap fires for EVERY outcome until the discovery is fixed.`);
process.exit(0);

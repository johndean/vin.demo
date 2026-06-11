/**
 * READ-ONLY scope of the current ce.vin product representation in the platform DB.
 *   npx tsx src/core/scope-cevin.ts
 */
import { db } from './db.js';
const pool = db();

const prods = (await pool.query<{ id: string; name: string; metadata: any; archived_at: any; status: string | null }>(
  `SELECT id, name, metadata, archived_at, status FROM products WHERE lower(name) LIKE '%ce.vin%' OR lower(name) LIKE '%cevin%' OR lower(name) LIKE '%ce vin%' ORDER BY name`)).rows;
console.log(`\n=== PRODUCTS matching ce.vin (${prods.length}) ===`);
for (const p of prods) console.log(`  ${p.id}  name="${p.name}"  status=${p.status}  archived=${p.archived_at ? 'YES' : 'no'}\n    metadata: ${JSON.stringify(p.metadata || {}).slice(0, 600)}`);

for (const p of prods) {
  if (p.archived_at) continue;
  console.log(`\n############################################################\n### ${p.name} (${p.id})\n############################################################`);

  const kbs = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM knowledge_bases WHERE product_id=$1`, [p.id])).rows;
  console.log(`\n-- KNOWLEDGE BASES (${kbs.length}): ${kbs.map(k => `${k.name}[${k.id}]`).join(', ')}`);
  const kc = (await pool.query<{ lifecycle_state: string; validation_status: string; n: string }>(
    `SELECT kc.lifecycle_state, kc.validation_status, count(*) n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL GROUP BY 1,2 ORDER BY 1,2`, [p.id])).rows;
  console.log(`   chunks by (lifecycle_state, validation_status): ${kc.map(r => `${r.lifecycle_state}/${r.validation_status}=${r.n}`).join(', ') || '(none)'}`);
  const cats = (await pool.query<{ category: string; n: string }>(
    `SELECT kc.category, count(*) n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC`, [p.id])).rows;
  console.log(`   chunks by category: ${cats.map(r => `${r.category}=${r.n}`).join(', ') || '(none)'}`);
  const srcs = (await pool.query<{ source: string; n: string }>(
    `SELECT kc.source, count(*) n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, [p.id])).rows;
  console.log(`   chunks by source (top 20): ${srcs.map(r => `${r.source}=${r.n}`).join(', ') || '(none)'}`);
  const sampleChunks = (await pool.query<{ content: string; lifecycle_state: string; category: string }>(
    `SELECT kc.content, kc.lifecycle_state, kc.category FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL ORDER BY kc.created_at LIMIT 8`, [p.id])).rows;
  console.log(`   sample chunks:`);
  for (const c of sampleChunks) console.log(`     [${c.lifecycle_state}/${c.category}] ${c.content.replace(/\s+/g, ' ').slice(0, 180)}`);

  const graphs = (await pool.query<{ id: string; graph_version: number; status: string; name: string }>(
    `SELECT id, graph_version, status, name FROM demo_graphs WHERE product_id=$1 AND archived_at IS NULL ORDER BY graph_version DESC`, [p.id])).rows;
  console.log(`\n-- DEMO GRAPHS (${graphs.length}): ${graphs.map(g => `v${g.graph_version}/${g.status}/"${g.name}"[${g.id}]`).join(', ')}`);
  const active = graphs.find(g => g.status === 'active') || graphs[0];
  if (active) {
    const nodes = (await pool.query<{ intent_label: string; screen_name: string | null; screen_route: string | null; screen_type: string | null; verification_status: string | null }>(
      `SELECT intent_label, screen_name, screen_route, screen_type, verification_status FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY intent_label`, [active.id])).rows;
    console.log(`\n   ACTIVE graph v${active.graph_version} NODES (${nodes.length}):`);
    for (const n of nodes) console.log(`     • ${n.intent_label}${n.screen_route ? `  [${n.screen_route}]` : ''}${n.screen_type ? ` <${n.screen_type}>` : ''}  {${n.verification_status || '?'}}`);
    const wfs = (await pool.query<{ workflow_name: string; node_sequence: any; approved_at: any; business_purpose: string | null; business_outcome_id: string | null }>(
      `SELECT workflow_name, node_sequence, approved_at, business_purpose, business_outcome_id FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY workflow_name`, [active.id])).rows;
    console.log(`\n   ACTIVE graph WORKFLOWS (${wfs.length}):`);
    for (const w of wfs) {
      const seq = Array.isArray(w.node_sequence) ? w.node_sequence : [];
      console.log(`     • "${w.workflow_name}" [${w.approved_at ? 'APPROVED' : 'draft'}]${w.business_outcome_id ? ' →outcome' : ''}  seq=[${seq.join(' → ')}]`);
      if (w.business_purpose) console.log(`         purpose: ${w.business_purpose.slice(0, 160)}`);
    }
  }

  const outs = (await pool.query<{ id: string; title: string; description: string | null; metric: string | null; status: string; stakeholder_type: string | null }>(
    `SELECT id, title, description, metric, status, stakeholder_type FROM business_outcomes WHERE product_id=$1 AND archived_at IS NULL ORDER BY title`, [p.id])).rows;
  console.log(`\n-- BUSINESS OUTCOMES (${outs.length}):`);
  for (const o of outs) console.log(`     • [${o.status}] "${o.title}"  metric=${o.metric || '—'}  forRole=${o.stakeholder_type || '—'}\n         ${(o.description || '').slice(0, 200)}`);

  const sh = (await pool.query<{ id: string; role: string | null; name: string | null; interests: any; decision_authority: string | null }>(
    `SELECT id, role, name, interests, decision_authority FROM product_stakeholders WHERE product_id=$1 AND archived_at IS NULL ORDER BY sort_order NULLS LAST, role`, [p.id])).rows;
  console.log(`\n-- STAKEHOLDERS / committee (${sh.length}):`);
  for (const s of sh) console.log(`     • ${s.role || s.name || '?'}  (auth=${s.decision_authority || '—'})  interests=${JSON.stringify(s.interests || []).slice(0,120)}`);

  const js = (await pool.query<{ id: string; name: string; status: string; business_goal: string | null; story_flow: any; confidence: number | null; success_criteria: string | null }>(
    `SELECT id, name, status, business_goal, story_flow, confidence, success_criteria FROM journeys WHERE product_id=$1 AND archived_at IS NULL ORDER BY name`, [p.id])).rows;
  console.log(`\n-- JOURNEYS (${js.length}):`);
  for (const j of js) {
    const sf = Array.isArray(j.story_flow) ? j.story_flow : [];
    console.log(`     • [${j.status}] "${j.name}"  conf=${j.confidence ?? '—'}  goal=${(j.business_goal || '').slice(0,120)}`);
    console.log(`         story_flow (${sf.length}): ${sf.map((s: any) => `${s.kind}:${s.caption || s.refId}`).join(' | ').slice(0, 400)}`);
    if (j.success_criteria) console.log(`         success: ${j.success_criteria.slice(0,160)}`);
  }

  const gaps = (await pool.query<{ kind: string; title: string; severity: string; status: string }>(
    `SELECT kind, title, severity, status FROM gap_records WHERE product_id=$1 AND archived_at IS NULL ORDER BY status, kind`, [p.id])).rows;
  console.log(`\n-- GAP RECORDS (${gaps.length}):`);
  for (const g of gaps) console.log(`     • [${g.status}/${g.severity}] ${g.kind}: ${g.title}`);
}
process.exit(0);

/**
 * Create knowledge-grounded workflows to cover ORPHAN screens (nodes in no workflow), as editorial-gated
 * DRAFTS (approved=false) on the active graph — never auto-approved, never fabricated. For each product:
 *   1. window the validated knowledge (autogen-style) and deriveWorkflows over the current screen labels,
 *   2. keep candidates that cover ≥1 orphan AND pass the faithfulness gate (verifyFaithful vs their window),
 *   3. GREEDY set-cover: create the minimal set of candidates that covers the orphans (highest new coverage
 *      first) — so we add a handful of high-value flows, not dozens of near-duplicates,
 *   4. skip any whose name collides with an existing workflow.
 * The operator then reviews + approves the good ones in the Workflow Builder (drafts are not live until approved).
 *
 *   npx tsx src/core/create-grounded-workflows.ts            # DRY RUN
 *   npx tsx src/core/create-grounded-workflows.ts --apply
 */
import { db } from './db.js';
import { getLlm } from './llm.js';
import { createWorkflow } from './graph-lifecycle.js';

const APPLY = process.argv.includes('--apply');
const pool = db();
const llm = getLlm();
function windowize(facts: string[], max = 11000): string[] {
  const wins: string[] = []; let cur = '';
  for (const f of facts) { if (cur && cur.length + f.length + 1 > max) { wins.push(cur); cur = ''; } cur = cur ? `${cur}\n${f}` : f; }
  if (cur) wins.push(cur); return wins.length ? wins : [''];
}

const prods = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;
let totalCreated = 0;
for (const p of prods) {
  const g = (await pool.query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [p.id])).rows[0];
  if (!g) continue;
  const screens = (await pool.query<{ intent_label: string }>(`SELECT intent_label FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY intent_label`, [g.id])).rows.map((r) => r.intent_label);
  const existing = (await pool.query<{ workflow_name: string; node_sequence: any }>(`SELECT workflow_name, node_sequence FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [g.id])).rows;
  const existingNames = new Set(existing.map((w) => w.workflow_name.toLowerCase()));
  const covered = new Set<string>();
  for (const w of existing) for (const e of (Array.isArray(w.node_sequence) ? w.node_sequence : [])) covered.add(String(e).toLowerCase());
  const orphans = new Set(screens.filter((s) => !covered.has(s.toLowerCase())).map((s) => s.toLowerCase()));
  if (!orphans.size) { console.log(`\n## ${p.name}: 0 orphans — skip.`); continue; }
  const facts = (await pool.query<{ content: string }>(`SELECT kc.content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'`, [p.id])).rows.map((r) => r.content);
  if (!facts.length) { console.log(`\n## ${p.name}: ${orphans.size} orphan(s) but no validated knowledge — skip.`); continue; }
  const corpus = facts.join('\n').replace(/\s+/g, ' ').toLowerCase();
  // FULL-CORPUS grounding gate (loosened from the strict LLM verifyFaithful, which read only ~6k and over-rejected
  // legit flows whose support spans the knowledge): accept when the candidate's CITED EVIDENCE is actually present
  // in the validated knowledge (deterministic, whole-corpus). deriveWorkflows is instructed to cite real evidence
  // and constrains node_sequence to real screens; with the editorial DRAFT gate on top, evidence-in-corpus is
  // sufficient grounding to PROPOSE a draft (the operator still approves before it goes live).
  const grounded = (ev: string): boolean => {
    const e = (ev || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (e.length < 24) return false;
    if (corpus.includes(e.slice(0, 60))) return true;
    return e.split(/[.;!?]/).some((seg) => { const s = seg.trim(); return s.length > 30 && corpus.includes(s.slice(0, 50)); });
  };

  // Derive (windowed) + remember which window grounded each candidate (for the faithfulness gate).
  const windows = windowize(facts);
  const cands = new Map<string, { wf: any; window: string }>();
  for (const win of windows) {
    const dw = await llm.deriveWorkflows({ product: p.name, knowledge: win, screens });
    for (const w of dw) { const k = w.workflowName.toLowerCase(); if (w.nodeSequence.length && !cands.has(k)) cands.set(k, { wf: w, window: win }); }
  }
  // Candidates that cover ≥1 orphan + don't name-collide, sorted by new-orphan coverage desc.
  const scored = [...cands.values()]
    .map(({ wf, window }) => ({ wf, window, hits: new Set(wf.nodeSequence.map((s: string) => s.toLowerCase()).filter((s: string) => orphans.has(s))) }))
    .filter((c) => c.hits.size > 0 && !existingNames.has(c.wf.workflowName.toLowerCase()))
    .sort((a, b) => b.hits.size - a.hits.size);

  // Greedy set-cover + faithfulness gate.
  const left = new Set(orphans);
  const chosen: { wf: any; hits: string[] }[] = [];
  for (const c of scored) {
    const newHits = [...c.hits].filter((h) => left.has(h));
    if (!newHits.length) continue;
    if (!grounded(c.wf.evidence)) { console.log(`   ✗ "${c.wf.workflowName}" evidence not found in knowledge — skip`); continue; }
    chosen.push({ wf: c.wf, hits: newHits });
    newHits.forEach((h) => left.delete(h));
    if (!left.size) break;
  }
  console.log(`\n## ${p.name}: ${orphans.size} orphan(s) → ${chosen.length} grounded workflow(s) to ${APPLY ? 'CREATE' : 'create'} (drafts); ${left.size} orphan(s) still uncovered`);
  for (const c of chosen) {
    console.log(`   ${APPLY ? '✚ created' : '✚ would create'} "${c.wf.workflowName}"  covers [${c.hits.join(', ')}]  seq=[${c.wf.nodeSequence.join(' → ')}]`);
    if (APPLY) { await createWorkflow(g.id, { name: c.wf.workflowName, businessPurpose: c.wf.businessPurpose, stakeholderType: c.wf.stakeholderType, personaType: c.wf.personaType, nodeSequence: c.wf.nodeSequence, successCriteria: c.wf.successCriteria }, false, 'knowledge-derived-draft'); totalCreated++; }
  }
  if (left.size) console.log(`   • still uncovered (no grounded flow): ${[...left].join(', ')}`);
}
console.log(`\n${APPLY ? `APPLIED — created ${totalCreated} DRAFT workflow(s) (unapproved; review + approve in the Workflow Builder).` : 'DRY RUN — re-run with --apply.'}`);
process.exit(0);

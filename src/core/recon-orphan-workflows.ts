/**
 * RECON: are "orphan" screens (nodes in no workflow) actually part of a workflow the VALIDATED KNOWLEDGE
 * describes? For each product, re-derive workflows STRICTLY from its validated knowledge (the same grounded,
 * zero-hallucination llm.deriveWorkflows autogen uses) over ALL current screen labels, then report which
 * currently-orphan screens those knowledge-grounded workflows would cover (with evidence) vs which are residual
 * (knowledge puts them in no journey → genuinely standalone). This validates the hypothesis "if a screen has
 * UX it's probably in a workflow" against the source of truth — no fabrication, derivation only. Report-only.
 *
 *   npx tsx src/core/recon-orphan-workflows.ts
 */
import { db } from './db.js';
import { getLlm } from './llm.js';

const pool = db();
const llm = getLlm();
const prods = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;

for (const p of prods) {
  const g = (await pool.query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [p.id])).rows[0];
  if (!g) continue;
  const screens = (await pool.query<{ intent_label: string }>(`SELECT intent_label FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY intent_label`, [g.id])).rows.map((r) => r.intent_label);
  const wfs = (await pool.query<{ node_sequence: any }>(`SELECT node_sequence FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [g.id])).rows;
  const covered = new Set<string>();
  for (const w of wfs) for (const e of (Array.isArray(w.node_sequence) ? w.node_sequence : [])) covered.add(String(e).toLowerCase());
  const orphans = screens.filter((s) => !covered.has(s.toLowerCase()));
  if (!orphans.length) { console.log(`\n## ${p.name}: 0 orphans — fully covered.`); continue; }

  const facts = (await pool.query<{ content: string }>(
    `SELECT kc.content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id
      WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'`, [p.id])).rows.map((r) => r.content);
  if (!facts.length) { console.log(`\n## ${p.name}: ${orphans.length} orphan(s) but NO validated knowledge — cannot validate.`); continue; }
  const corpus = facts.join('\n');
  const candidates = await llm.deriveWorkflows({ product: p.name, knowledge: corpus, screens });

  const candCovered = new Set<string>();
  const orphanWfs: { name: string; seq: string[]; hits: string[]; evidence: string }[] = [];
  for (const c of candidates) {
    const seqLower = c.nodeSequence.map((s) => s.toLowerCase());
    const hits = orphans.filter((o) => seqLower.includes(o.toLowerCase()));
    if (hits.length) { hits.forEach((h) => candCovered.add(h.toLowerCase())); orphanWfs.push({ name: c.workflowName, seq: c.nodeSequence, hits, evidence: c.evidence }); }
  }
  const residual = orphans.filter((o) => !candCovered.has(o.toLowerCase()));
  console.log(`\n## ${p.name}: ${orphans.length} orphan(s) · ${facts.length} facts · ${candidates.length} knowledge-grounded workflow(s) derived`);
  console.log(`   → ${candCovered.size} orphan(s) BELONG to a knowledge-described workflow · ${residual.length} residual (no journey in knowledge)`);
  for (const ow of orphanWfs) {
    console.log(`   ✚ "${ow.name}"  covers orphan(s): [${ow.hits.join(', ')}]`);
    console.log(`        seq: ${ow.seq.join(' → ')}`);
    console.log(`        evidence: ${(ow.evidence || '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  if (residual.length) console.log(`   • residual standalone (knowledge describes no journey through these): ${residual.join(', ')}`);
}
process.exit(0);

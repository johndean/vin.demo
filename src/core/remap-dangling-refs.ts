/**
 * Remediate DANGLING workflow→node references: a workflow node_sequence entry whose label matches no active
 * node (hand-authored labels like rounds.vin "transcript editor" vs the node "editor"). For each dangling ref,
 * resolve the best real node via the SAME pickNode the runtime uses (the ref IS a screen description), taking a
 * 3-sample MAJORITY for confidence. Confident matches are remapped (node_sequence rewritten + step captions
 * re-keyed) through the audited updateWorkflow; a ref with NO confident node is left + flagged (the screen is
 * genuinely missing — create the node or remove the step in the Workflow Builder).
 *
 *   npx tsx src/core/remap-dangling-refs.ts            # DRY RUN — prints proposed remaps
 *   npx tsx src/core/remap-dangling-refs.ts --apply    # apply (audited via updateWorkflow)
 */
import { db } from './db.js';
import { getLlm } from './llm.js';
import { updateWorkflow } from './graph-lifecycle.js';

const APPLY = process.argv.includes('--apply');
const pool = db();
const llm = getLlm();

const prods = (await pool.query<{ id: string; name: string }>(`SELECT id, name FROM products WHERE archived_at IS NULL ORDER BY name`)).rows;
let applied = 0, flagged = 0, remapped = 0;

for (const p of prods) {
  const g = (await pool.query<{ id: string }>(`SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [p.id])).rows[0];
  if (!g) continue;
  const nodeLabels = (await pool.query<{ intent_label: string }>(`SELECT intent_label FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL ORDER BY intent_label`, [g.id])).rows.map((r) => r.intent_label);
  const nodeSet = new Set(nodeLabels.map((l) => l.toLowerCase()));
  const wfs = (await pool.query<any>(`SELECT id, workflow_name, business_purpose, stakeholder_type, persona_type, success_criteria, sort_order, node_sequence, step_script FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [g.id])).rows;

  const dangling = new Set<string>();
  for (const w of wfs) for (const e of (Array.isArray(w.node_sequence) ? w.node_sequence : [])) if (!nodeSet.has(String(e).toLowerCase())) dangling.add(String(e));
  if (!dangling.size) continue;

  console.log(`\n## ${p.name} — ${dangling.size} distinct dangling ref(s)`);
  const remap = new Map<string, string>(); // lower(ref) -> canonical node label
  for (const ref of dangling) {
    const votes = await Promise.all([0, 1, 2].map(() => llm.pickNode(ref, nodeLabels)));
    const counts: Record<string, number> = {};
    for (const v of votes) if (v) counts[v] = (counts[v] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const tgt = top?.[0];
    // Guard: never remap a FUNCTIONAL action onto a "settings *" config tab (pickNode keyword-matches e.g.
    // "export transcript" → "settings export"). That points a demo at config, not the feature — hold it.
    const settingsMismatch = !!tgt && tgt.toLowerCase().startsWith('settings') && !ref.toLowerCase().includes('settings');
    if (top && top[1] >= 2 && !settingsMismatch) { remap.set(ref.toLowerCase(), tgt!); console.log(`  REMAP  "${ref}" → "${tgt}"  (${top[1]}/3)`); }
    else if (settingsMismatch) { flagged++; console.log(`  HOLD   "${ref}" → "${tgt}" is a SETTINGS tab, not the functional screen — likely belongs to the editor or is a missing node; left for manual`); }
    else { flagged++; console.log(`  FLAG   "${ref}"  → no confident node (votes: ${JSON.stringify(votes)}) — screen likely MISSING; fix manually`); }
  }
  if (!remap.size) continue;

  for (const w of wfs) {
    const seq: string[] = Array.isArray(w.node_sequence) ? w.node_sequence.map(String) : [];
    if (!seq.some((e) => remap.has(e.toLowerCase()))) continue;
    // Remap each entry, then collapse consecutive duplicates (a sub-step like "upload receipt" remapping onto
    // its parent "new report" must not produce a doubled step).
    const newSeq = seq.map((e) => remap.get(e.toLowerCase()) ?? e).filter((e, i, a) => i === 0 || e.toLowerCase() !== a[i - 1].toLowerCase());
    const script: Record<string, string> = (w.step_script && typeof w.step_script === 'object') ? { ...w.step_script } : {};
    for (const [oldL, newL] of remap) {
      const k = Object.keys(script).find((kk) => kk.toLowerCase() === oldL);
      if (k && k.toLowerCase() !== newL.toLowerCase()) { script[newL] = script[k]; delete script[k]; }
    }
    console.log(`  ${APPLY ? 'UPDATED' : 'would update'} "${w.workflow_name}": [${seq.join(', ')}] → [${newSeq.join(', ')}]`);
    remapped++;
    if (APPLY) { await updateWorkflow(w.id, { name: w.workflow_name, businessPurpose: w.business_purpose, stakeholderType: w.stakeholder_type, personaType: w.persona_type, successCriteria: w.success_criteria, nodeSequence: newSeq, stepScript: script, sortOrder: w.sort_order }, 'remap-dangling-refs'); applied++; }
  }
}
console.log(`\n${APPLY ? `APPLIED — updated ${applied} workflow(s).` : `DRY RUN — would update ${remapped} workflow(s).`}  ${flagged} ref(s) flagged (no confident node — manual).`);
process.exit(0);

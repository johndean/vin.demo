/**
 * Knowledge → Demo Graph auto-generation (Phase B, the keystone). Reads a product's VALIDATED knowledge
 * (the curated facts), derives candidate SCREENS + WORKFLOWS STRICTLY grounded in that knowledge (reusing
 * the harvest faithfulness discipline — llm.deriveScreens/deriveWorkflows + llm.verifyFaithful — so it
 * NEVER invents a screen the knowledge doesn't describe), and seeds them as DRAFT on a new DRAFT graph
 * (the live ACTIVE graph is untouched). Where a derived screen overlaps a verified ACTIVE-graph node, it
 * REUSES that node's real, hand-tuned selectors + route and inherits 'verified' (never clobbers it).
 * Finally it RECON-VERIFIES the remaining draft nodes against the REAL site via the same adapter/gotoNode
 * the live loop uses — a node becomes 'verified' only when the real DOM resolves it; otherwise it stays
 * 'pending_review'. Idempotent; nothing is live until the draft graph is published.
 *
 * Exported as runAutogen so the engine /graph endpoint can call it; CLI-runnable for the npm script.
 * Run: railway run npx tsx src/core/graph-autogen.ts "<product>" [role]   (NO_VERIFY=1 skips the live drive)
 */
import 'dotenv/config';
import { db } from './db.js';
import { getLlm, type DerivedScreen, type DerivedWorkflow } from './llm.js';
import { getAdapter, type DemoNode } from './driver.js';
import type { ExecutionMode } from './safety.js';
import { newDraftGraph, recordGraphEvent, verifyNode } from './graph-lifecycle.js';
import { upsertNodeElements, assemblePageFacts } from './graph-elements.js';

/** Pack facts into ≤max-char windows so the WHOLE knowledge base is seen by the LLM (no silent 12k-char
 *  truncation). Each window is gated independently — a large KB contributes its full surface, not just the head. */
function windowize(facts: string[], max = 11000): string[] {
  const wins: string[] = [];
  let cur = '';
  for (const f of facts) {
    if (cur && cur.length + f.length + 1 > max) { wins.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${f}` : f;
  }
  if (cur) wins.push(cur);
  return wins.length ? wins : [''];
}

export interface AutogenSummary {
  product: string; facts: number; screensDerived: number; screensKept: number;
  workflowsKept: number; draftGraphId: string; nodesSeeded: number; reused: number;
  elementsSeeded: number; verified: number; pending: number; log: string[];
}

export async function runAutogen(productName: string, role = 'admin', opts: { verify?: boolean } = {}): Promise<AutogenSummary> {
  const VERIFY = opts.verify ?? true;
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(s); };

  const prod = (await db().query<{ id: string; name: string; env: string | null }>(`
    SELECT p.id, p.name,
           (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) env
      FROM products p WHERE lower(p.name)=lower($1) LIMIT 1`, [productName])).rows[0];
  if (!prod) throw new Error(`product "${productName}" not found`);

  // Load VALIDATED knowledge (the curated facts) — the ONLY source for derivation.
  const factRows = (await db().query<{ id: string; content: string }>(`
    SELECT kc.id, kc.content FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id
     WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'
     ORDER BY kc.confidence DESC NULLS LAST, kc.created_at LIMIT 2000`, [prod.id])).rows;
  const facts = factRows.map((r) => r.content);
  if (!facts.length) throw new Error(`no validated knowledge for ${prod.name} — nothing to derive from`);
  const corpus = facts.join('\n');
  // Best-effort PROVENANCE link: tie a derived node back to the validated chunk that grounds it. A hit is a
  // real containment match (the evidence sentence is in a chunk, or vice-versa); no match → null ("not recorded").
  const matchChunk = (evidence?: string): string | null => {
    const ev = (evidence ?? '').trim(); if (ev.length < 8) return null;
    return factRows.find((f) => f.content.includes(ev) || ev.includes(f.content.slice(0, 60)))?.id ?? null;
  };
  say(`\n══ Graph autogen: ${prod.name} — ${facts.length} validated facts ══`);

  const llm = getLlm();

  // WINDOW the corpus (no silent truncation) — derive screens per window, union by label. This de-caps the
  // old single 12k-char / 12-screen pass: a large KB now contributes its WHOLE surface, not just the head.
  const windows = windowize(facts);
  const screenByLabel = new Map<string, { screen: DerivedScreen; window: string }>();
  for (const win of windows) {
    const ds = await llm.deriveScreens({ product: prod.name, knowledge: win });
    for (const s of ds) { const k = s.intentLabel.toLowerCase(); if (!screenByLabel.has(k)) screenByLabel.set(k, { screen: s, window: win }); }
  }
  const derived = [...screenByLabel.values()].map((x) => x.screen);
  // Faithfulness-gate each against the WINDOW it was derived from (so its grounding evidence is in scope).
  const keptScreens: DerivedScreen[] = [];
  for (const { screen: s, window } of screenByLabel.values()) {
    const ok = await llm.verifyFaithful({ statement: `${s.screenName} — ${s.evidence}`, source: window });
    if (ok) keptScreens.push(s); else say(`  ✗ screen rejected (unfaithful): "${s.screenName}"`);
  }
  say(`  screens: ${derived.length} derived (across ${windows.length} window(s)) · ${keptScreens.length} faithful`);

  // Derive workflows over the kept labels, per window, union by name + gate against the window.
  const labels = keptScreens.map((s) => s.intentLabel);
  const wfByName = new Map<string, { wf: DerivedWorkflow; window: string }>();
  for (const win of windows) {
    const dw = await llm.deriveWorkflows({ product: prod.name, knowledge: win, screens: labels });
    for (const w of dw) { const k = w.workflowName.toLowerCase(); if (w.nodeSequence.length && !wfByName.has(k)) wfByName.set(k, { wf: w, window: win }); }
  }
  const keptWf: DerivedWorkflow[] = [];
  for (const { wf: w, window } of wfByName.values()) {
    const ok = await llm.verifyFaithful({ statement: `"${w.workflowName}": ${w.businessPurpose}. ${w.evidence}`, source: window });
    if (ok) keptWf.push(w); else say(`  ✗ workflow rejected (unfaithful): "${w.workflowName}"`);
  }
  say(`  workflows: ${wfByName.size} derived · ${keptWf.length} faithful`);

  // Ensure a DRAFT graph (reuse an existing autogen draft → idempotent re-runs).
  const AUTONAME = `${prod.name} — autogen`;
  let draftId = (await db().query<{ id: string }>(
    `SELECT id FROM demo_graphs WHERE product_id=$1 AND name=$2 AND status='draft' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [prod.id, AUTONAME])).rows[0]?.id;
  if (!draftId) draftId = await newDraftGraph(prod.id, AUTONAME, prod.env, 'graph-autogen');
  say(`  draft graph: ${draftId} ("${AUTONAME}")`);

  // Verified ACTIVE-graph nodes (real, hand-tuned selectors) to REUSE for overlapping screens.
  const activeNodes = (await db().query<{ intent_label: string; screen_route: string | null; locator_strategies: any; persona_labels: any }>(`
    SELECT n.intent_label, n.screen_route, n.locator_strategies, n.persona_labels
      FROM demo_graph_nodes n JOIN demo_graphs g ON g.id=n.demo_graph_id
     WHERE g.product_id=$1 AND g.status='active' AND g.archived_at IS NULL AND n.verification_status='verified' AND n.archived_at IS NULL`, [prod.id])).rows;
  const activeByLabel = new Map(activeNodes.map((n) => [n.intent_label.toLowerCase(), n]));

  // Seed screens as nodes (dedupe by lower(intent_label)). Overlap with a verified active node → reuse its
  // real selectors/route + inherit 'verified'; else → draft with a text locator (no invented route). For
  // EVERY kept screen (new or already-present), derive its ELEMENTS (buttons/actions/fields) + rebuild
  // page_facts — closing the granularity ceiling so an autogen graph carries the page surface, not just routes.
  let seeded = 0, reused = 0, elementsSeeded = 0;
  for (const s of keptScreens) {
    const existingNode = (await db().query<{ id: string }>(`SELECT id FROM demo_graph_nodes WHERE demo_graph_id=$1 AND lower(intent_label)=lower($2) AND archived_at IS NULL LIMIT 1`, [draftId, s.intentLabel])).rows[0];
    const srcChunk = matchChunk(s.evidence);
    let nodeId: string;
    if (existingNode) {
      nodeId = existingNode.id;
    } else {
      const match = activeByLabel.get(s.intentLabel.toLowerCase());
      const route = match?.screen_route ?? null;
      const locators = match?.locator_strategies ?? [{ how: 'text', value: '{label}' }];
      const persona = match?.persona_labels ?? {};
      const vstatus = match ? 'verified' : 'draft';
      const ins = (await db().query<{ id: string }>(
        `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels, screen_name, screen_type, verification_status, last_verified, derived_evidence, source_chunk_id, verification_source, created_by, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,${match ? 'now()' : 'NULL'},$9,$10,$11,'graph-autogen',now()) RETURNING id`,
        [draftId, s.intentLabel, route, JSON.stringify(locators), JSON.stringify(persona), s.screenName, s.screenType, vstatus, s.evidence ?? null, srcChunk, match ? 'active-node' : null])).rows[0];
      await recordGraphEvent('create', { graphId: draftId, nodeId: ins.id, productId: prod.id, actor: 'graph-autogen',
        after: { intent_label: s.intentLabel, screen_name: s.screenName, verification_status: vstatus, reused_active: !!match, source_chunk_id: srcChunk } });
      nodeId = ins.id; seeded++; if (match) reused++;
    }
    // Derive + seed this screen's ELEMENTS (grounded in its evidence + the corpus), then rebuild page_facts. Best-effort.
    try {
      const els = await llm.deriveScreenElements({ product: prod.name, screenName: s.screenName, screenType: s.screenType, evidence: s.evidence, knowledge: corpus });
      if (els.length) {
        await upsertNodeElements(nodeId, els.map((e, i) => ({ elementType: e.elementType, label: e.label, detail: e.description ? { description: e.description } : {}, sortOrder: i, sourceChunkId: srcChunk })), 'graph-autogen');
        elementsSeeded += els.length;
      }
      await assemblePageFacts(nodeId, { purpose: s.evidence, screenType: s.screenType }, 'graph-autogen');
    } catch (e: any) { say(`  (elements skipped for "${s.intentLabel}": ${e?.message ?? e})`); }
  }
  say(`  nodes: ${seeded} seeded (${reused} reused verified active selectors) · ${elementsSeeded} element(s) derived`);

  // Seed workflows (dedupe by workflow_name).
  let wfSeeded = 0;
  for (const w of keptWf) {
    const exists = (await db().query(`SELECT 1 FROM demo_graph_workflows WHERE demo_graph_id=$1 AND lower(workflow_name)=lower($2) AND archived_at IS NULL`, [draftId, w.workflowName])).rowCount;
    if (exists) continue;
    const ins = (await db().query<{ id: string }>(
      `INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, business_purpose, stakeholder_type, persona_type, node_sequence, success_criteria, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'draft') RETURNING id`,
      [draftId, w.workflowName, w.businessPurpose, w.stakeholderType, w.personaType, JSON.stringify(w.nodeSequence), w.successCriteria])).rows[0];
    await recordGraphEvent('create', { graphId: draftId, workflowId: ins.id, productId: prod.id, actor: 'graph-autogen',
      after: { workflow_name: w.workflowName, persona_type: w.personaType, stakeholder_type: w.stakeholderType, node_sequence: w.nodeSequence } });
    wfSeeded++;
  }
  say(`  workflows: ${wfSeeded} seeded`);

  // Recon-verify the draft/pending nodes against the REAL site (evidence-based). ok → verified; not
  // confirmed → pending_review. Best-effort: if the adapter/site is unavailable, the draft graph still stands.
  let verified = 0, pending = 0;
  if (VERIFY) {
    const draftNodes = (await db().query<{ id: string; intent_label: string; screen_route: string | null; locator_strategies: any; persona_labels: any }>(`
      SELECT id, intent_label, screen_route, locator_strategies, persona_labels FROM demo_graph_nodes
       WHERE demo_graph_id=$1 AND verification_status IN ('draft','pending_review')`, [draftId])).rows;
    if (draftNodes.length) {
      try {
        const adapter = await getAdapter(prod.name, 'read-only' as ExecutionMode);
        await adapter.open(role);
        for (const n of draftNodes) {
          const node: DemoNode = { intent_label: n.intent_label, screen_route: n.screen_route, locator_strategies: Array.isArray(n.locator_strategies) ? n.locator_strategies : [], persona_labels: n.persona_labels ?? {} };
          const r = await verifyNode(adapter, node, role);
          const status = r.ok ? 'verified' : 'pending_review';
          await db().query(`UPDATE demo_graph_nodes SET verification_status=$2, last_verified=now(), verification_source='autogen-recon' WHERE id=$1`, [n.id, status]);
          await recordGraphEvent('verify', { graphId: draftId, nodeId: n.id, productId: prod.id, actor: 'graph-autogen', after: { verification_status: status, url: r.url } });
          if (r.ok) verified++; else pending++;
          say(`    ${r.ok ? '✅ verified' : '⏳ pending'}: "${n.intent_label}"`);
        }
        await adapter.close().catch(() => {});
      } catch (e: any) {
        say(`  (recon-verify skipped — adapter/site unavailable: ${e?.message ?? e})`);
      }
      say(`  recon-verify: ${verified} verified · ${pending} pending_review`);
    }
  } else {
    say('  (verify skipped — nodes left draft)');
  }

  say(`\n  Draft graph "${AUTONAME}" ready for review. Nothing is live until you publish it.`);
  return { product: prod.name, facts: facts.length, screensDerived: derived.length, screensKept: keptScreens.length, workflowsKept: keptWf.length, draftGraphId: draftId, nodesSeeded: seeded, reused, elementsSeeded, verified, pending, log };
}

// ── CLI (npm run graph:autogen -- <product> [role]) ──
if (process.argv[1] && process.argv[1].includes('graph-autogen')) {
  const productName = process.argv[2];
  const role = process.argv[3] ?? 'admin';
  if (!productName) { console.error('usage: graph-autogen.ts <product> [role]'); process.exit(1); }
  runAutogen(productName, role, { verify: process.env.NO_VERIFY !== '1' })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}

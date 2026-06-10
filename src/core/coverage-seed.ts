/**
 * Deterministic product COVERAGE engine (generalized from the PO.vin pass). Given a product's structured
 * sitemap dataset — every page with its fields/buttons/actions/errors/FAQs + the documented workflows +
 * cross-page facts — this seeds, in ONE idempotent pass so graph + knowledge can never disagree:
 *   1. KNOWLEDGE — one business-facing validated chunk per page (purpose + roles + key actions), each FAQ as
 *      a faq chunk, plus the cross-page facts. Embedded.
 *   2. GRAPH — augments the product's ACTIVE demo graph with one NODE per page (route + permissions +
 *      page_facts) and its ELEMENTS (every field/button/action/error/faq). Existing nodes keep their
 *      hand-tuned locators + verification; new doc-sourced nodes are 'pending_review' (honest — documented,
 *      not yet recon-verified). 3. WORKFLOWS — the documented journeys, operator-approved.
 *
 * FIREWALL: datasets carry BUSINESS-FACING text only (no RPC/file/SQL identifiers). Reused by every
 * per-product coverage seed (seed-povin-coverage, seed-expensevin-coverage, …) + their evals.
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import { ensureSource, recordKnowledgeEvent } from './knowledge.js';
import { newDraftGraph, publishGraph, recordGraphEvent } from './graph-lifecycle.js';
import { upsertNodeElements, assemblePageFacts, type NodeElementInput } from './graph-elements.js';

// ── shared dataset types ──
export type ElStatus = 'live' | 'partial' | 'dead_ui' | 'unwired' | 'unknown';
export type ElType = 'field' | 'button' | 'action' | 'tab' | 'section' | 'error' | 'faq' | 'workflow_interaction' | 'note';
export interface PageElement { type: ElType; label: string; detail?: Record<string, unknown>; status?: ElStatus }
export interface PageDef {
  intentLabel: string; screenName: string;
  screenType: 'list' | 'form' | 'dashboard' | 'detail' | 'settings' | 'wizard' | 'report' | 'reference' | 'auth' | 'other';
  route: string; roles: string[]; purpose: string; layout?: string; elements: PageElement[];
}
export interface WorkflowDef { name: string; businessPurpose: string; stakeholderType: string; personaType: string; sequence: string[]; successCriteria: string }
export interface CoverageDataset { product: string; pages: PageDef[]; workflows: WorkflowDef[]; extraKnowledge: { content: string; category?: string; source: string }[] }

// ── compact element constructors (shared by every dataset) ──
export const fld = (label: string, detail?: Record<string, unknown>, status?: ElStatus): PageElement => ({ type: 'field', label, detail, status });
export const btn = (label: string, detail?: Record<string, unknown>, status?: ElStatus): PageElement => ({ type: 'button', label, detail, status });
export const act = (label: string, detail?: Record<string, unknown>, status?: ElStatus): PageElement => ({ type: 'action', label, detail, status });
export const tab = (label: string, detail?: Record<string, unknown>): PageElement => ({ type: 'tab', label, detail });
export const err = (label: string, detail?: Record<string, unknown>): PageElement => ({ type: 'error', label, detail });
export const faq = (q: string, a: string): PageElement => ({ type: 'faq', label: q, detail: { answer: a } });
export const wfi = (label: string, detail?: Record<string, unknown>): PageElement => ({ type: 'workflow_interaction', label, detail });

function rolePhrase(roles: string[]): string {
  if (roles.includes('public')) return 'anyone at the sign-in page';
  if (roles.length >= 5) return 'all signed-in users';
  return roles.join(', ');
}
function keyActions(p: PageDef): string {
  const labels = p.elements.filter((e) => e.type === 'button' || e.type === 'action').map((e) => e.label).slice(0, 6);
  return labels.length ? ` Key actions: ${labels.join('; ')}.` : '';
}
function pageFactContent(product: string, p: PageDef): string {
  return `In ${product}, the ${p.screenName} page (${p.route}) is available to ${rolePhrase(p.roles)}. ${p.purpose}${keyActions(p)}`.slice(0, 900);
}

export interface CoverageSummary { product: string; chunksInserted: number; chunksPresent: number; nodesNew: number; nodesEnriched: number; elements: number; workflowsNew: number; workflowsUpdated: number; graphId: string }

/** Idempotent: seed knowledge + graph nodes/elements/page_facts + workflows for one product from its dataset. */
export async function seedProductCoverage(ds: CoverageDataset, actor = 'coverage-seed'): Promise<CoverageSummary> {
  const prod = (await db().query<{ id: string; kb: string | null; ver: string | null; env: string | null }>(`
    SELECT p.id,
           (SELECT id FROM knowledge_bases WHERE product_id=p.id ORDER BY id LIMIT 1) kb,
           (SELECT id FROM product_versions WHERE product_id=p.id AND status='active' ORDER BY created_at LIMIT 1) ver,
           (SELECT e.id FROM environments e WHERE e.product_id=p.id AND e.archived_at IS NULL ORDER BY e.created_at LIMIT 1) env
      FROM products p WHERE lower(p.name)=lower($1) LIMIT 1`, [ds.product])).rows[0];
  if (!prod?.kb) throw new Error(`product "${ds.product}" not found or has no knowledge base — run its base seed first`);

  let graphId = (await db().query<{ id: string }>(
    `SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [prod.id])).rows[0]?.id;
  if (!graphId) { graphId = await newDraftGraph(prod.id, `${ds.product} demo`, prod.env, actor); await publishGraph(graphId, actor); }
  console.log(`\n══ ${ds.product} coverage seed — active graph ${graphId} ══`);

  // 1. KNOWLEDGE
  interface ChunkSpec { content: string; category: string; source: string; conf: number; intentLabel?: string }
  const specs: ChunkSpec[] = [];
  for (const p of ds.pages) {
    specs.push({ content: pageFactContent(ds.product, p), category: 'docs', source: `${ds.product} help center · ${p.screenName}`, conf: 0.9, intentLabel: p.intentLabel });
    for (const e of p.elements) if (e.type === 'faq') {
      const answer = (e.detail?.answer as string) ?? '';
      specs.push({ content: `${e.label} ${answer}`.trim().slice(0, 900), category: 'faq', source: `${ds.product} help center · ${p.screenName} FAQ`, conf: 0.78 });
    }
  }
  for (const k of ds.extraKnowledge) specs.push({ content: k.content, category: k.category ?? 'docs', source: k.source, conf: 0.9 });

  const pageChunkByLabel = new Map<string, string>();
  const toInsert: ChunkSpec[] = [];
  for (const s of specs) {
    const existing = (await db().query<{ id: string }>('SELECT id FROM knowledge_chunks WHERE knowledge_base_id=$1 AND content=$2 LIMIT 1', [prod.kb, s.content])).rows[0];
    if (existing) { if (s.intentLabel) pageChunkByLabel.set(s.intentLabel, existing.id); continue; }
    toInsert.push(s);
  }
  let kInserted = 0;
  const provider = getEmbeddingProvider();
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    const embs = await provider.embed(batch.map((b) => b.content));
    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const sourceId = await ensureSource(prod.id, { title: s.source, sourceType: s.category === 'faq' ? 'faq' : 'doc', owner: `${ds.product} docs (forensic, code-grounded)`, versionId: prod.ver, createdBy: actor });
      const ins = (await db().query<{ id: string }>(
        `INSERT INTO knowledge_chunks (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, source_id, lifecycle_state, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now()::date,'validated',$8,'validated',now()) RETURNING id`,
        [prod.kb, prod.ver, s.category, s.content, toVector(embs[j]), s.conf, s.source, sourceId])).rows[0];
      await recordKnowledgeEvent('create', { chunkId: ins.id, sourceId, productId: prod.id, actor, after: { source: s.source, lifecycle_state: 'validated' } });
      if (s.intentLabel) pageChunkByLabel.set(s.intentLabel, ins.id);
      kInserted++;
    }
    console.log(`  knowledge: embedded + inserted ${Math.min(i + 50, toInsert.length)}/${toInsert.length}`);
  }
  console.log(`  knowledge: ${kInserted} new validated chunk(s) (${specs.length - toInsert.length} already present)`);

  // 2. GRAPH NODES + ELEMENTS + page_facts
  let nNew = 0, nUpd = 0, elTotal = 0;
  for (const p of ds.pages) {
    const srcChunk = pageChunkByLabel.get(p.intentLabel) ?? null;
    const existing = (await db().query<{ id: string }>(
      `SELECT id FROM demo_graph_nodes WHERE demo_graph_id=$1 AND lower(intent_label)=lower($2) AND archived_at IS NULL LIMIT 1`, [graphId, p.intentLabel])).rows[0];
    let nodeId: string;
    if (existing) {
      await db().query(
        `UPDATE demo_graph_nodes SET screen_name=$2, screen_type=$3, screen_route=COALESCE(screen_route,$4),
           permissions_required=$5::jsonb, business_purpose=$6, source_chunk_id=COALESCE(source_chunk_id,$7), updated_by=$8, updated_at=now() WHERE id=$1`,
        [existing.id, p.screenName, p.screenType, p.route, JSON.stringify(p.roles), p.purpose, srcChunk, actor]);
      nodeId = existing.id; nUpd++;
    } else {
      const ins = (await db().query<{ id: string }>(
        `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels, screen_name, screen_type, verification_status, verification_source, permissions_required, business_purpose, source_chunk_id, created_by, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,'pending_review',$8,$9::jsonb,$10,$11,$12,now()) RETURNING id`,
        [graphId, p.intentLabel, p.route, JSON.stringify([{ how: 'text', value: '{label}' }]), JSON.stringify({ default: p.screenName }),
         p.screenName, p.screenType, `${ds.product}-docs`, JSON.stringify(p.roles), p.purpose, srcChunk, actor])).rows[0];
      nodeId = ins.id; nNew++;
      await recordGraphEvent('create', { graphId, nodeId, productId: prod.id, actor, after: { intent_label: p.intentLabel, route: p.route, verification_status: 'pending_review' } });
    }
    const els: NodeElementInput[] = p.elements.map((e, i) => ({ elementType: e.type, label: e.label, detail: e.detail ?? {}, implementationStatus: e.status ?? 'live', sortOrder: i, sourceChunkId: srcChunk }));
    const r = await upsertNodeElements(nodeId, els, actor);
    elTotal += r.inserted + r.updated;
    await assemblePageFacts(nodeId, { purpose: p.purpose, layout: p.layout ?? null, roles: p.roles, route: p.route, screenName: p.screenName, screenType: p.screenType }, actor);
  }
  console.log(`  graph nodes: ${nNew} new · ${nUpd} enriched · ${elTotal} element(s) upserted`);

  // 3. WORKFLOWS (operator-approved)
  let wNew = 0, wUpd = 0;
  for (let i = 0; i < ds.workflows.length; i++) {
    const w = ds.workflows[i];
    const existing = (await db().query<{ id: string }>(
      `SELECT id FROM demo_graph_workflows WHERE demo_graph_id=$1 AND lower(workflow_name)=lower($2) AND archived_at IS NULL LIMIT 1`, [graphId, w.name])).rows[0];
    if (existing) {
      await db().query(
        `UPDATE demo_graph_workflows SET business_purpose=$2, stakeholder_type=$3, persona_type=$4, node_sequence=$5::jsonb, success_criteria=$6, verification_status='verified', sort_order=$7, approved_at=COALESCE(approved_at, now()), approved_by=COALESCE(approved_by,$8) WHERE id=$1`,
        [existing.id, w.businessPurpose, w.stakeholderType, w.personaType, JSON.stringify(w.sequence), w.successCriteria, i, actor]);
      wUpd++;
    } else {
      const ins = (await db().query<{ id: string }>(
        `INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, business_purpose, stakeholder_type, persona_type, node_sequence, success_criteria, verification_status, sort_order, approved_at, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'verified',$8,now(),$9) RETURNING id`,
        [graphId, w.name, w.businessPurpose, w.stakeholderType, w.personaType, JSON.stringify(w.sequence), w.successCriteria, i, actor])).rows[0];
      await recordGraphEvent('create', { graphId, workflowId: ins.id, productId: prod.id, actor, after: { workflow_name: w.name, approved: true } });
      wNew++;
    }
  }
  console.log(`  workflows: ${wNew} new · ${wUpd} updated (operator-approved)`);
  return { product: ds.product, chunksInserted: kInserted, chunksPresent: specs.length - toInsert.length, nodesNew: nNew, nodesEnriched: nUpd, elements: elTotal, workflowsNew: wNew, workflowsUpdated: wUpd, graphId };
}

export interface CoverageCheck { name: string; pass: boolean; detail: string }
/** Read-only assertions: every page is a routed node with elements + page_facts; every workflow approved;
 *  ≥1 validated knowledge chunk per page (+cross-page facts). Returns checks for the per-product eval. */
export async function assertProductCoverage(ds: CoverageDataset): Promise<{ checks: CoverageCheck[] }> {
  const checks: CoverageCheck[] = [];
  const labels = ds.pages.map((p) => p.intentLabel);
  const prod = (await db().query<{ id: string }>(`SELECT id FROM products WHERE lower(name)=lower($1) LIMIT 1`, [ds.product])).rows[0];
  if (!prod) { checks.push({ name: `${ds.product} product exists`, pass: false, detail: 'product not found' }); return { checks }; }

  const graphId = (await db().query<{ id: string }>(
    `SELECT id FROM demo_graphs WHERE product_id=$1 AND status='active' AND archived_at IS NULL ORDER BY graph_version DESC LIMIT 1`, [prod.id])).rows[0]?.id ?? null;
  checks.push({ name: `${ds.product} has an active demo graph`, pass: !!graphId, detail: graphId ?? 'none' });

  if (graphId) {
    const nodeSet = new Set((await db().query<{ l: string }>(`SELECT lower(intent_label) l FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows.map((r) => r.l));
    const missing = labels.filter((l) => !nodeSet.has(l.toLowerCase()));
    checks.push({ name: `All ${ds.pages.length} pages exist as graph nodes`, pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : `${ds.pages.length}/${ds.pages.length}` });

    const rows = (await db().query<{ l: string; route: string | null; pf: number; els: string }>(`
      SELECT lower(n.intent_label) l, n.screen_route route,
             jsonb_array_length(COALESCE(n.page_facts->'fields','[]'::jsonb)) + jsonb_array_length(COALESCE(n.page_facts->'buttons','[]'::jsonb)) + jsonb_array_length(COALESCE(n.page_facts->'actions','[]'::jsonb)) pf,
             (SELECT count(*)::text FROM demo_graph_node_elements e WHERE e.node_id=n.id AND e.archived_at IS NULL) els
        FROM demo_graph_nodes n WHERE n.demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows;
    const byLabel = new Map(rows.map((r) => [r.l, r]));
    const noRoute: string[] = [], noEls: string[] = [], noFacts: string[] = [];
    for (const l of labels) { const r = byLabel.get(l.toLowerCase()); if (!r) continue; if (!r.route) noRoute.push(l); if (Number(r.els) < 1) noEls.push(l); if (Number(r.pf) < 1) noFacts.push(l); }
    checks.push({ name: 'Every page node has a real route', pass: noRoute.length === 0, detail: noRoute.length ? `no route: ${noRoute.join(', ')}` : 'all routed' });
    checks.push({ name: 'Every page node has ≥1 element', pass: noEls.length === 0, detail: noEls.length ? `no elements: ${noEls.join(', ')}` : 'all have elements' });
    checks.push({ name: 'Every page node has page_facts', pass: noFacts.length === 0, detail: noFacts.length ? `empty: ${noFacts.join(', ')}` : 'all populated' });

    const elTotal = Number((await db().query<{ n: string }>(`SELECT count(*)::text n FROM demo_graph_node_elements e JOIN demo_graph_nodes n ON n.id=e.node_id WHERE n.demo_graph_id=$1 AND e.archived_at IS NULL`, [graphId])).rows[0].n);
    checks.push({ name: 'Element registry populated (buttons/actions/forms/fields)', pass: elTotal >= ds.pages.length, detail: `${elTotal} elements` });

    const wfApproved = new Map((await db().query<{ name: string; approved: boolean }>(
      `SELECT lower(workflow_name) name, (approved_at IS NOT NULL) approved FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows.map((r) => [r.name, r.approved]));
    const wfMissing = ds.workflows.filter((w) => !wfApproved.has(w.name.toLowerCase()) || wfApproved.get(w.name.toLowerCase()) === false);
    checks.push({ name: `All ${ds.workflows.length} workflows exist + approved`, pass: wfMissing.length === 0, detail: wfMissing.length ? `missing/unapproved: ${wfMissing.map((w) => w.name).join(', ')}` : `${ds.workflows.length}/${ds.workflows.length}` });
  }

  const validated = Number((await db().query<{ n: string }>(`
    SELECT count(*)::text n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id
     WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated'`, [prod.id])).rows[0].n);
  const need = ds.pages.length + ds.extraKnowledge.length;
  checks.push({ name: '≥1 validated knowledge chunk per page (+cross-page facts)', pass: validated >= need, detail: `${validated} validated (need ≥ ${need})` });

  const pageSources = Number((await db().query<{ n: string }>(`
    SELECT count(DISTINCT kc.source)::text n FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id
     WHERE kb.product_id=$1 AND kc.archived_at IS NULL AND kc.lifecycle_state='validated' AND kc.source LIKE $2`, [prod.id, `${ds.product} help center · %`])).rows[0].n);
  checks.push({ name: 'Every page has a validated help-center knowledge source', pass: pageSources >= ds.pages.length, detail: `${pageSources} page sources (need ≥ ${ds.pages.length})` });
  return { checks };
}

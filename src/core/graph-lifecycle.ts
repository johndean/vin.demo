/**
 * Demo Graph lifecycle + mutation audit (Phase A). Mirrors lifecycle.ts (product versioning) and
 * knowledge.ts (recordKnowledgeEvent / archiveChunk) so graphs are governed exactly like product
 * versions and knowledge chunks: edit = a new DRAFT version, publish flips it active and DEPRECATES the
 * prior active one, delete = soft-archive (never hard-delete), and every mutation is audited. Writes to
 * graph_events are BEST-EFFORT (try/catch) — a logging failure must never break a publish or a seed.
 * A graph is identified by (product_id, name); graph_version is the version axis (UNIQUE per migration 0013).
 */
import { db } from './db.js';
import type { InteractionAdapter, DemoNode, LocatorStrategy } from './driver.js'; // type-only — importing this module must NOT load Playwright

export type GraphStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type NodeVerification = 'draft' | 'pending_review' | 'verified' | 'broken';
export type GraphAction = 'create' | 'edit' | 'validate' | 'verify' | 'drift' | 'deprecate' | 'archive' | 'publish';

export interface GraphEvent {
  graphId?: string | null;
  nodeId?: string | null;
  workflowId?: string | null;
  productId?: string | null;
  actor?: string;
  before?: unknown;
  after?: unknown;
}

/** Record a graph MUTATION (create/edit/validate/verify/drift/deprecate/archive/publish) to the audit
 *  trail. Best-effort — a write failure logs but never throws into the caller (mirrors recordKnowledgeEvent). */
export async function recordGraphEvent(action: GraphAction, e: GraphEvent): Promise<void> {
  try {
    await db().query(
      `INSERT INTO graph_events (graph_id, node_id, workflow_id, product_id, action, actor, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
      [e.graphId ?? null, e.nodeId ?? null, e.workflowId ?? null, e.productId ?? null, action, e.actor ?? 'system',
       e.before != null ? JSON.stringify(e.before) : null, e.after != null ? JSON.stringify(e.after) : null],
    );
  } catch (err) { console.error('[graph] recordGraphEvent failed (best-effort):', err); }
}

// ── Navigation telemetry (Phase 2) — one row per navigation attempt from either engine, recorded against
// the node it targets. Best-effort (never throws into the caller — same posture as recordGraphEvent). The
// table (0019) backs Node Studio Diagnostics now + the success-rate / intent→node registry in Phase 3. ──
export type NavSource = 'path-a' | 'agent-step';
export interface NavAttempt {
  nodeId?: string | null; graphId?: string | null; sessionId?: string | null; productId?: string | null;
  intent?: string | null; url?: string | null; ok?: boolean | null; healedVia?: string | null;
  selectorUsed?: string | null; source: NavSource;
}
export async function recordNavAttempt(a: NavAttempt): Promise<void> {
  try {
    await db().query(
      `INSERT INTO navigation_attempts (node_id, demo_graph_id, demo_session_id, product_id, intent, url, ok, healed_via, selector_used, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.nodeId ?? null, a.graphId ?? null, a.sessionId ?? null, a.productId ?? null,
       a.intent ?? null, a.url ?? null, a.ok ?? null, a.healedVia ?? null, a.selectorUsed ?? null, a.source],
    );
  } catch (err) { console.error('[graph] recordNavAttempt failed (best-effort):', err); }
}

// RC-31: client-nav DRIFT DETECTION. A client-driven nav (graph.ts driveTo, state.clientNav) records its
// SELECTION with ok=NULL because the server never observes the live DOM. The desktop's LiveBrowser DOES
// observe the resulting URL after it performs the nav; when it reports that URL back here we turn the
// ignorant ok=NULL into a REAL outcome and surface divergence. ok = the landed URL contains the expected
// screen_route (host-relative) OR matches the expected node label/host; diverged = there WAS an expectation
// (route or label) and the landing didn't satisfy it → the live route drifted from the verified graph.
// Best-effort: this never throws into the caller (mirrors recordNavAttempt) and, on divergence, also emits a
// first-class graph DRIFT event so the verification investment surfaces drift instead of silently passing.
export interface NavLanded {
  sessionId?: string | null; productId?: string | null;
  landedUrl: string;                    // the URL the live webview actually settled on (wv.getURL())
  expectedRoute?: string | null;        // the verified node's screen_route the nav was instructed toward
  expectedLabel?: string | null;        // the node's on-screen label (the label-click target), for label-based intents
  intent?: string | null;
}
/** Returns the computed { ok, diverged } so the caller can shape a response/telemetry; both null when there
 *  was no expectation to judge against (nothing to record). */
export async function recordNavLanded(a: NavLanded): Promise<{ ok: boolean | null; diverged: boolean }> {
  const landed = (a.landedUrl || '').trim();
  if (!landed) return { ok: null, diverged: false }; // report never carried a usable URL → behave exactly as today
  const route = (a.expectedRoute || '').trim();
  const label = (a.expectedLabel || '').trim();
  // Normalize for comparison: route is host-relative ("/approvals") or absolute; compare on the lower-cased
  // path/substring so "https://po.vin/approvals?x=1" satisfies expected "/approvals". A route shorter than 2
  // chars ("/" alone) is not a discriminating expectation.
  const lu = landed.toLowerCase();
  // RC-31: compare a host-relative route against the landed PATH (not the full URL incl. host), so a short
  // route like "/po" can't false-match the host of "https://po.vin/dashboard". Absolute routes compare full.
  const landedPath = (() => { try { return new URL(landed).pathname.toLowerCase(); } catch { return lu; } })();
  let routeMatch: boolean | null = null;
  if (route.length > 1) {
    try {
      if (/^https?:/.test(route)) { routeMatch = lu.includes(route.toLowerCase()); }
      else { const needle = new URL(route, /^https?:/.test(landed) ? landed : `https://x${route}`).pathname.toLowerCase(); routeMatch = landedPath.includes(needle); }
    } catch { routeMatch = landedPath.includes(route.toLowerCase()); }
  }
  // A label expectation can't be confirmed from the URL alone (a SPA click may not change the path); treat a
  // label-only intent as a soft expectation — confirmed if the label token shows up in the URL, otherwise
  // UNDETERMINED (ok=null, no false drift) rather than asserting divergence on a route-less click.
  const labelMatch = label.length > 2 && lu.includes(label.toLowerCase().replace(/\s+/g, '-'));
  // Resolve the landing to a node for the telemetry row (the same resolver the agent-step bridge uses).
  const resolved = a.productId ? await resolveNodeForScreen(a.productId, landed, label).catch(() => null) : null;
  let ok: boolean | null;
  let diverged = false;
  if (routeMatch !== null) {
    ok = routeMatch; diverged = !routeMatch;          // a verified route is the authoritative expectation
  } else if (label.length > 2) {
    ok = labelMatch ? true : null;                     // label-only: confirm OR leave undetermined (never false-drift)
    diverged = false;
  } else {
    ok = null; diverged = false;                       // no expectation at all → nothing to judge
  }
  await recordNavAttempt({
    source: 'path-a', productId: a.productId ?? null, sessionId: a.sessionId ?? null,
    graphId: resolved?.graphId ?? null, nodeId: resolved?.nodeId ?? null, intent: a.intent ?? null,
    url: landed, ok, healedVia: diverged ? 'drift:diverged' : (ok ? 'observed:landed' : null), selectorUsed: null,
  });
  if (diverged) {
    // Surface the drift: the live route diverged from the verified graph route the nav was driven toward.
    await recordGraphEvent('drift', {
      graphId: resolved?.graphId ?? null, nodeId: resolved?.nodeId ?? null, productId: a.productId ?? null,
      actor: 'live-drift', after: { expectedRoute: route || null, expectedLabel: label || null, landedUrl: landed, intent: a.intent ?? null },
    });
  }
  return { ok, diverged };
}

/** Create a new DRAFT graph version for (product, name): graph_version = max+1, copies the environment.
 *  The active graph is untouched until publishGraph flips this one. Returns the new graph id. */
export async function newDraftGraph(productId: string, name: string, environmentId: string | null, actor = 'system'): Promise<string> {
  const maxV = (await db().query<{ v: number }>(
    `SELECT COALESCE(MAX(graph_version), 0)::int v FROM demo_graphs WHERE product_id = $1 AND name = $2`, [productId, name],
  )).rows[0]?.v ?? 0;
  const id = (await db().query<{ id: string }>(
    `INSERT INTO demo_graphs (product_id, name, environment_id, graph_version, status) VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
    [productId, name, environmentId, maxV + 1],
  )).rows[0].id;
  await recordGraphEvent('create', { graphId: id, productId, actor, after: { name, graph_version: maxV + 1, status: 'draft' } });
  return id;
}

/** Publish a graph: prior active version(s) of the same (product, name) → deprecated, this one → active.
 *  Atomic (mirrors lifecycle.bumpVersion). Stamps verified_by/at — publish asserts the graph was reviewed. */
export async function publishGraph(graphId: string, actor = 'system'): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const g = (await client.query<{ product_id: string; name: string }>(
      `SELECT product_id, name FROM demo_graphs WHERE id = $1`, [graphId])).rows[0];
    if (!g) throw new Error('graph not found');
    // SAFETY (non-regressive publish): carry forward every VERIFIED node from the product's currently-active
    // graph(s) that this graph doesn't already have (by intent_label), keeping its real hand-tuned
    // selectors/route. Publishing a knowledge-derived graph must NEVER lose the recon-verified navigation
    // that drives live demos today — so a published graph is always ≥ the prior active one, verified-wise.
    await client.query(
      `INSERT INTO demo_graph_nodes (demo_graph_id, intent_label, screen_route, locator_strategies, persona_labels, screen_name, screen_type, verification_status, last_verified, permissions_required, page_version)
       SELECT $1, n.intent_label, n.screen_route, n.locator_strategies, n.persona_labels, n.screen_name, n.screen_type, n.verification_status, n.last_verified, n.permissions_required, n.page_version
         FROM demo_graph_nodes n JOIN demo_graphs og ON og.id = n.demo_graph_id
        WHERE og.product_id = $2 AND og.status = 'active' AND og.id <> $1 AND og.archived_at IS NULL
          AND n.verification_status = 'verified' AND n.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM demo_graph_nodes x WHERE x.demo_graph_id = $1 AND lower(x.intent_label) = lower(n.intent_label))`,
      [graphId, g.product_id]);
    // Carry forward every operator-APPROVED workflow from the prior active graph(s) this graph lacks (by
    // name). Same non-regression contract as nodes: publishing an autogen graph must never strand the
    // hand-approved demo journeys (the original "<product> demo" path). Unapproved autogen suggestions are
    // NOT carried — they stay with their own draft graph for review.
    await client.query(
      `INSERT INTO demo_graph_workflows (demo_graph_id, workflow_name, business_purpose, stakeholder_type, persona_type, node_sequence, success_criteria, verification_status, sort_order, approved_at, approved_by)
       SELECT $1, w.workflow_name, w.business_purpose, w.stakeholder_type, w.persona_type, w.node_sequence, w.success_criteria, w.verification_status, w.sort_order, w.approved_at, w.approved_by
         FROM demo_graph_workflows w JOIN demo_graphs og ON og.id = w.demo_graph_id
        WHERE og.product_id = $2 AND og.status = 'active' AND og.id <> $1 AND og.archived_at IS NULL
          AND w.archived_at IS NULL AND w.approved_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM demo_graph_workflows x WHERE x.demo_graph_id = $1 AND x.archived_at IS NULL AND lower(x.workflow_name) = lower(w.workflow_name))`,
      [graphId, g.product_id]);
    // Deprecate ALL other active graphs of the product (names may differ — the autogen graph vs the seeded
    // one), so the product ends with exactly ONE active graph (no ambiguous dual-active selection).
    await client.query(
      `UPDATE demo_graphs SET status = 'deprecated' WHERE product_id = $1 AND status = 'active' AND id <> $2`,
      [g.product_id, graphId]);
    await client.query(
      `UPDATE demo_graphs SET status = 'active', verified_by = $2, verified_at = now() WHERE id = $1`, [graphId, actor]);
    await client.query('COMMIT');
    await recordGraphEvent('publish', { graphId, productId: g.product_id, actor, after: { name: g.name, status: 'active' } });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/** Soft-archive a graph (never hard-delete): status → archived + archived_at/by. Audited. */
export async function archiveGraph(graphId: string, actor = 'system'): Promise<void> {
  const before = (await db().query<{ status: string; product_id: string }>(
    `SELECT status, product_id FROM demo_graphs WHERE id = $1`, [graphId])).rows[0];
  await db().query(`UPDATE demo_graphs SET status = 'archived', archived_at = now(), archived_by = $2 WHERE id = $1`, [graphId, actor]);
  await recordGraphEvent('archive', { graphId, productId: before?.product_id ?? null, actor,
    before: { status: before?.status }, after: { status: 'archived' } });
}

// ── Verification + readiness (Phase C). The single SHARED node-verification path (autogen Phase B + the
// verify run Phase C both use verifyNode) so there is one evidence-based truth, never two that drift. The
// scoring functions are REAL calculations over verified node/workflow ratios + navigation-test freshness —
// never hand-entered (these live here, not in coverage.ts, because coverage.ts is a runnable script). ──

/** Drive ONE node against the live site and report whether the REAL DOM resolved it. Evidence-based: it
 *  only ever clicks the node's stored locator_strategies / screen_route (gotoNode) — it never invents. */
export async function verifyNode(adapter: InteractionAdapter, node: DemoNode, role: string): Promise<{ ok: boolean; url: string }> {
  try { const r = await adapter.gotoNode(node, role); return { ok: r.ok, url: r.url }; }
  catch { return { ok: false, url: '' }; }
}

/** Roll a workflow's status up from its nodes' verification statuses (pure): any broken → broken; all
 *  verified → verified; anything still in progress → pending_review; nothing known → draft. */
export function rollupWorkflow(nodeStatuses: NodeVerification[]): NodeVerification {
  if (!nodeStatuses.length) return 'draft';
  if (nodeStatuses.some((s) => s === 'broken')) return 'broken';
  if (nodeStatuses.every((s) => s === 'verified')) return 'verified';
  if (nodeStatuses.some((s) => s === 'verified' || s === 'pending_review')) return 'pending_review';
  return 'draft';
}

/** REAL graph coverage (0..1) from verified node + workflow ratios — never manual. Nodes are the
 *  navigational substrate (60%), workflows the journeys (40%); a graph with no workflows yet falls back to
 *  node coverage alone (don't punish an empty dimension). */
export function graphCoverageScore(c: { verifiedNodes: number; totalNodes: number; verifiedWorkflows: number; totalWorkflows: number }): number {
  const nodePct = c.totalNodes ? c.verifiedNodes / c.totalNodes : 0;
  const wfPct = c.totalWorkflows ? c.verifiedWorkflows / c.totalWorkflows : 0;
  const score = c.totalWorkflows ? nodePct * 0.6 + wfPct * 0.4 : nodePct;
  return Math.round(score * 100) / 100;
}

/** Readiness = coverage discounted by how stale the last navigation test is (recency decay, modeled on
 *  knowledge.computeConfidence — 90-day window, 0.4 floor). Never manual. */
export function graphReadinessScore(c: { coverage: number; lastNavTestDays: number | null }): number {
  const freshness = c.lastNavTestDays == null ? 0.5 : Math.max(0.4, Math.min(1, 1 - c.lastNavTestDays / 90));
  return Math.round(c.coverage * freshness * 100) / 100;
}

/** Roll every workflow of a graph up from its nodes' statuses (DB; testable without the live site). */
export async function rollupWorkflowsForGraph(graphId: string, actor = 'system'): Promise<void> {
  const wfs = (await db().query<{ id: string; node_sequence: any; verification_status: NodeVerification }>(
    `SELECT id, node_sequence, verification_status FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows;
  const nodes = (await db().query<{ intent_label: string; verification_status: NodeVerification }>(
    `SELECT intent_label, verification_status FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows;
  const byLabel = new Map(nodes.map((x) => [x.intent_label.toLowerCase(), x.verification_status]));
  for (const wf of wfs) {
    const seq: string[] = Array.isArray(wf.node_sequence) ? wf.node_sequence.map((s: any) => String(s).toLowerCase()) : [];
    const statuses = seq.map((l) => byLabel.get(l) ?? ('draft' as NodeVerification));
    const rolled = rollupWorkflow(statuses);
    if (rolled !== wf.verification_status) {
      await db().query(`UPDATE demo_graph_workflows SET verification_status=$2 WHERE id=$1`, [wf.id, rolled]);
      await recordGraphEvent('validate', { graphId, workflowId: wf.id, actor, before: { verification_status: wf.verification_status }, after: { verification_status: rolled } });
    }
  }
}

/** Recompute + persist a graph's coverage_score from its current node/workflow verification, and stamp
 *  last_navigation_test. DB-only (testable without the live site). Returns the score. */
export async function recomputeGraphScore(graphId: string): Promise<number> {
  const n = (await db().query<{ total: string; verified: string }>(
    `SELECT count(*)::text total, count(*) FILTER (WHERE verification_status='verified')::text verified FROM demo_graph_nodes WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows[0];
  // Only APPROVED journeys count toward coverage — unreviewed autogen suggestions must not drag the score
  // down (nor inflate it). Among the journeys you chose to go live, what fraction is fully verified.
  const w = (await db().query<{ total: string; verified: string }>(
    `SELECT count(*) FILTER (WHERE approved_at IS NOT NULL)::text total,
            count(*) FILTER (WHERE approved_at IS NOT NULL AND verification_status='verified')::text verified
       FROM demo_graph_workflows WHERE demo_graph_id=$1 AND archived_at IS NULL`, [graphId])).rows[0];
  const score = graphCoverageScore({ verifiedNodes: +n.verified, totalNodes: +n.total, verifiedWorkflows: +w.verified, totalWorkflows: +w.total });
  await db().query(`UPDATE demo_graphs SET coverage_score=$2, last_navigation_test=now() WHERE id=$1`, [graphId, score]);
  return score;
}

// ── Workflow authoring (0015 — Workflow Builder). Operator CRUD over demo_graph_workflows: a workflow is a
// human curatorial decision (which REAL screens, in what order, for whom) over the machine-verified nodes —
// authoring one fabricates no data. create/update re-roll the technical status from the nodes + recompute
// the graph score; approve flips the editorial gate the live loop selects on; archive is soft (0009). Every
// mutation is audited to graph_events. These are pure DB (no LLM/browser) but live here so ALL graph writes
// share one audited path. ──

export interface WorkflowInput {
  name: string;
  businessPurpose?: string | null;
  stakeholderType?: string | null;
  personaType?: string | null;
  successCriteria?: string | null;
  nodeSequence: string[]; // ordered intent_labels the journey traverses
  stepScript?: Record<string, string>; // per-screen caption/talking-point (keyed by intent_label) for the scripted runner
  sortOrder?: number | null;
}

/** Create a workflow on a graph. `approved` = author it as a live demo journey now (true) vs. leave it as a
 *  suggestion (false). Re-rolls technical status from the nodes + recomputes the graph score. */
export async function createWorkflow(graphId: string, input: WorkflowInput, approved: boolean, actor = 'system'): Promise<{ workflowId: string; graphId: string }> {
  if (!graphId) throw new Error('graphId required');
  if (!input?.name?.trim()) throw new Error('workflow name required');
  const seq = JSON.stringify((input.nodeSequence ?? []).map((s) => String(s)));
  const script = JSON.stringify(input.stepScript ?? {});
  const id = (await db().query<{ id: string }>(
    `INSERT INTO demo_graph_workflows
       (demo_graph_id, workflow_name, business_purpose, stakeholder_type, persona_type, node_sequence, success_criteria, sort_order, approved_at, approved_by, step_script)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8, CASE WHEN $9 THEN now() ELSE NULL END, CASE WHEN $9 THEN $10 ELSE NULL END, $11::jsonb)
     RETURNING id`,
    [graphId, input.name.trim(), input.businessPurpose ?? null, input.stakeholderType ?? null, input.personaType ?? null, seq, input.successCriteria ?? null, input.sortOrder ?? 0, approved, actor, script],
  )).rows[0].id;
  await recordGraphEvent('create', { graphId, workflowId: id, actor, after: { workflow_name: input.name, approved, node_sequence: input.nodeSequence } });
  await rollupWorkflowsForGraph(graphId, actor);
  await recomputeGraphScore(graphId);
  return { workflowId: id, graphId };
}

/** Edit a workflow's fields / reorder its node_sequence. Re-rolls status + recomputes the graph score. */
export async function updateWorkflow(workflowId: string, input: WorkflowInput, actor = 'system'): Promise<{ workflowId: string; graphId: string }> {
  const before = (await db().query<{ demo_graph_id: string; workflow_name: string }>(
    `SELECT demo_graph_id, workflow_name FROM demo_graph_workflows WHERE id = $1`, [workflowId])).rows[0];
  if (!before) throw new Error('workflow not found');
  if (!input?.name?.trim()) throw new Error('workflow name required');
  const seq = JSON.stringify((input.nodeSequence ?? []).map((s) => String(s)));
  const script = JSON.stringify(input.stepScript ?? {});
  await db().query(
    `UPDATE demo_graph_workflows SET workflow_name=$2, business_purpose=$3, stakeholder_type=$4, persona_type=$5,
       node_sequence=$6::jsonb, success_criteria=$7, sort_order=COALESCE($8, sort_order), step_script=$9::jsonb WHERE id=$1`,
    [workflowId, input.name.trim(), input.businessPurpose ?? null, input.stakeholderType ?? null, input.personaType ?? null, seq, input.successCriteria ?? null, input.sortOrder ?? null, script],
  );
  await recordGraphEvent('edit', { graphId: before.demo_graph_id, workflowId, actor, before: { workflow_name: before.workflow_name }, after: { workflow_name: input.name, node_sequence: input.nodeSequence } });
  await rollupWorkflowsForGraph(before.demo_graph_id, actor);
  await recomputeGraphScore(before.demo_graph_id);
  return { workflowId, graphId: before.demo_graph_id };
}

/** Flip the editorial gate: approve (the live loop may select it) or un-approve (back to a suggestion). */
export async function setWorkflowApproval(workflowId: string, approved: boolean, actor = 'system'): Promise<{ workflowId: string; graphId: string }> {
  const before = (await db().query<{ demo_graph_id: string; approved_at: string | null }>(
    `SELECT demo_graph_id, approved_at FROM demo_graph_workflows WHERE id = $1`, [workflowId])).rows[0];
  if (!before) throw new Error('workflow not found');
  await db().query(
    `UPDATE demo_graph_workflows SET approved_at = CASE WHEN $2 THEN now() ELSE NULL END, approved_by = CASE WHEN $2 THEN $3 ELSE NULL END WHERE id = $1`,
    [workflowId, approved, actor]);
  await recordGraphEvent('validate', { graphId: before.demo_graph_id, workflowId, actor, before: { approved: before.approved_at != null }, after: { approved } });
  return { workflowId, graphId: before.demo_graph_id };
}

/** Soft-archive a workflow (never hard-delete). Recomputes the graph score (one fewer journey). */
export async function archiveWorkflow(workflowId: string, actor = 'system'): Promise<{ workflowId: string; graphId: string }> {
  const before = (await db().query<{ demo_graph_id: string; workflow_name: string }>(
    `SELECT demo_graph_id, workflow_name FROM demo_graph_workflows WHERE id = $1`, [workflowId])).rows[0];
  if (!before) throw new Error('workflow not found');
  await db().query(`UPDATE demo_graph_workflows SET archived_at = now(), archived_by = $2 WHERE id = $1`, [workflowId, actor]);
  await recordGraphEvent('archive', { graphId: before.demo_graph_id, workflowId, actor, before: { workflow_name: before.workflow_name }, after: { archived: true } });
  await recomputeGraphScore(before.demo_graph_id);
  return { workflowId, graphId: before.demo_graph_id };
}

// ── Node authoring / manual override (V3.2 — Graph Builder governance). Operator CRUD over a graph's
// demo_graph_nodes: hand-edit a node's route/selectors/labels/purpose, set its verification by hand, or
// soft-archive it (never hard-delete). Stamps authorship (created_by/at, updated_by/at) + verification_source
// + audits to graph_events, then re-rolls workflows + recomputes the graph score. Pure DB (no LLM/browser),
// here so ALL graph writes share one audited path. ──

export interface NodeInput {
  intentLabel: string;
  screenRoute?: string | null;
  screenName?: string | null;
  screenType?: string | null;
  businessPurpose?: string | null;
  businessOutcome?: string | null;
  locatorStrategies?: LocatorStrategy[]; // ordered fallback selectors
  personaLabels?: Record<string, string>;
  permissionsRequired?: string[];
  verificationStatus?: NodeVerification; // operator may set by hand (verification_source → 'manual')
}

/** Create a node on a graph (manual authoring). Stamps authorship; audited; re-rolls + recomputes the score. */
export async function createNode(graphId: string, input: NodeInput, actor = 'system'): Promise<{ nodeId: string; graphId: string }> {
  if (!graphId) throw new Error('graphId required');
  if (!input?.intentLabel?.trim()) throw new Error('intent label required');
  const g = (await db().query<{ product_id: string }>(`SELECT product_id FROM demo_graphs WHERE id = $1`, [graphId])).rows[0];
  if (!g) throw new Error('graph not found');
  const vstatus = input.verificationStatus ?? 'draft';
  const id = (await db().query<{ id: string }>(
    `INSERT INTO demo_graph_nodes
       (demo_graph_id, intent_label, screen_route, screen_name, screen_type, business_purpose, business_outcome,
        locator_strategies, persona_labels, permissions_required, verification_status, verification_source, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11, CASE WHEN $12 THEN 'manual' ELSE NULL END,$13,now())
     RETURNING id`,
    [graphId, input.intentLabel.trim(), input.screenRoute ?? null, input.screenName ?? null, input.screenType ?? null,
     input.businessPurpose ?? null, input.businessOutcome ?? null, JSON.stringify(input.locatorStrategies ?? []),
     JSON.stringify(input.personaLabels ?? {}), JSON.stringify(input.permissionsRequired ?? []), vstatus, !!input.verificationStatus, actor],
  )).rows[0].id;
  await recordGraphEvent('create', { graphId, nodeId: id, productId: g.product_id, actor, after: { intent_label: input.intentLabel, verification_status: vstatus } });
  await rollupWorkflowsForGraph(graphId, actor);
  await recomputeGraphScore(graphId);
  return { nodeId: id, graphId };
}

/** Edit a node (manual override). COALESCE keeps any field the caller omits. Setting verification_status by
 *  hand stamps verification_source='manual'. Stamps updated_by/at; audited; re-rolls + recomputes. */
export async function updateNode(nodeId: string, input: NodeInput, actor = 'system'): Promise<{ nodeId: string; graphId: string }> {
  const before = (await db().query<{ demo_graph_id: string; intent_label: string; verification_status: string }>(
    `SELECT demo_graph_id, intent_label, verification_status FROM demo_graph_nodes WHERE id = $1`, [nodeId])).rows[0];
  if (!before) throw new Error('node not found');
  if (input.intentLabel != null && !input.intentLabel.trim()) throw new Error('intent label cannot be blank');
  const hasStatus = !!input.verificationStatus;
  await db().query(
    `UPDATE demo_graph_nodes SET
       intent_label = COALESCE($2, intent_label),
       screen_route = COALESCE($3, screen_route),
       screen_name = COALESCE($4, screen_name),
       screen_type = COALESCE($5, screen_type),
       business_purpose = COALESCE($6, business_purpose),
       business_outcome = COALESCE($7, business_outcome),
       locator_strategies = COALESCE($8::jsonb, locator_strategies),
       persona_labels = COALESCE($9::jsonb, persona_labels),
       permissions_required = COALESCE($10::jsonb, permissions_required),
       verification_status = COALESCE($11, verification_status),
       verification_source = CASE WHEN $12 THEN 'manual' ELSE verification_source END,
       last_verified = CASE WHEN $12 THEN now() ELSE last_verified END,
       updated_by = $13, updated_at = now()
     WHERE id = $1`,
    [nodeId, input.intentLabel?.trim() ?? null, input.screenRoute ?? null, input.screenName ?? null, input.screenType ?? null,
     input.businessPurpose ?? null, input.businessOutcome ?? null,
     input.locatorStrategies ? JSON.stringify(input.locatorStrategies) : null,
     input.personaLabels ? JSON.stringify(input.personaLabels) : null,
     input.permissionsRequired ? JSON.stringify(input.permissionsRequired) : null,
     input.verificationStatus ?? null, hasStatus, actor],
  );
  await recordGraphEvent('edit', { graphId: before.demo_graph_id, nodeId, actor,
    before: { intent_label: before.intent_label, verification_status: before.verification_status },
    after: { intent_label: input.intentLabel ?? before.intent_label, verification_status: input.verificationStatus ?? before.verification_status } });
  await rollupWorkflowsForGraph(before.demo_graph_id, actor);
  await recomputeGraphScore(before.demo_graph_id);
  return { nodeId, graphId: before.demo_graph_id };
}

/** Soft-archive a node (never hard-delete). The live loop already filters on archived_at IS NULL. Audited;
 *  re-rolls workflows (a journey referencing it degrades honestly) + recomputes the score. */
export async function archiveNode(nodeId: string, actor = 'system'): Promise<{ nodeId: string; graphId: string }> {
  const before = (await db().query<{ demo_graph_id: string; intent_label: string }>(
    `SELECT demo_graph_id, intent_label FROM demo_graph_nodes WHERE id = $1`, [nodeId])).rows[0];
  if (!before) throw new Error('node not found');
  await db().query(`UPDATE demo_graph_nodes SET archived_at = now(), archived_by = $2 WHERE id = $1`, [nodeId, actor]);
  await recordGraphEvent('archive', { graphId: before.demo_graph_id, nodeId, actor, before: { intent_label: before.intent_label }, after: { archived: true } });
  await rollupWorkflowsForGraph(before.demo_graph_id, actor);
  await recomputeGraphScore(before.demo_graph_id);
  return { nodeId, graphId: before.demo_graph_id };
}

// ── Workflow-aware navigation selection (Phase D). The AI navigates ONLY the ACTIVE graph's VERIFIED
// nodes, and prefers the verified WORKFLOW whose stakeholder/persona matches the active stakeholder — so a
// CFO and an operator can be walked different verified journeys, and a broken/draft node is never driven
// (the loop degrades honestly instead). Pure DB (no browser) so it is testable on its own. ──

export interface NavCandidate { id: string; intent_label: string; screen_route: string | null; locator_strategies: LocatorStrategy[]; persona_labels: Record<string, string>; verification_status: NodeVerification }
export interface ActiveGraphMeta { graphId: string; graphVersion: number; verifiedAt: string | null; environment: string | null; productName: string }
export interface SelectedWorkflow { name: string; stakeholderType: string | null; personaType: string | null }

/** The single ACTIVE graph for a product (highest version), with the metadata the AI needs to explain its
 *  navigation truth ("graph vN, verified <date>, environment <env>"). null when no active graph exists. */
export async function resolveActiveGraph(productId: string): Promise<ActiveGraphMeta | null> {
  const g = (await db().query<{ id: string; gv: number; va: string | null; env: string | null; pn: string }>(`
    SELECT g.id, g.graph_version gv, g.verified_at::text va,
           (SELECT name FROM environments e WHERE e.id = g.environment_id) env, p.name pn
      FROM demo_graphs g JOIN products p ON p.id = g.product_id
     WHERE g.product_id = $1 AND g.status = 'active' AND g.archived_at IS NULL
     ORDER BY g.graph_version DESC LIMIT 1`, [productId])).rows[0];
  return g ? { graphId: g.id, graphVersion: g.gv, verifiedAt: g.va, environment: g.env, productName: g.pn } : null;
}

/** Within a specific graph: the navigable nodes (verified + pending_review + draft, broken excluded), and —
 *  if a stakeholder/persona is in the room and an approved workflow matches it — the candidate set restricted
 *  to that workflow's navigable nodes. Falls back to all navigable nodes when nothing matches. `candidates` is
 *  what the loop navigates over; `allVerified` stays recon-verified-only (the experience-map count + evals). */
export async function selectFromGraph(graphId: string, stakeholderRole?: string | null): Promise<{ workflow: SelectedWorkflow | null; candidates: NavCandidate[]; allVerified: NavCandidate[] }> {
  // allVerified = recon-verified nodes only (unchanged contract — the experience map's "verified" signal + eval-phase12/14).
  const allVerified = (await db().query<NavCandidate>(`
    SELECT id, intent_label, screen_route, locator_strategies, persona_labels, verification_status
      FROM demo_graph_nodes WHERE demo_graph_id = $1 AND verification_status = 'verified' AND archived_at IS NULL`, [graphId])).rows;
  // De-gate (founder, this session): the loop may now NAVIGATE any non-archived, non-BROKEN node — verified,
  // pending_review, or draft — preferring verified. Safe because driver.gotoNode tests every locator on the
  // REAL DOM and falls back to the route, else fails honestly: the LIVE DOM test is the truth gate, not the
  // cached verification_status. A node recon CONFIRMED broken stays excluded (driving it would only fail).
  const navigable = (await db().query<NavCandidate>(`
    SELECT id, intent_label, screen_route, locator_strategies, persona_labels, verification_status
      FROM demo_graph_nodes
     WHERE demo_graph_id = $1 AND archived_at IS NULL AND verification_status IN ('verified','pending_review','draft')
     ORDER BY CASE verification_status WHEN 'verified' THEN 0 WHEN 'pending_review' THEN 1 ELSE 2 END, intent_label`, [graphId])).rows;
  let workflow: SelectedWorkflow | null = null;
  let candidates = navigable;
  if (stakeholderRole && navigable.length) {
    // Editorial gate (0015): the live loop selects only operator-APPROVED, non-archived workflows — an
    // unreviewed autogen suggestion never silently drives a demo. Node-level safety: candidates are
    // intersected with the navigable set (broken nodes already excluded above).
    const wfs = (await db().query<{ workflow_name: string; stakeholder_type: string | null; persona_type: string | null; node_sequence: any }>(`
      SELECT workflow_name, stakeholder_type, persona_type, node_sequence
        FROM demo_graph_workflows WHERE demo_graph_id = $1 AND archived_at IS NULL AND approved_at IS NOT NULL
        ORDER BY sort_order, workflow_name`, [graphId])).rows;
    const role = stakeholderRole.toLowerCase();
    const m = (v?: string | null) => !!v && v.toLowerCase() !== 'none' && (role.includes(v.toLowerCase()) || v.toLowerCase().includes(role));
    const match = wfs.find((w) => m(w.stakeholder_type) || m(w.persona_type));
    if (match) {
      const seq = (Array.isArray(match.node_sequence) ? match.node_sequence : []).map((s: any) => String(s).toLowerCase());
      const inWf = navigable.filter((n) => seq.includes(n.intent_label.toLowerCase()));
      if (inWf.length) { candidates = inWf; workflow = { name: match.workflow_name, stakeholderType: match.stakeholder_type, personaType: match.persona_type }; }
    }
  }
  return { workflow, candidates, allVerified };
}

/** Product-level navigation selection used by the live loop: resolve the active graph, then select within it. */
export async function selectNavigation(productId: string | null, stakeholderRole?: string | null): Promise<{ graph: ActiveGraphMeta | null; workflow: SelectedWorkflow | null; candidates: NavCandidate[]; allVerified: NavCandidate[] }> {
  if (!productId) return { graph: null, workflow: null, candidates: [], allVerified: [] };
  const graph = await resolveActiveGraph(productId);
  if (!graph) return { graph: null, workflow: null, candidates: [], allVerified: [] };
  const sel = await selectFromGraph(graph.graphId, stakeholderRole);
  return { graph, ...sel };
}

/** Bridge (Phase 2): resolve a LIVE screen (current URL + the on-screen element label the agent acted on)
 *  to a node in the product's ACTIVE graph — by screen_route contained in the URL, else by intent_label /
 *  persona_label match. Lets the DOM-driven /agent/step loop record its navigation AGAINST the graph. Returns
 *  the active graphId even on a node miss (nodeId=null) so the attempt is still attributed; null only when the
 *  product has no active graph. Never throws (best-effort telemetry path). */
export async function resolveNodeForScreen(productId: string | null, url: string, label: string): Promise<{ nodeId: string | null; graphId: string } | null> {
  if (!productId) return null;
  try {
    const graph = await resolveActiveGraph(productId);
    if (!graph) return null;
    const nodes = (await db().query<{ id: string; intent_label: string; screen_route: string | null; persona_labels: any }>(
      `SELECT id, intent_label, screen_route, persona_labels FROM demo_graph_nodes
        WHERE demo_graph_id = $1 AND verification_status <> 'broken' AND archived_at IS NULL`, [graph.graphId])).rows;
    const u = (url || '').toLowerCase();
    const lab = (label || '').toLowerCase().trim();
    let hit = nodes.find((n) => n.screen_route && String(n.screen_route).length > 1 && u.includes(String(n.screen_route).toLowerCase()));
    if (!hit && lab.length > 2) {
      hit = nodes.find((n) => {
        const il = n.intent_label.toLowerCase();
        return il === lab || lab.includes(il) || il.includes(lab)
          || Object.values(n.persona_labels || {}).some((v) => String(v).toLowerCase() === lab);
      });
    }
    return { nodeId: hit?.id ?? null, graphId: graph.graphId };
  } catch { return null; }
}

// ── Versioning / rollback + tour linkage (Phase 4 — authority convergence + governance). ──

/** Roll back to a PRIOR graph version: deprecate the product's current active graph(s) and re-activate the
 *  chosen one EXACTLY as it was (no carry-forward — unlike publishGraph). Atomic + audited. The console
 *  surfaces the version history + blast-radius before calling this. */
export async function rollbackGraph(graphId: string, actor = 'system'): Promise<{ graphId: string; productId: string; toVersion: number }> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const g = (await client.query<{ product_id: string; name: string; graph_version: number; status: string }>(
      `SELECT product_id, name, graph_version, status FROM demo_graphs WHERE id = $1`, [graphId])).rows[0];
    if (!g) throw new Error('graph not found');
    if (g.status === 'archived') throw new Error('cannot roll back to an archived version (unarchive it first)');
    await client.query(`UPDATE demo_graphs SET status = 'deprecated' WHERE product_id = $1 AND status = 'active' AND id <> $2`, [g.product_id, graphId]);
    await client.query(`UPDATE demo_graphs SET status = 'active', verified_by = $2, verified_at = now() WHERE id = $1`, [graphId, actor]);
    await client.query('COMMIT');
    await recordGraphEvent('publish', { graphId, productId: g.product_id, actor, after: { name: g.name, status: 'active', rolledBackToVersion: g.graph_version } });
    return { graphId, productId: g.product_id, toVersion: g.graph_version };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/** Full tour→node-id re-model (Phase 4): resolve each tour step (by url→screen_route / label→intent_label)
 *  to a node in the product's ACTIVE graph and STORE the nodeId on the step (demo_tours.steps jsonb). Makes
 *  tour→node consumption EXACT (the console then prefers the stored id over the read-time best-effort match).
 *  Idempotent; only touches navigate/click/input/select steps; leaves a step unlinked when no node resolves. */
export async function linkTourNodes(productId: string, actor = 'system'): Promise<{ tours: number; stepsLinked: number }> {
  const tours = (await db().query<{ id: string; steps: any }>(
    `SELECT id, steps FROM demo_tours WHERE product_id = $1 AND archived_at IS NULL`, [productId])).rows;
  let touched = 0, stepsLinked = 0;
  for (const t of tours) {
    const steps = Array.isArray(t.steps) ? t.steps : [];
    let changed = false;
    for (const s of steps) {
      if (!s || !['navigate', 'click', 'input', 'select'].includes(String(s.kind))) continue;
      const r = await resolveNodeForScreen(productId, String(s.url || ''), String(s.label || s.selector || ''));
      const nid = r?.nodeId ?? null;
      if (nid && s.nodeId !== nid) { s.nodeId = nid; changed = true; stepsLinked++; }
    }
    if (changed) { await db().query(`UPDATE demo_tours SET steps = $2::jsonb, updated_at = now() WHERE id = $1`, [t.id, JSON.stringify(steps)]); touched++; }
  }
  void actor;
  return { tours: touched, stepsLinked };
}

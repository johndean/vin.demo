/**
 * Business Outcome Registry (V5 Guided Experience Platform, Phase 1; migration 0020). The first-class
 * "Reduce approval delays / Improve audit readiness / …" object the platform mandates — until now an outcome
 * lived only as FREE TEXT on nodes/workflows/session_discovery. This governs outcomes EXACTLY like graphs and
 * knowledge chunks: create/edit are audited, deprecate is a status flip, delete is a soft-archive (never
 * hard-delete), and a workflow/session can be LINKED to an outcome (the seam — the existing text columns stay).
 * Writes to outcome_events are BEST-EFFORT (mirrors recordGraphEvent / recordKnowledgeEvent): a logging
 * failure must never break a create or a link. Pure DB (no LLM/browser) — same posture as graph-lifecycle.ts.
 */
import { db } from './db.js';

export type OutcomeStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type OutcomeAction = 'create' | 'edit' | 'deprecate' | 'archive' | 'link';

export interface OutcomeEvent {
  outcomeId?: string | null;
  productId?: string | null;
  actor?: string;
  before?: unknown;
  after?: unknown;
}

/** Record an outcome MUTATION to the audit trail. Best-effort — never throws into the caller. */
export async function recordOutcomeEvent(action: OutcomeAction, e: OutcomeEvent): Promise<void> {
  try {
    await db().query(
      `INSERT INTO outcome_events (outcome_id, product_id, action, actor, before, after)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [e.outcomeId ?? null, e.productId ?? null, action, e.actor ?? 'system',
       e.before != null ? JSON.stringify(e.before) : null, e.after != null ? JSON.stringify(e.after) : null],
    );
  } catch (err) { console.error('[outcome] recordOutcomeEvent failed (best-effort):', err); }
}

export interface OutcomeInput {
  title: string;
  description?: string | null;
  metric?: string | null;
  baseline?: string | null;
  target?: string | null;
  stakeholderType?: string | null;
  status?: OutcomeStatus;        // defaults to 'active' on create
  owner?: string | null;
}

export interface Outcome {
  id: string;
  productId: string;
  title: string;
  description: string | null;
  metric: string | null;
  baseline: string | null;
  target: string | null;
  stakeholderType: string | null;
  status: OutcomeStatus;
  version: number;
  owner: string | null;
}

interface OutcomeRow {
  id: string; product_id: string; title: string; description: string | null; metric: string | null;
  baseline: string | null; target: string | null; stakeholder_type: string | null; status: OutcomeStatus;
  version: number; owner: string | null;
}
const toOutcome = (r: OutcomeRow): Outcome => ({
  id: r.id, productId: r.product_id, title: r.title, description: r.description, metric: r.metric,
  baseline: r.baseline, target: r.target, stakeholderType: r.stakeholder_type, status: r.status,
  version: r.version, owner: r.owner,
});

/** Every non-archived outcome for a product (active + draft + deprecated), newest first. */
export async function getOutcomes(productId: string): Promise<Outcome[]> {
  const { rows } = await db().query<OutcomeRow>(
    `SELECT id, product_id, title, description, metric, baseline, target, stakeholder_type, status, version, owner
       FROM business_outcomes WHERE product_id = $1 AND archived_at IS NULL
      ORDER BY created_at DESC`, [productId]);
  return rows.map(toOutcome);
}

/** Create a business outcome. Audited. Returns the new id. */
export async function createOutcome(productId: string, input: OutcomeInput, actor = 'system'): Promise<{ outcomeId: string; productId: string }> {
  if (!productId) throw new Error('productId required');
  if (!input?.title?.trim()) throw new Error('outcome title required');
  const id = (await db().query<{ id: string }>(
    `INSERT INTO business_outcomes (product_id, title, description, metric, baseline, target, stakeholder_type, status, owner, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING id`,
    [productId, input.title.trim(), input.description ?? null, input.metric ?? null, input.baseline ?? null,
     input.target ?? null, input.stakeholderType ?? null, input.status ?? 'active', input.owner ?? null, actor],
  )).rows[0].id;
  await recordOutcomeEvent('create', { outcomeId: id, productId, actor, after: { title: input.title, status: input.status ?? 'active' } });
  return { outcomeId: id, productId };
}

/** Edit an outcome (COALESCE keeps any omitted field). Bumps version; stamps updated_by/at; audited. */
export async function updateOutcome(outcomeId: string, input: Partial<OutcomeInput>, actor = 'system'): Promise<{ outcomeId: string; productId: string }> {
  const before = (await db().query<{ product_id: string; title: string; status: OutcomeStatus }>(
    `SELECT product_id, title, status FROM business_outcomes WHERE id = $1`, [outcomeId])).rows[0];
  if (!before) throw new Error('outcome not found');
  if (input.title != null && !input.title.trim()) throw new Error('outcome title cannot be blank');
  await db().query(
    `UPDATE business_outcomes SET
       title = COALESCE($2, title), description = COALESCE($3, description), metric = COALESCE($4, metric),
       baseline = COALESCE($5, baseline), target = COALESCE($6, target), stakeholder_type = COALESCE($7, stakeholder_type),
       status = COALESCE($8, status), owner = COALESCE($9, owner),
       version = version + 1, updated_by = $10, updated_at = now()
     WHERE id = $1`,
    [outcomeId, input.title?.trim() ?? null, input.description ?? null, input.metric ?? null, input.baseline ?? null,
     input.target ?? null, input.stakeholderType ?? null, input.status ?? null, input.owner ?? null, actor],
  );
  const action: OutcomeAction = input.status === 'deprecated' && before.status !== 'deprecated' ? 'deprecate' : 'edit';
  await recordOutcomeEvent(action, { outcomeId, productId: before.product_id, actor,
    before: { title: before.title, status: before.status }, after: { title: input.title ?? before.title, status: input.status ?? before.status } });
  return { outcomeId, productId: before.product_id };
}

/** Soft-archive an outcome (never hard-delete). FK links (ON DELETE SET NULL) stay intact while archived. */
export async function archiveOutcome(outcomeId: string, actor = 'system'): Promise<{ outcomeId: string; productId: string }> {
  const before = (await db().query<{ product_id: string; title: string; status: OutcomeStatus }>(
    `SELECT product_id, title, status FROM business_outcomes WHERE id = $1`, [outcomeId])).rows[0];
  if (!before) throw new Error('outcome not found');
  await db().query(`UPDATE business_outcomes SET status = 'archived', archived_at = now(), archived_by = $2 WHERE id = $1`, [outcomeId, actor]);
  await recordOutcomeEvent('archive', { outcomeId, productId: before.product_id, actor, before: { status: before.status }, after: { status: 'archived' } });
  return { outcomeId, productId: before.product_id };
}

/** Link (or unlink, with outcomeId=null) a WORKFLOW to a business outcome. The seam from the existing
 *  free-text demo_graph_workflows.business_purpose/success_criteria to a governed outcome. Audited. */
export async function setWorkflowOutcome(workflowId: string, outcomeId: string | null, actor = 'system'): Promise<void> {
  const wf = (await db().query<{ business_outcome_id: string | null }>(
    `SELECT business_outcome_id FROM demo_graph_workflows WHERE id = $1`, [workflowId])).rows[0];
  if (!wf) throw new Error('workflow not found');
  await db().query(`UPDATE demo_graph_workflows SET business_outcome_id = $2 WHERE id = $1`, [workflowId, outcomeId]);
  let productId: string | null = null;
  if (outcomeId) productId = (await db().query<{ product_id: string }>(`SELECT product_id FROM business_outcomes WHERE id = $1`, [outcomeId])).rows[0]?.product_id ?? null;
  await recordOutcomeEvent('link', { outcomeId, productId, actor, before: { workflowId, outcomeId: wf.business_outcome_id }, after: { workflowId, outcomeId } });
}

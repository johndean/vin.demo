/**
 * Gap Records (migration 0025) — first-class persisted record of a MISSING upstream dependency that the
 * Journey Assembler needed but could NOT find. The assembler (and, later, any consumer) records a gap INSTEAD
 * of inventing the artifact — the Zero-Gap rule. A gap names what's missing, why, and how severe; the correct
 * upstream system (Demo Graphs / Knowledge / Personas / Environments / Outcomes & Committee) fills it. Pure DB,
 * soft-archive (0009 posture). Nothing here ever creates a product/workflow/knowledge/persona/etc.
 */
import { db } from './db.js';

export type GapSeverity = 'blocks' | 'weakens';
export type GapStatus = 'open' | 'resolved' | 'dismissed';

export interface GapInput {
  productId: string; journeyId?: string | null; outcomeId?: string | null;
  kind: string; title: string; detail?: string | null; severity?: GapSeverity;
}
export interface GapRecord {
  id: string; productId: string | null; journeyId: string | null; outcomeId: string | null;
  kind: string; title: string; detail: string | null; severity: string; status: string; createdAt: string | null;
}
interface Row {
  id: string; product_id: string | null; journey_id: string | null; outcome_id: string | null;
  kind: string; title: string; detail: string | null; severity: string; status: string; created_at: string | null;
}
const toGap = (r: Row): GapRecord => ({
  id: r.id, productId: r.product_id, journeyId: r.journey_id, outcomeId: r.outcome_id,
  kind: r.kind, title: r.title, detail: r.detail, severity: r.severity, status: r.status, createdAt: r.created_at,
});
const SELECT = `SELECT id, product_id, journey_id, outcome_id, kind, title, detail, severity, status, created_at FROM gap_records`;

export async function createGapRecord(input: GapInput, actor = 'system'): Promise<{ gapId: string }> {
  if (!input?.title?.trim()) throw new Error('gap title required');
  if (!input?.kind?.trim()) throw new Error('gap kind required');
  const id = (await db().query<{ id: string }>(
    `INSERT INTO gap_records (product_id, journey_id, outcome_id, kind, title, detail, severity, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [input.productId ?? null, input.journeyId ?? null, input.outcomeId ?? null, input.kind.trim(),
     input.title.trim(), input.detail ?? null, input.severity ?? 'weakens', actor],
  )).rows[0].id;
  return { gapId: id };
}

/** Open + recently-resolved gaps for a product (newest first); excludes archived. */
export async function getGapRecords(productId: string): Promise<GapRecord[]> {
  const { rows } = await db().query<Row>(
    `${SELECT} WHERE product_id = $1 AND archived_at IS NULL ORDER BY (status='open') DESC, created_at DESC`, [productId]);
  return rows.map(toGap);
}

export async function getGapsForJourney(journeyId: string): Promise<GapRecord[]> {
  const { rows } = await db().query<Row>(`${SELECT} WHERE journey_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`, [journeyId]);
  return rows.map(toGap);
}

/** Mark a gap resolved (the upstream artifact now exists) or dismissed (not needed for this journey). Audited via stamps. */
export async function setGapStatus(gapId: string, status: GapStatus, actor = 'system'): Promise<void> {
  const before = (await db().query<{ id: string }>(`SELECT id FROM gap_records WHERE id = $1`, [gapId])).rows[0];
  if (!before) throw new Error('gap not found');
  const resolved = status === 'resolved' || status === 'dismissed';
  await db().query(
    `UPDATE gap_records SET status = $2, resolved_by = $3, resolved_at = ${resolved ? 'now()' : 'NULL'} WHERE id = $1`,
    [gapId, status, resolved ? actor : null]);
}

export async function archiveGapRecord(gapId: string, actor = 'system'): Promise<void> {
  await db().query(`UPDATE gap_records SET archived_at = now(), archived_by = $2 WHERE id = $1`, [gapId, actor]);
}

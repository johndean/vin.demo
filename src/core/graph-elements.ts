/**
 * Demo Graph per-node ELEMENTS (Phase: PO.vin total coverage) — the real UX surface of a screen as
 * first-class rows: fields / buttons / actions / tabs / errors / FAQs / workflow-interactions. This is what
 * lets a node represent 100% of a page (function, buttons, actions, forms), not just a route + selectors.
 *
 * `demo_graph_node_elements` is the NORMALIZED source of truth; `demo_graph_nodes.page_facts` is a
 * DENORMALIZED render snapshot rebuilt from the elements by assemblePageFacts(). Both are written in the
 * same pass (by the seed / autogen) so they never drift. Writes are idempotent (upsert by
 * (node_id, element_type, lower(label))) and audited best-effort via recordGraphEvent (never throws).
 *
 * FIREWALL: callers pass BUSINESS-FACING labels/detail only — no RPC (fn_*), file (*.ts), or SQL strings
 * (those live in locator_strategies / source provenance, never in user- or AI-readable element text).
 */
import { db } from './db.js';
import { recordGraphEvent } from './graph-lifecycle.js';

export type ElementType = 'field' | 'button' | 'action' | 'tab' | 'section' | 'error' | 'faq' | 'workflow_interaction' | 'note';
export type ImplementationStatus = 'live' | 'partial' | 'dead_ui' | 'unwired' | 'unknown';

export interface NodeElementInput {
  elementType: ElementType;
  label: string;
  detail?: Record<string, unknown>;
  implementationStatus?: ImplementationStatus;
  sortOrder?: number;
  sourceChunkId?: string | null;
}

export interface NodeElementRow extends NodeElementInput {
  id: string;
  detail: Record<string, unknown>;
  implementationStatus: ImplementationStatus;
  sortOrder: number;
}

/** Idempotent upsert of a node's elements. Insert if absent (by node+type+lower(label)); else update
 *  detail/status/sort in place. Returns counts. Best-effort audit per node (one event, not one per row). */
export async function upsertNodeElements(nodeId: string, elements: NodeElementInput[], actor = 'system'): Promise<{ inserted: number; updated: number }> {
  let inserted = 0, updated = 0;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const label = (el.label ?? '').trim();
    if (!label) continue;
    const detail = el.detail ?? {};
    const status = el.implementationStatus ?? 'live';
    const sort = el.sortOrder ?? i;
    const existing = (await db().query<{ id: string }>(
      `SELECT id FROM demo_graph_node_elements WHERE node_id=$1 AND element_type=$2 AND lower(label)=lower($3) AND archived_at IS NULL LIMIT 1`,
      [nodeId, el.elementType, label])).rows[0];
    if (existing) {
      await db().query(
        `UPDATE demo_graph_node_elements SET detail=$2::jsonb, implementation_status=$3, sort_order=$4, source_chunk_id=$5, updated_by=$6, updated_at=now() WHERE id=$1`,
        [existing.id, JSON.stringify(detail), status, sort, el.sourceChunkId ?? null, actor]);
      updated++;
    } else {
      await db().query(
        `INSERT INTO demo_graph_node_elements (node_id, element_type, label, detail, implementation_status, sort_order, source_chunk_id, created_by)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
        [nodeId, el.elementType, label, JSON.stringify(detail), status, sort, el.sourceChunkId ?? null, actor]);
      inserted++;
    }
  }
  if (inserted || updated) {
    await recordGraphEvent('edit', { nodeId, actor, after: { elements_upserted: inserted + updated, inserted, updated } });
  }
  return { inserted, updated };
}

/** All non-archived elements for a node, ordered for display. */
export async function getNodeElements(nodeId: string): Promise<NodeElementRow[]> {
  const rows = (await db().query<{ id: string; element_type: ElementType; label: string; detail: any; implementation_status: ImplementationStatus; sort_order: number; source_chunk_id: string | null }>(
    `SELECT id, element_type, label, detail, implementation_status, sort_order, source_chunk_id
       FROM demo_graph_node_elements WHERE node_id=$1 AND archived_at IS NULL
      ORDER BY sort_order, element_type, label`, [nodeId])).rows;
  return rows.map((r) => ({
    id: r.id, elementType: r.element_type, label: r.label, detail: r.detail ?? {},
    implementationStatus: r.implementation_status, sortOrder: r.sort_order, sourceChunkId: r.source_chunk_id,
  }));
}

/** Soft-archive every element for a node (used when re-seeding to replace a page's surface cleanly). */
export async function archiveNodeElements(nodeId: string, actor = 'system'): Promise<number> {
  const r = await db().query(`UPDATE demo_graph_node_elements SET archived_at=now(), archived_by=$2 WHERE node_id=$1 AND archived_at IS NULL`, [nodeId, actor]);
  return r.rowCount ?? 0;
}

/** Rebuild demo_graph_nodes.page_facts from the node's elements + an optional `extra` bag (purpose / layout
 *  / roles supplied by the seed). Groups elements by type, computes counts, and surfaces dead/unwired
 *  honesty markers. Returns the snapshot. Best-effort audit. */
export async function assemblePageFacts(nodeId: string, extra: Record<string, unknown> = {}, actor = 'system'): Promise<Record<string, unknown>> {
  const els = await getNodeElements(nodeId);
  const group = (t: ElementType) => els.filter((e) => e.elementType === t).map((e) => ({ label: e.label, status: e.implementationStatus, ...e.detail }));
  const counts: Record<string, number> = {};
  for (const e of els) counts[e.elementType] = (counts[e.elementType] ?? 0) + 1;
  const notLive = els.filter((e) => e.implementationStatus !== 'live').map((e) => ({ label: e.label, status: e.implementationStatus }));
  const facts = {
    ...extra,
    counts,
    fields: group('field'),
    buttons: group('button'),
    actions: group('action'),
    tabs: group('tab'),
    sections: group('section'),
    errors: group('error'),
    faqs: group('faq'),
    workflowInteractions: group('workflow_interaction'),
    notes: group('note'),
    honestyMarkers: notLive,           // dead_ui / unwired / partial / unknown — never hidden
    elementCount: els.length,
  };
  await db().query(`UPDATE demo_graph_nodes SET page_facts=$2::jsonb, updated_by=$3, updated_at=now() WHERE id=$1`, [nodeId, JSON.stringify(facts), actor]);
  await recordGraphEvent('edit', { nodeId, actor, after: { page_facts_rebuilt: true, elementCount: els.length } });
  return facts;
}

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

/** RC-06: a COMPACT, demo-time read of a node's UX surface — the key buttons / actions / required fields /
 *  permissions for the screen we just navigated to — so answerAs/narrate can speak from what's ACTUALLY on the
 *  page (product-aware consultant) instead of only the doc chunk. Honesty markers (dead_ui/unwired/partial) are
 *  surfaced, live elements only otherwise. Capped (~400 chars) so it never bloats the prompt. Null when the node
 *  has no modeled elements (the in-code answerAs hint then simply doesn't fire). Never throws. */
export async function screenFactsFor(nodeId: string): Promise<string | null> {
  try {
    const els = await getNodeElements(nodeId);
    if (!els.length) return null;
    const live = (t: ElementType) => els.filter((e) => e.elementType === t && e.implementationStatus === 'live').map((e) => e.label);
    const buttons = live('button').concat(live('action'));               // what the user can DO here
    const required = els.filter((e) => e.elementType === 'field' && e.detail?.required === true).map((e) => e.label);
    const fields = required.length ? required : live('field');            // prefer required fields; else any fields
    // Permissions: element-level visibleTo / role gating modeled in detail (RC-06 P1 — never SELECTed at runtime before).
    const perms = Array.from(new Set(els.flatMap((e) => {
      const v = e.detail?.visibleTo ?? e.detail?.roles ?? e.detail?.permission;
      return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
    })));
    const notLive = els.filter((e) => e.implementationStatus !== 'live').map((e) => `${e.label} (${e.implementationStatus})`);
    const parts = [
      buttons.length ? `actions: ${buttons.slice(0, 6).join(', ')}` : '',
      fields.length ? `${required.length ? 'required fields' : 'fields'}: ${fields.slice(0, 6).join(', ')}` : '',
      perms.length ? `requires: ${perms.slice(0, 3).join(', ')}` : '',
      notLive.length ? `not live: ${notLive.slice(0, 3).join(', ')}` : '',
    ].filter(Boolean);
    if (!parts.length) return null;
    const s = `On this screen — ${parts.join('; ')}.`;
    return s.length > 400 ? s.slice(0, 397) + '...' : s;
  } catch { return null; }
}

/** Experience-audit #8/#35: a node's NARRATION context — its display screen name, its purpose (from page_facts),
 *  and the compact screenFacts surface — resolved by (productId, intent_label) from the product's ACTIVE graph.
 *  This is STATIC metadata (no live DOM), so the walk's narrate() can be product-aware AND still run concurrently
 *  with the live drive (Wave-A #13). Best-effort: any miss/failure → nulls, and narrate falls back to the label. */
export async function nodeNarrationFacts(productId: string | null, intentLabel: string): Promise<{ screenName: string | null; purpose: string | null; screenFacts: string | null }> {
  const empty = { screenName: null, purpose: null, screenFacts: null };
  if (!productId || !intentLabel) return empty;
  try {
    const node = (await db().query<{ id: string; screen_name: string | null; page_facts: any }>(
      `SELECT n.id, n.screen_name, n.page_facts
         FROM demo_graph_nodes n JOIN demo_graphs g ON g.id = n.demo_graph_id
        WHERE g.product_id = $1 AND g.status = 'active' AND g.archived_at IS NULL
          AND lower(n.intent_label) = lower($2) AND n.archived_at IS NULL AND n.verification_status <> 'broken'
        ORDER BY g.graph_version DESC LIMIT 1`, [productId, intentLabel])).rows[0];
    if (!node) return empty;
    const purpose = node.page_facts && typeof node.page_facts.purpose === 'string' ? node.page_facts.purpose : null;
    const screenFacts = await screenFactsFor(node.id);
    return { screenName: node.screen_name ?? null, purpose, screenFacts };
  } catch { return empty; }
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

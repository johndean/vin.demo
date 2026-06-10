/**
 * Knowledge governance helpers — provenance (sources), the 5-state chunk lifecycle, and the mutation
 * audit trail (knowledge_events). Writes are BEST-EFFORT (try/catch) like governance.ts: a logging
 * failure must never break the loop or a seed. The retrieval gate (retrieval.ts), the in-console
 * knowledge actions (Phase C), and computeConfidence (Phase D) all build on these. Source is scoped to
 * PRODUCT — one demo target per product today (see migration 0011; a `sites` table is deferred).
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';

export type KnowledgeAction = 'create' | 'edit' | 'validate' | 'deprecate' | 'archive' | 'reindex';
export type LifecycleState = 'draft' | 'pending_review' | 'validated' | 'deprecated' | 'archived';
export type SourceType = 'doc' | 'faq' | 'sop' | 'release_note' | 'competitor_positioning' | 'recon' | 'manual';

// Trust weight per source class (0..1) — a real, defensible ordering used by computeConfidence (Phase D):
// SOPs/product docs are authoritative; FAQ slightly less; marketing/recon are weaker for factual claims.
const SOURCE_QUALITY: Record<SourceType, number> = {
  sop: 0.92, doc: 0.9, release_note: 0.85, faq: 0.78, manual: 0.75, competitor_positioning: 0.65, recon: 0.5,
};
export function sourceQualityFor(t: SourceType): number { return SOURCE_QUALITY[t] ?? 0.7; }

export interface ConfidenceCalc { value: number; factors: { sourceQuality: number; recency: number } }
/** Calculated confidence (Phase D) from the factors we have REAL signal for at this scale: source_quality
 *  (the source class's trust weight) + recency (decay from last_verified). cross_source_agreement and
 *  retrieval-frequency are deliberately OMITTED — no real signal over a small curated corpus, so including
 *  them would be a precise-looking but fake number. The factors map carries only the two true inputs. */
export function computeConfidence(sourceQuality: number, recencyDays: number | null): ConfidenceCalc {
  const recency = recencyDays == null ? 0.6 : Math.max(0.4, Math.min(1, 1 - recencyDays / 360));
  const value = Math.round((sourceQuality * 0.6 + recency * 0.4) * 100) / 100;
  return { value, factors: { sourceQuality: Math.round(sourceQuality * 100) / 100, recency: Math.round(recency * 100) / 100 } };
}

/** Map a chunk's `category` to a source_type (the migration's CHECK enum). */
export function inferSourceType(category: string | null | undefined): SourceType {
  const c = (category ?? '').toLowerCase();
  if (c === 'faq') return 'faq';
  if (c === 'sop') return 'sop';
  if (c === 'release_note') return 'release_note';
  if (c === 'competitor_positioning') return 'competitor_positioning';
  if (c === 'recon') return 'recon';
  return 'doc';
}

/** Map the legacy `validation_status` to the 5-state lifecycle (so the two stay consistent). */
export function mapLifecycle(validationStatus: string | null | undefined): LifecycleState {
  switch ((validationStatus ?? '').toLowerCase()) {
    case 'validated': return 'validated';
    case 'pending': return 'pending_review';
    case 'stale': return 'deprecated';
    default: return 'draft'; // 'unverified' / unknown → not retrievable
  }
}

export interface EnsureSourceOpts {
  title: string;
  sourceType?: SourceType;
  owner?: string;
  quality?: number;
  uri?: string | null;
  reviewCycleDays?: number | null;
  lastVerified?: string | null;
  versionId?: string | null;
  createdBy?: string;
}
/** Idempotent upsert of a knowledge_sources row keyed by (product_id, title). Returns its id (or null on
 *  failure — callers fall back to source_id=null, which is harmless). Shared by the seeds, the backfill,
 *  and the in-console Add-source action so every chunk gets a real source row. */
export async function ensureSource(productId: string, o: EnsureSourceOpts): Promise<string | null> {
  if (!productId || !o.title) return null;
  try {
    const found = await db().query<{ id: string }>(
      'SELECT id FROM knowledge_sources WHERE product_id = $1 AND title = $2 LIMIT 1', [productId, o.title],
    );
    if (found.rows[0]) return found.rows[0].id;
    const st: SourceType = o.sourceType ?? 'doc';
    const quality = typeof o.quality === 'number' ? o.quality : sourceQualityFor(st);
    const res = await db().query<{ id: string }>(
      `INSERT INTO knowledge_sources
         (product_id, product_version_id, title, source_type, uri, owner, source_quality, review_cycle_days, last_verified, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (product_id, title) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [productId, o.versionId ?? null, o.title, st, o.uri ?? null, o.owner ?? 'VIN Demo (internal)',
       quality, o.reviewCycleDays ?? null, o.lastVerified ?? null, o.createdBy ?? 'seed'],
    );
    return res.rows[0]?.id ?? null;
  } catch (e) { console.error('[knowledge] ensureSource failed (best-effort):', e); return null; }
}

export interface KnowledgeEvent {
  chunkId?: string | null;
  sourceId?: string | null;
  productId?: string | null;
  actor?: string;
  before?: unknown;
  after?: unknown;
}
/** Record a knowledge MUTATION (create/edit/validate/deprecate/archive/reindex) to the audit trail.
 *  Best-effort — a write failure logs but never throws into the caller. */
export async function recordKnowledgeEvent(action: KnowledgeAction, e: KnowledgeEvent): Promise<void> {
  try {
    await db().query(
      `INSERT INTO knowledge_events (chunk_id, source_id, product_id, action, actor, before, after)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [e.chunkId ?? null, e.sourceId ?? null, e.productId ?? null, action, e.actor ?? 'system',
       e.before != null ? JSON.stringify(e.before) : null, e.after != null ? JSON.stringify(e.after) : null],
    );
  } catch (err) { console.error('[knowledge] recordKnowledgeEvent failed (best-effort):', err); }
}

// ── In-console knowledge MUTATIONS (Phase C). Each does the real work (embed where needed) + records a
// knowledge_events row. Engine-side (DB + Voyage live here); the web console reaches these via the
// engine's /knowledge endpoint (RBAC-proxied). Bounded TEXT path — no document parser (deferred). ──

export interface AddChunkInput { productId: string; content: string; sourceTitle: string; sourceType?: SourceType; category?: string; actor: string; }
/** Add a chunk from pasted text: ensureSource → Voyage embed → insert as DRAFT (not retrievable until
 *  validated — operator-added knowledge is unverified by default) → audit. */
export async function addChunk(i: AddChunkInput): Promise<{ id: string }> {
  if (!i.content?.trim() || !i.sourceTitle?.trim()) throw new Error('content and sourceTitle are required');
  const kb = (await db().query<{ id: string }>('SELECT id FROM knowledge_bases WHERE product_id=$1 ORDER BY id LIMIT 1', [i.productId])).rows[0];
  if (!kb) throw new Error('no knowledge base for product');
  const ver = (await db().query<{ id: string }>(`SELECT id FROM product_versions WHERE product_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [i.productId])).rows[0];
  const cat = i.category ?? 'docs';
  const st = i.sourceType ?? inferSourceType(cat);
  const sourceId = await ensureSource(i.productId, { title: i.sourceTitle, sourceType: st, owner: i.actor, versionId: ver?.id ?? null, createdBy: i.actor });
  const [emb] = await getEmbeddingProvider().embed([i.content]);
  // Calculated confidence (Phase D) — from source class quality + recency (fresh), not an arbitrary constant.
  const conf = computeConfidence(sourceQualityFor(st), 0).value;
  const res = await db().query<{ id: string }>(
    `INSERT INTO knowledge_chunks
       (knowledge_base_id, product_version_id, category, content, embedding, confidence, source, last_verified, validation_status, source_id, lifecycle_state, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now()::date,'unverified',$8,'draft',now()) RETURNING id`,
    [kb.id, ver?.id ?? null, cat, i.content, toVector(emb), conf, i.sourceTitle, sourceId],
  );
  const id = res.rows[0].id;
  await recordKnowledgeEvent('create', { chunkId: id, sourceId, productId: i.productId, actor: i.actor, after: { content: i.content.slice(0, 160), source: i.sourceTitle, lifecycle_state: 'draft' } });
  return { id };
}

/** Edit a chunk's content: snapshot → re-embed (keeps the vector in sync = reindex) → back to
 *  PENDING_REVIEW (an edit invalidates prior validation) → audit before/after. */
export async function editChunk(i: { chunkId: string; content: string; actor: string }): Promise<{ id: string }> {
  if (!i.content?.trim()) throw new Error('content is required');
  const before = (await db().query<{ content: string; lifecycle_state: string; product_id: string; source_id: string | null }>(
    `SELECT kc.content, kc.lifecycle_state, kb.product_id, kc.source_id FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kc.id=$1`, [i.chunkId])).rows[0];
  if (!before) throw new Error('chunk not found');
  const [emb] = await getEmbeddingProvider().embed([i.content]);
  await db().query(
    `UPDATE knowledge_chunks SET content=$2, embedding=$3, updated_at=now(),
        lifecycle_state='pending_review', validation_status='pending', validated_by=NULL, validated_at=NULL WHERE id=$1`,
    [i.chunkId, i.content, toVector(emb)],
  );
  await recordKnowledgeEvent('edit', { chunkId: i.chunkId, sourceId: before.source_id, productId: before.product_id, actor: i.actor,
    before: { content: String(before.content).slice(0, 160), lifecycle_state: before.lifecycle_state }, after: { content: i.content.slice(0, 160), lifecycle_state: 'pending_review' } });
  return { id: i.chunkId };
}

/** Validate (the wired "Re-verify"): mark validated + record who/when/how → audit. */
export async function validateChunk(i: { chunkId: string; actor: string; method?: string }): Promise<{ id: string }> {
  const before = (await db().query<{ lifecycle_state: string; product_id: string; source_id: string | null }>(
    `SELECT kc.lifecycle_state, kb.product_id, kc.source_id FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kc.id=$1`, [i.chunkId])).rows[0];
  if (!before) throw new Error('chunk not found');
  await db().query(
    `UPDATE knowledge_chunks SET lifecycle_state='validated', validation_status='validated',
        validated_by=$2, validated_at=now(), validation_method=$3, last_verified=now()::date, updated_at=now() WHERE id=$1`,
    [i.chunkId, i.actor, i.method ?? 'human_review'],
  );
  await recordKnowledgeEvent('validate', { chunkId: i.chunkId, sourceId: before.source_id, productId: before.product_id, actor: i.actor,
    before: { lifecycle_state: before.lifecycle_state }, after: { lifecycle_state: 'validated', validated_by: i.actor } });
  return { id: i.chunkId };
}

/** Archive (not delete): set archived_at/by + lifecycle archived → the gate makes it un-retrievable. Audit. */
export async function archiveChunk(i: { chunkId: string; actor: string }): Promise<{ id: string }> {
  const before = (await db().query<{ lifecycle_state: string; product_id: string; source_id: string | null }>(
    `SELECT kc.lifecycle_state, kb.product_id, kc.source_id FROM knowledge_chunks kc JOIN knowledge_bases kb ON kb.id=kc.knowledge_base_id WHERE kc.id=$1`, [i.chunkId])).rows[0];
  if (!before) throw new Error('chunk not found');
  await db().query(`UPDATE knowledge_chunks SET archived_at=now(), archived_by=$2, lifecycle_state='archived', updated_at=now() WHERE id=$1`, [i.chunkId, i.actor]);
  await recordKnowledgeEvent('archive', { chunkId: i.chunkId, sourceId: before.source_id, productId: before.product_id, actor: i.actor,
    before: { lifecycle_state: before.lifecycle_state }, after: { lifecycle_state: 'archived' } });
  return { id: i.chunkId };
}

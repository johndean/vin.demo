/**
 * Retrieval + the 4-gate trust check (confidence · validation · staleness · relevance),
 * extracted so the graph's `retrieve` node and coverage scoring (P2.4) apply ONE gate,
 * not two that can drift. `gateForVector` takes a pre-computed embedding so callers that
 * score many queries can embed them in a single batch.
 */
import { db, toVector } from './db.js';
import { getEmbeddingProvider } from './embeddings.js';
import type { RetrievedChunk } from './state.js';

export const CONFIDENCE_THRESHOLD = 0.6;
export const RELEVANCE_MAX_DISTANCE = 0.65; // empirically calibrated to voyage-3 (in-scope ~0.42–0.47)
export const MAX_VERIFY_AGE_DAYS = 180;

export interface GateResult {
  rows: RetrievedChunk[];
  top: RetrievedChunk | undefined;
  gated: boolean;
  reason: string;
  ageDays: number | null;
}

/** DB query for the top chunks of a product + the 4-gate trust check, for a query vector. */
export async function gateForVector(vec: number[], productId: string | null): Promise<GateResult> {
  const params: unknown[] = [toVector(vec)];
  const conds = ['kc.embedding IS NOT NULL'];
  if (productId) {
    params.push(productId);
    conds.push(`kb.product_id = $${params.length}`);
  }
  const { rows } = await db().query<RetrievedChunk>(
    `SELECT kc.content, kc.category, kc.confidence, kc.source,
            kc.last_verified::text AS last_verified, kc.validation_status,
            pv.version_label AS product_version, pv.status AS product_version_status,
            (kc.embedding <=> $1) AS distance
       FROM knowledge_chunks kc
       JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
       LEFT JOIN product_versions pv ON pv.id = kc.product_version_id
       WHERE ${conds.join(' AND ')}
       ORDER BY kc.embedding <=> $1 LIMIT 4`,
    params,
  );
  const top = rows[0];
  const ageDays = top?.last_verified != null ? Math.floor((Date.now() - Date.parse(top.last_verified)) / 86_400_000) : null;
  const lowConfidence = !top || top.confidence < CONFIDENCE_THRESHOLD;
  const untrusted = !top || top.validation_status !== 'validated';
  const timeStale = ageDays == null || ageDays > MAX_VERIFY_AGE_DAYS;
  // Gap B (lifecycle): knowledge tied to a superseded (deprecated/retired) product version degrades.
  const versionStale = !!top && top.product_version_status != null && top.product_version_status !== 'active';
  const irrelevant = !top || top.distance == null || top.distance > RELEVANCE_MAX_DISTANCE;
  const gated = lowConfidence || untrusted || timeStale || versionStale || irrelevant;
  const reason = !top ? 'no knowledge'
    : lowConfidence ? `low confidence (${top.confidence})`
    : untrusted ? `not validated (${top.validation_status})`
    : timeStale ? `stale (verified ${ageDays ?? '?'}d ago)`
    : versionStale ? `superseded product version (${top.product_version_status}) — show the current version`
    : irrelevant ? `not relevant (distance ${top.distance?.toFixed(3) ?? 'n/a'})`
    : 'ok';
  return { rows, top, gated, reason, ageDays };
}

/** Embed a single query, then gate. (The graph's per-turn path.) */
export async function retrieveAndGate(query: string, productId: string | null): Promise<GateResult> {
  const [vec] = await getEmbeddingProvider().embed([query]);
  return gateForVector(vec, productId);
}

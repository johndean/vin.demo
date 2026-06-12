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
// "Navigable" band: related enough to the product to SHOW a screen even when we can't confidently
// ANSWER (gated). Showing the live product is not inventing — so a gated-but-navigable query still
// navigates (the agent shows the relevant screen, honestly soft on specifics). Beyond this distance
// the query is genuinely off-topic (e.g. "capital of France") → deflect with no navigation.
export const NAVIGABLE_MAX_DISTANCE = 0.9;
export const MAX_VERIFY_AGE_DAYS = 180;

// Graded confidence (replaces the single pass/fail): drives per-band specialist behavior
// (high→answer directly · medium→answer+cite · low→cautious · very_low→refuse+escalate).
export type ConfidenceBand = 'high' | 'medium' | 'low' | 'very_low';
const HIGH_CONF = 0.85, HIGH_DISTANCE = 0.47, MEDIUM_CONF = 0.7;

export interface GateResult {
  rows: RetrievedChunk[];
  top: RetrievedChunk | undefined;
  gated: boolean;
  navigable: boolean; // gated answer, but relevant enough to still show a screen
  band: ConfidenceBand;
  reason: string;
  ageDays: number | null;
}

// Knowledge hierarchy: map a chunk to its priority index within the persona's ordered knowledgePriority
// (lower = preferred). Matches the priority label against the chunk's category (via synonyms) or source.
// Used to RE-RANK already-retrieved relevant chunks — never to filter (so it can't starve retrieval).
const CAT_SYNONYMS: Record<string, string[]> = {
  docs: ['documentation', 'docs', 'product doc', 'guide', 'manual', 'reference', 'api', 'spec', 'integration'],
  release_note: ['release', 'changelog', 'version'],
  competitor_positioning: ['marketing', 'competitor', 'competitive', 'positioning', 'sales'],
  faq: ['faq', 'frequently asked', 'q&a'],
  sop: ['sop', 'procedure', 'runbook', 'process', 'policy'],
};
export function priorityRank(row: RetrievedChunk, priority: string[]): number {
  const cat = (row.category ?? '').toLowerCase();
  const src = (row.source ?? '').toLowerCase();
  const syn = CAT_SYNONYMS[cat] ?? [];
  for (let i = 0; i < priority.length; i++) {
    const label = priority[i].toLowerCase();
    const words = label.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (syn.some((s) => label.includes(s)) || words.some((w) => src.includes(w) || cat.includes(w))) return i;
  }
  return priority.length; // unmatched → lowest priority
}

/** DB query for the top chunks of a product + the 4-gate trust check, for a query vector.
 *  `minConfidence` overrides the default threshold (an active specialist persona can demand a
 *  stricter bar before it will answer — a real, per-persona effect on the gate). */
export async function gateForVector(vec: number[], productId: string | null, minConfidence?: number | null, knowledgePriority?: string[]): Promise<GateResult> {
  const confFloor = typeof minConfidence === 'number' && minConfidence > 0 ? minConfidence : CONFIDENCE_THRESHOLD;
  const params: unknown[] = [toVector(vec)];
  // archived chunks are NEVER retrievable (the spec's archive-not-delete; migration 0011).
  const conds = ['kc.embedding IS NOT NULL', 'kc.archived_at IS NULL'];
  if (productId) {
    params.push(productId);
    conds.push(`kb.product_id = $${params.length}`);
  }
  let rows = (await db().query<RetrievedChunk>(
    `SELECT kc.content, kc.category, kc.confidence, kc.source,
            kc.last_verified::text AS last_verified, kc.validation_status, kc.lifecycle_state,
            kc.validated_by, kc.validated_at::text AS validated_at,
            ks.owner AS source_owner, ks.title AS source_title, ks.source_type,
            pv.version_label AS product_version, pv.status AS product_version_status,
            (kc.embedding <=> $1) AS distance
       FROM knowledge_chunks kc
       JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
       LEFT JOIN knowledge_sources ks ON ks.id = kc.source_id
       LEFT JOIN product_versions pv ON pv.id = kc.product_version_id
       WHERE ${conds.join(' AND ')}
       ORDER BY kc.embedding <=> $1 LIMIT 4`,
    params,
  )).rows;
  // Knowledge hierarchy: an active specialist re-ranks the RELEVANT retrieved chunks by its source
  // priority (prefer e.g. product docs over marketing). Re-rank only the relevant set so `top` stays
  // relevant (never promotes an off-topic chunk); a no-op when no priority / nothing matches.
  if (knowledgePriority && knowledgePriority.length && rows.length > 1) {
    const inBand = (r: RetrievedChunk) => r.distance != null && r.distance <= RELEVANCE_MAX_DISTANCE;
    const relevant = rows.filter(inBand).sort((a, b) => (priorityRank(a, knowledgePriority) - priorityRank(b, knowledgePriority)) || ((a.distance ?? 9) - (b.distance ?? 9)));
    rows = [...relevant, ...rows.filter((r) => !inBand(r))];
  }
  const top = rows[0];
  const ageDays = top?.last_verified != null ? Math.floor((Date.now() - Date.parse(top.last_verified)) / 86_400_000) : null;
  const lowConfidence = !top || top.confidence < confFloor;
  const notValidated = !top || top.validation_status !== 'validated';
  // 5-state lifecycle (migration 0011): draft / pending_review are not yet retrievable; deprecated is
  // gated (historical) so the loop shows the current version instead. validation_status is kept in sync
  // with lifecycle_state, so this is an explicit retrievability rule + belt-and-suspenders.
  const lifecycleBlocked = !!top && (top.lifecycle_state === 'draft' || top.lifecycle_state === 'pending_review');
  const deprecated = !!top && top.lifecycle_state === 'deprecated';
  const untrusted = notValidated || lifecycleBlocked;
  const timeStale = ageDays == null || ageDays > MAX_VERIFY_AGE_DAYS;
  // Gap B (lifecycle): knowledge tied to a superseded (deprecated/retired) product version degrades.
  const versionStale = !!top && top.product_version_status != null && top.product_version_status !== 'active';
  const irrelevant = !top || top.distance == null || top.distance > RELEVANCE_MAX_DISTANCE;
  const gated = lowConfidence || untrusted || deprecated || timeStale || versionStale || irrelevant;
  // Navigable when there's a chunk within the wider band — relevant enough to show a screen even if gated.
  const navigable = !!top && top.distance != null && top.distance <= NAVIGABLE_MAX_DISTANCE;
  // Graded confidence band (drives per-persona behavior). very_low = the gated/refuse path; otherwise
  // grade by how strong + close the top chunk is.
  const band: ConfidenceBand = gated ? 'very_low'
    : (top!.confidence >= HIGH_CONF && (top!.distance ?? 1) <= HIGH_DISTANCE) ? 'high'
    : top!.confidence >= MEDIUM_CONF ? 'medium'
    : 'low';
  const reason = !top ? 'no knowledge'
    : lowConfidence ? `low confidence (${top.confidence})`
    : lifecycleBlocked ? `not validated yet (${top.lifecycle_state})`
    : notValidated ? `not validated (${top.validation_status})`
    : deprecated ? `deprecated knowledge — show the current version`
    : timeStale ? `stale (verified ${ageDays ?? '?'}d ago)`
    : versionStale ? `superseded product version (${top.product_version_status}) — show the current version`
    : irrelevant ? `not relevant (distance ${top.distance?.toFixed(3) ?? 'n/a'})`
    : 'ok';
  return { rows, top, gated, navigable, band, reason, ageDays };
}

/** Wave C #18: does a SINGLE chunk INDEPENDENTLY clear the SAME trust bar gateForVector applies to `top`
 *  (confidence floor · validated · lifecycle not draft/pending/deprecated · fresh · ACTIVE product version ·
 *  relevant)? Used to gate a SECONDARY source so an extra grounded clause can NEVER come from an untrusted,
 *  draft/deprecated, stale, version-superseded, or off-topic chunk — closing the gap that gateForVector (which
 *  validates only rows[0]) leaves on rows[1+]. Reuses the same constants, so it can't drift from the primary gate. */
export function chunkPassesGate(c: RetrievedChunk | undefined | null, minConfidence?: number | null): boolean {
  if (!c) return false;
  const confFloor = typeof minConfidence === 'number' && minConfidence > 0 ? minConfidence : CONFIDENCE_THRESHOLD;
  const ageDays = c.last_verified != null ? Math.floor((Date.now() - Date.parse(c.last_verified)) / 86_400_000) : null;
  return c.confidence >= confFloor
    && c.validation_status === 'validated'
    && c.lifecycle_state !== 'draft' && c.lifecycle_state !== 'pending_review' && c.lifecycle_state !== 'deprecated'
    && (c.product_version_status == null || c.product_version_status === 'active')
    && ageDays != null && ageDays <= MAX_VERIFY_AGE_DAYS
    && c.distance != null && c.distance <= RELEVANCE_MAX_DISTANCE;
}

/** Embed a single query, then gate. (The graph's per-turn path.) */
export async function retrieveAndGate(query: string, productId: string | null, minConfidence?: number | null, knowledgePriority?: string[]): Promise<GateResult> {
  const [vec] = await getEmbeddingProvider().embed([query]);
  return gateForVector(vec, productId, minConfidence, knowledgePriority);
}

/**
 * The single LangGraph loop (one loop, not many agents — plan §4).
 * Increment 1: interpret → retrieve. navigate / explain / recover land next.
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { DemoState, type DemoStateT, type RetrievedChunk } from './state.js';
import { getLlm } from './llm.js';
import { getEmbeddingProvider } from './embeddings.js';
import { db, toVector } from './db.js';

const CONFIDENCE_THRESHOLD = 0.6;   // trust: chunk's own validated confidence
const RELEVANCE_MAX_DISTANCE = 0.65; // relevance: cosine distance of the best match
// Both gates matter: a high-confidence chunk that's semantically far from the
// question is the wrong answer, and answering it would be "confidently demoing
// the wrong thing". Gate on either failing.

/** interpret — utterance → intent + kind (intent-driven, never script-driven). */
async function interpret(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const interpretation = await getLlm().interpret(state.utterance);
  return {
    interpretation,
    trace: [`interpret: kind=${interpretation.kind} intent="${interpretation.intent}"`],
  };
}

/** retrieve — semantic search over knowledge_chunks WITH trust metadata; gate on
 *  confidence / staleness (confidence-gated autonomy — plan §4). */
async function retrieve(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const query = state.interpretation?.intent ?? state.utterance;
  const [vec] = await getEmbeddingProvider().embed([query]);
  const params: unknown[] = [toVector(vec)];
  let where = '';
  if (state.productId) {
    params.push(state.productId);
    where = `WHERE kb.product_id = $${params.length}`;
  }
  const { rows } = await db().query<RetrievedChunk>(
    `SELECT kc.content, kc.category, kc.confidence, kc.source,
            kc.last_verified::text AS last_verified, kc.validation_status,
            pv.version_label AS product_version,
            (kc.embedding <=> $1) AS distance
       FROM knowledge_chunks kc
       JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
       LEFT JOIN product_versions pv ON pv.id = kc.product_version_id
       ${where}
       ORDER BY kc.embedding <=> $1
       LIMIT 4`,
    params,
  );
  const top = rows[0];
  const lowConfidence = !top || top.confidence < CONFIDENCE_THRESHOLD;
  const stale = top?.validation_status === 'stale';
  const irrelevant = !top || top.distance > RELEVANCE_MAX_DISTANCE;
  const gated = lowConfidence || stale || irrelevant;
  const reason = !top ? 'no knowledge' : lowConfidence ? 'low confidence' : stale ? 'stale' : irrelevant ? 'not relevant' : 'ok';
  return {
    retrieved: rows,
    gated,
    trace: [
      `retrieve: ${rows.length} chunks; top confidence=${top?.confidence ?? 'n/a'} ` +
        `status=${top?.validation_status ?? 'n/a'} distance=${top?.distance?.toFixed(3) ?? 'n/a'} ` +
        `→ ${gated ? `GATED (${reason}) — say "I'm not certain"` : 'answer'}`,
    ],
  };
}

export function buildGraph() {
  return new StateGraph(DemoState)
    .addNode('interpret', interpret)
    .addNode('retrieve', retrieve)
    .addEdge(START, 'interpret')
    .addEdge('interpret', 'retrieve')
    .addEdge('retrieve', END)
    .compile();
}

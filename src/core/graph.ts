/**
 * The single LangGraph loop (one loop, not many agents — plan §4).
 * Increment 1: interpret → retrieve. navigate / explain / recover land next.
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { DemoState, type DemoStateT, type RetrievedChunk } from './state.js';
import { getLlm } from './llm.js';
import { getEmbeddingProvider } from './embeddings.js';
import { db, toVector } from './db.js';
import { PoVinDriver, type DemoNode } from './driver.js';
import { record } from './cost.js';

const CONFIDENCE_THRESHOLD = 0.6;   // trust: chunk's own validated confidence
// Relevance: cosine distance of the best match. Empirically calibrated to live
// voyage-3 data (in-scope ~0.42–0.47, off-topic ~0.77+). Recalibrate against a
// labeled set as the KB grows; do NOT lower below the measured in-scope band.
const RELEVANCE_MAX_DISTANCE = 0.65;
const MAX_VERIFY_AGE_DAYS = 180;    // time-staleness: knowledge rots even when labeled "validated"
// All four gates matter — answering past any of them is "confidently demoing the
// wrong / stale / unvalidated thing", which the trust model exists to prevent.

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
  // Exclude un-embedded chunks so a NULL distance can never become the top row.
  const conds = ['kc.embedding IS NOT NULL'];
  if (state.productId) {
    params.push(state.productId);
    conds.push(`kb.product_id = $${params.length}`);
  }
  const where = 'WHERE ' + conds.join(' AND ');
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
  const ageDays =
    top?.last_verified != null ? Math.floor((Date.now() - Date.parse(top.last_verified)) / 86_400_000) : null;
  const lowConfidence = !top || top.confidence < CONFIDENCE_THRESHOLD;
  // Untrusted = anything not explicitly validated (covers both 'unverified' default and 'stale').
  const untrusted = !top || top.validation_status !== 'validated';
  // Time-stale even if labeled validated, or never time-stamped.
  const timeStale = ageDays == null || ageDays > MAX_VERIFY_AGE_DAYS;
  // Irrelevant, or a NULL distance slipping through.
  const irrelevant = !top || top.distance == null || top.distance > RELEVANCE_MAX_DISTANCE;
  const gated = lowConfidence || untrusted || timeStale || irrelevant;
  const reason = !top
    ? 'no knowledge'
    : lowConfidence ? `low confidence (${top.confidence})`
    : untrusted ? `not validated (${top.validation_status})`
    : timeStale ? `stale (verified ${ageDays ?? '?'}d ago)`
    : irrelevant ? `not relevant (distance ${top.distance?.toFixed(3) ?? 'n/a'})`
    : 'ok';
  return {
    retrieved: rows,
    gated,
    trace: [
      `retrieve: ${rows.length} chunks; top confidence=${top?.confidence ?? 'n/a'} ` +
        `status=${top?.validation_status ?? 'n/a'} age=${ageDays ?? 'n/a'}d distance=${top?.distance?.toFixed(3) ?? 'n/a'} ` +
        `→ ${gated ? `GATED (${reason}) — say "I'm not certain"` : 'answer'}`,
    ],
  };
}

/** navigate — drive the real UI to the intent's DemoGraph node (self-heal),
 *  open a PO, and prove the action classifier blocks mutations under the mode.
 *  Skipped when the answer was gated (nothing trustworthy to show). */
async function navigate(state: DemoStateT): Promise<Partial<DemoStateT>> {
  if (!state.productId) return { trace: ['navigate: skipped (no productId)'] };
  const { rows } = await db().query<DemoNode>(
    `SELECT n.intent_label, n.screen_route, n.locator_strategies, n.persona_labels
       FROM demo_graph_nodes n JOIN demo_graphs g ON g.id = n.demo_graph_id
      WHERE g.product_id = $1 LIMIT 1`,
    [state.productId],
  );
  const node = rows[0];
  if (!node) return { trace: ['navigate: no DemoGraph node for product'] };

  const driver = new PoVinDriver(state.mode);
  try {
    await driver.open(state.role);
    const nav = await driver.gotoNode(node, state.role);
    await record('navigation', 'none', {}, { url: nav.url, node: node.intent_label });
    const opened = nav.ok ? await driver.openFirstPo() : false;
    const scan = opened ? await driver.scanActions() : [];
    // Confirmed mutations (matched a verb / dangerous href) are the headline;
    // fail-closed "unknown" controls are held defensively but not claimed as mutations.
    const confirmed = scan.filter((s) => s.cls === 'mutating' && s.confident && !s.permitted).map((s) => s.label);
    const defensive = scan.filter((s) => s.cls === 'mutating' && !s.confident && !s.permitted).length;
    return {
      navigation: nav,
      actionScan: scan,
      blockedMutations: confirmed,
      trace: [
        `navigate: "${node.intent_label}" as ${state.role} → ${nav.ok ? nav.url : 'FAILED'}` +
          (nav.healedVia ? ` [self-heal via ${nav.healedVia}]` : ' [primary ok]'),
        `navigate: mode=${state.mode}; PO ${opened ? 'opened' : 'not opened'}; ` +
          (scan.length === 0
            ? 'no action panel scanned'
            : `blocked ${confirmed.length} confirmed mutating` +
              (defensive ? ` (+${defensive} unknown controls held by default-deny)` : '') +
              ` of ${scan.length} scanned`),
      ],
    };
  } catch (e: any) {
    // Don't crash the whole loop — report an honest failed navigation.
    return {
      navigation: { ok: false, healedVia: null, url: '' },
      trace: [`navigate: ERROR — ${e?.message ?? e}`],
    };
  } finally {
    await driver.close();
  }
}

export function buildGraph() {
  return new StateGraph(DemoState)
    .addNode('interpret', interpret)
    .addNode('retrieve', retrieve)
    .addNode('navigate', navigate)
    .addEdge(START, 'interpret')
    .addEdge('interpret', 'retrieve')
    // Gate decides: if we can't trust an answer, don't drive the UI.
    .addConditionalEdges('retrieve', (s: DemoStateT) => (s.gated ? END : 'navigate'), { navigate: 'navigate', [END]: END })
    .addEdge('navigate', END)
    .compile();
}

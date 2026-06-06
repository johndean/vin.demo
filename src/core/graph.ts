/**
 * The single LangGraph loop (one loop, not many agents — plan §4), multi-turn.
 *
 *   interpret ─▶ router ─┬─▶ explain ───────────────▶ END   ("why did you show that?")
 *                        ├─▶ resume  ───────────────▶ END   (pop stack, return to context)
 *                        └─▶ retrieve ─(gated?)─┬END
 *                                               └▶ navigate ▶ END  (answer + drive UI)
 *
 * A checkpointer keeps state across turns (keyed by thread_id), so a mid-flight
 * pivot pushes the current position and a later resume pops it — the demo
 * interrupts and returns to context rather than running a fixed script.
 */
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { DemoState, type DemoStateT, type RetrievedChunk, type Position } from './state.js';
import { getLlm } from './llm.js';
import { getEmbeddingProvider } from './embeddings.js';
import { db, toVector } from './db.js';
import { PoVinDriver, type DemoNode } from './driver.js';
import { record } from './cost.js';

const CONFIDENCE_THRESHOLD = 0.6;
const RELEVANCE_MAX_DISTANCE = 0.65; // empirically calibrated to voyage-3 (in-scope ~0.42–0.47)
const MAX_VERIFY_AGE_DAYS = 180;

// ── interpret ────────────────────────────────────────────────────────────────
async function interpret(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const i = await getLlm().interpret(state.utterance);
  return {
    interpretation: i,
    explanation: null, // reset per-turn so a prior "why" doesn't bleed into later turns
    gated: false,
    trace: [`interpret: kind=${i.kind}${i.isMetaExplain ? ' [meta-explain]' : ''}${i.isResume ? ' [resume]' : ''} intent="${i.intent}"`],
  };
}

// ── retrieve (confidence + validation + staleness + relevance gate) ───────────
async function retrieve(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const query = state.interpretation?.intent ?? state.utterance;
  const [vec] = await getEmbeddingProvider().embed([query]);
  const params: unknown[] = [toVector(vec)];
  const conds = ['kc.embedding IS NOT NULL'];
  if (state.productId) {
    params.push(state.productId);
    conds.push(`kb.product_id = $${params.length}`);
  }
  const { rows } = await db().query<RetrievedChunk>(
    `SELECT kc.content, kc.category, kc.confidence, kc.source,
            kc.last_verified::text AS last_verified, kc.validation_status,
            pv.version_label AS product_version, (kc.embedding <=> $1) AS distance
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
  const irrelevant = !top || top.distance == null || top.distance > RELEVANCE_MAX_DISTANCE;
  const gated = lowConfidence || untrusted || timeStale || irrelevant;
  const reason = !top ? 'no knowledge'
    : lowConfidence ? `low confidence (${top.confidence})`
    : untrusted ? `not validated (${top.validation_status})`
    : timeStale ? `stale (verified ${ageDays ?? '?'}d ago)`
    : irrelevant ? `not relevant (distance ${top.distance?.toFixed(3) ?? 'n/a'})`
    : 'ok';
  return {
    retrieved: rows,
    gated,
    trace: [`retrieve: ${rows.length} chunks; top confidence=${top?.confidence ?? 'n/a'} status=${top?.validation_status ?? 'n/a'} age=${ageDays ?? 'n/a'}d distance=${top?.distance?.toFixed(3) ?? 'n/a'} → ${gated ? `GATED (${reason})` : 'answer'}`],
  };
}

// ── shared UI-driving used by navigate + resume ──────────────────────────────
interface DriveOutcome { navigation: { ok: boolean; healedVia: string | null; url: string }; blockedMutations: string[]; opened: boolean; label: string; traceLines: string[] }

async function driveTo(state: DemoStateT, intent: string): Promise<DriveOutcome> {
  const { rows } = await db().query<DemoNode & { label?: string }>(
    `SELECT n.intent_label, n.screen_route, n.locator_strategies, n.persona_labels
       FROM demo_graph_nodes n JOIN demo_graphs g ON g.id = n.demo_graph_id
      WHERE g.product_id = $1`,
    [state.productId],
  );
  if (!rows.length) return { navigation: { ok: false, healedVia: null, url: '' }, blockedMutations: [], opened: false, label: '', traceLines: ['drive: no DemoGraph nodes'] };
  const labels = rows.map((r) => r.intent_label);
  const chosen = (await getLlm().pickNode(intent, labels)) || labels[0];
  const node = rows.find((r) => r.intent_label === chosen) ?? rows[0];

  const driver = new PoVinDriver(state.mode);
  try {
    await driver.open(state.role);
    const nav = await driver.gotoNode(node, state.role);
    await record('navigation', 'none', {}, { url: nav.url, node: node.intent_label });
    const opened = nav.ok ? await driver.openFirstPo() : false;
    const scan = opened ? await driver.scanActions() : [];
    const confirmed = scan.filter((s) => s.cls === 'mutating' && s.confident && !s.permitted).map((s) => s.label);
    const defensive = scan.filter((s) => s.cls === 'mutating' && !s.confident && !s.permitted).length;
    return {
      navigation: nav,
      blockedMutations: confirmed,
      opened,
      label: node.intent_label,
      traceLines: [
        `drive: "${node.intent_label}" as ${state.role} → ${nav.ok ? nav.url : 'FAILED'}${nav.healedVia ? ` [self-heal via ${nav.healedVia}]` : ' [primary ok]'}`,
        `drive: mode=${state.mode}; PO ${opened ? 'opened' : 'not opened'}; ${scan.length === 0 ? 'no action panel' : `blocked ${confirmed.length} confirmed mutating${defensive ? ` (+${defensive} held)` : ''} of ${scan.length}`}`,
      ],
    };
  } catch (e: any) {
    return { navigation: { ok: false, healedVia: null, url: '' }, blockedMutations: [], opened: false, label: node.intent_label, traceLines: [`drive: ERROR — ${e?.message ?? e}`] };
  } finally {
    await driver.close();
  }
}

// ── navigate (with mid-flight pivot push) ────────────────────────────────────
async function navigate(state: DemoStateT): Promise<Partial<DemoStateT>> {
  if (!state.productId) return { trace: ['navigate: skipped (no productId)'] };
  const intent = state.interpretation?.intent ?? state.utterance;
  const d = await driveTo(state, intent);
  // A pivot to a different intent pushes the current position so we can return.
  const pivot = !!state.currentPosition && state.currentPosition.intent !== intent;
  const contextStack = pivot ? [...state.contextStack, state.currentPosition as Position] : state.contextStack;
  const newPos: Position = { intent, url: d.navigation.url, answer: state.retrieved[0]?.content ?? null };
  return {
    navigation: d.navigation,
    blockedMutations: d.blockedMutations,
    currentPosition: newPos,
    contextStack,
    trace: [...(pivot ? [`pivot: pushed "${state.currentPosition!.intent}" onto the context stack (depth ${contextStack.length})`] : []), ...d.traceLines],
  };
}

// ── explain ("why did you show that?") ───────────────────────────────────────
async function explain(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const pos = state.currentPosition;
  if (!pos) return { explanation: "I haven't shown anything yet, so there's nothing to explain.", trace: ['explain: no prior position'] };
  const why = await getLlm().explainWhy({
    question: state.utterance,
    priorIntent: pos.intent,
    answer: pos.answer ?? '',
    navUrl: pos.url,
    trace: state.trace,
  });
  return { explanation: why, trace: ['explain: justified the last action from the decision trace'] };
}

// ── resume (pop the stack, return to context) ────────────────────────────────
async function resume(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const stack = state.contextStack;
  if (!stack.length) return { explanation: 'There’s nothing to return to — we’re at the start of the demo.', trace: ['resume: empty stack'] };
  const target = stack[stack.length - 1];
  const d = await driveTo(state, target.intent);
  return {
    navigation: d.navigation,
    blockedMutations: d.blockedMutations,
    currentPosition: { intent: target.intent, url: d.navigation.url, answer: target.answer },
    contextStack: stack.slice(0, -1),
    trace: [`resume: returning to "${target.intent}" (stack depth ${stack.length - 1})`, ...d.traceLines],
  };
}

// ── routing ──────────────────────────────────────────────────────────────────
function routeFromInterpret(s: DemoStateT): 'explain' | 'resume' | 'retrieve' {
  if (s.interpretation?.isMetaExplain) return 'explain';
  if (s.interpretation?.isResume) return 'resume';
  return 'retrieve';
}

export function buildGraph() {
  return new StateGraph(DemoState)
    .addNode('interpret', interpret)
    .addNode('retrieve', retrieve)
    .addNode('navigate', navigate)
    .addNode('explain', explain)
    .addNode('resume', resume)
    .addEdge(START, 'interpret')
    .addConditionalEdges('interpret', routeFromInterpret, { explain: 'explain', resume: 'resume', retrieve: 'retrieve' })
    .addConditionalEdges('retrieve', (s: DemoStateT) => (s.gated ? END : 'navigate'), { navigate: 'navigate', [END]: END })
    .addEdge('navigate', END)
    .addEdge('explain', END)
    .addEdge('resume', END)
    .compile({ checkpointer: new MemorySaver() });
}

/**
 * The single LangGraph loop (one loop, not many agents — plan §4), multi-turn.
 *
 *   whoSpeaks ─▶ interpret ─▶ router ─┬─▶ govern  ───────────────▶ END   (pause / stop / resume the session)
 *                        ├─▶ explain ───────────────▶ END   ("why did you show that?")
 *                        ├─▶ resume  ───────────────▶ END   (pop stack, return to context)
 *                        └─▶ retrieve ─(gated?)─┬END
 *                                               └▶ navigate ▶ discover ▶ END  (answer · drive UI · discover)
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
import { updateSessionStatus } from './session.js';
import { recordDiscovery } from './discovery.js';
import { setActiveSpeaker, getActiveStakeholder, addOpenItem } from './stakeholders.js';

const CONFIDENCE_THRESHOLD = 0.6;
const RELEVANCE_MAX_DISTANCE = 0.65; // empirically calibrated to voyage-3 (in-scope ~0.42–0.47)
const MAX_VERIFY_AGE_DAYS = 180;
const EXPLAIN_TRACE_WINDOW = 16; // bound the cross-turn trace fed to explain (it grows unbounded)

// ── whoSpeaks (multi-stakeholder, P2.3 / Gap F) — resolve the active speaker ───
async function whoSpeaks(state: DemoStateT): Promise<Partial<DemoStateT>> {
  if (!state.sessionId) return {};
  try {
    const active = state.speaker
      ? await setActiveSpeaker(state.sessionId, state.speaker)
      : await getActiveStakeholder(state.sessionId);
    // Always set explicitly (null when unresolved) so a turn never inherits a stale speaker.
    return {
      activeStakeholder: active,
      trace: [active ? `speaker: ${active.name ?? '—'} (${active.role ?? '—'})${state.speaker ? '' : ' [continuing]'}` : 'speaker: none resolved'],
    };
  } catch (e: any) {
    return { activeStakeholder: null, trace: [`speaker: unresolved (${e?.message ?? e})`] };
  }
}

// ── interpret ────────────────────────────────────────────────────────────────
async function interpret(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const i = await getLlm().interpret(state.utterance);
  // Reset per-turn outputs so a turn that doesn't navigate (explain / gated / resume)
  // can't surface the PRIOR turn's screen, blocked actions, chunks, or "why". The
  // breadcrumb (currentPosition / contextStack) deliberately persists across turns.
  return {
    interpretation: i,
    explanation: null,
    gated: false,
    navigation: null,
    blockedMutations: [],
    retrieved: [],
    discoveryPrompt: null,
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
  if (!d.navigation.ok) {
    // Recovery (P2.1): a step that didn't complete must NOT move the breadcrumb to a
    // place we never reached — stay anchored to the last good position so a later
    // "take me back" returns somewhere real.
    return {
      navigation: d.navigation,
      blockedMutations: d.blockedMutations,
      trace: [...d.traceLines, 'navigate: step did not complete — breadcrumb left at last good position'],
    };
  }
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

// ── discover (active discovery, P2.2 / Gap E) — capture signals + offer one Q ──
async function discover(state: DemoStateT): Promise<Partial<DemoStateT>> {
  if (!state.sessionId || !state.interpretation) return {};
  try {
    const d = await getLlm().discover({
      utterance: state.utterance,
      kind: state.interpretation.kind,
      answer: state.retrieved[0]?.content ?? '',
    });
    if (d.painPoints.length || d.buyingSignals.length || d.businessObjective) {
      await recordDiscovery(state.sessionId, { painPoints: d.painPoints, buyingSignals: d.buyingSignals, businessObjective: d.businessObjective });
    }
    if (state.activeStakeholder && (d.painPoints[0] || d.question)) {
      await addOpenItem(state.activeStakeholder.id, d.painPoints[0] ?? d.question); // F: per-stakeholder follow-up
    }
    const captured = d.painPoints.length + d.buyingSignals.length + (d.businessObjective ? 1 : 0);
    return { discoveryPrompt: d.question || null, trace: [`discover: captured ${captured} signal(s)${d.question ? '; offered a question' : ''}`] };
  } catch (e: any) {
    return { trace: [`discover: skipped (${e?.message ?? e})`] };
  }
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
    trace: state.trace.slice(-EXPLAIN_TRACE_WINDOW),
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

// ── govern (pause / stop / resume — recovery & interrupt control) ─────────────
async function govern(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const control = state.interpretation?.control ?? null;
  const status = state.sessionStatus;
  let next = status;
  let message: string;
  if (status === 'stopped') {
    message = 'This demo was stopped — start a new session to continue.';
  } else if (control === 'stop') {
    next = 'stopped';
    message = 'Stopped. Nothing further will run on this session.';
  } else if (control === 'pause') {
    next = 'paused';
    message = 'Paused — say “continue” when you’re ready, or “stop” to end.';
  } else if (control === 'continue') {
    // Only reached while held (paused) — continue-while-active is a no-op handled in the router.
    next = 'active';
    message = 'Resuming where we left off.';
  } else {
    // routed here only because we’re paused and got a non-control utterance
    message = 'We’re paused. Say “continue” to resume, or “stop” to end.';
  }
  if (next !== status && state.sessionId) {
    try { await updateSessionStatus(state.sessionId, next); } catch { /* status is best-effort; state still governs the loop */ }
  }
  return { sessionStatus: next, explanation: message, trace: [`govern: control=${control ?? 'none'} status ${status}→${next}`] };
}

// ── routing ──────────────────────────────────────────────────────────────────
function routeFromInterpret(s: DemoStateT): 'govern' | 'explain' | 'resume' | 'retrieve' {
  const control = s.interpretation?.control;
  const held = s.sessionStatus === 'paused' || s.sessionStatus === 'stopped';
  // Govern when there's a transition to make (pause/stop) or we're held and need a way
  // out. A "continue" while already active is a NO-OP — fall through so the rest of the
  // utterance (a question, "why?", "take me back") still runs and the turn isn't eaten.
  // (Limitation: a "continue + take me back" said WHILE paused un-pauses but does not
  // also pop the breadcrumb in the same turn — say "take me back" on the next turn.)
  if (control === 'pause' || control === 'stop') return 'govern';
  if (held) return 'govern';
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
    .addNode('govern', govern)
    .addNode('discover', discover)
    .addNode('whoSpeaks', whoSpeaks)
    .addEdge(START, 'whoSpeaks')
    .addEdge('whoSpeaks', 'interpret')
    .addConditionalEdges('interpret', routeFromInterpret, { govern: 'govern', explain: 'explain', resume: 'resume', retrieve: 'retrieve' })
    .addConditionalEdges('retrieve', (s: DemoStateT) => (s.gated ? END : 'navigate'), { navigate: 'navigate', [END]: END })
    .addEdge('navigate', 'discover')
    .addEdge('discover', END)
    .addEdge('explain', END)
    .addEdge('resume', END)
    .addEdge('govern', END)
    .compile({ checkpointer: new MemorySaver() });
}

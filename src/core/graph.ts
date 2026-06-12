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
import { DemoState, type DemoStateT, type Position } from './state.js';
import { getLlm } from './llm.js';
import { db } from './db.js';
import { getAdapter, type DemoNode } from './driver.js';
import { record } from './cost.js';
import { updateSessionStatus } from './session.js';
import { recordDiscovery } from './discovery.js';
import { setActiveSpeaker, getActiveStakeholder, addOpenItem } from './stakeholders.js';
import { retrieveAndGate } from './retrieval.js';
import { selectNavigation, recordNavAttempt } from './graph-lifecycle.js';
import { screenFactsFor, nodeNarrationFacts } from './graph-elements.js'; // RC-06: read the navigated node's UX surface at demo time; #8/#35: static screenName/purpose/facts for narration
import { journeyWalkPlan } from './journeys.js';
const EXPLAIN_TRACE_WINDOW = 16; // bound the cross-turn trace fed to explain (it grows unbounded)

// Per-invoke LangGraph config (NOT checkpointed): carries a streaming sink so a node can stream spoken
// sentences out to TTS as they generate (RC-03). thread_id rides here too via ctx.thread.configurable.
type GraphRunConfig = { configurable?: { thread_id?: string; onDelta?: (sentence: string) => void } };

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
    navigable: false,
    navigation: null,
    navAction: null,
    blockedMutations: [],
    screenFacts: null, // RC-06: per-turn — a turn that doesn't navigate must not answer from the PRIOR screen's surface
    retrieved: [],
    discoveryPrompt: null,
    trace: [`interpret: kind=${i.kind}${i.isMetaExplain ? ' [meta-explain]' : ''}${i.isResume ? ' [resume]' : ''} intent="${i.intent}"`],
  };
}

// ── retrieve (confidence + validation + staleness + relevance gate) ───────────
async function retrieve(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const query = state.interpretation?.intent ?? state.utterance;
  // An active specialist persona can demand a stricter confidence bar + re-rank by its knowledge hierarchy.
  const r = await retrieveAndGate(query, state.productId, state.minConfidence, state.knowledgePriority);
  return {
    retrieved: r.rows,
    gated: r.gated,
    navigable: r.navigable,
    band: r.band,
    // Provenance in the trace so explainWhy ("why did you show that?") can name the source + its owner/validator.
    trace: [`retrieve: ${r.rows.length} chunks; top "${r.top?.source ?? 'n/a'}"${r.top?.source_owner ? ` (owned by ${r.top.source_owner}${r.top?.validated_by ? `, validated by ${r.top.validated_by}` : ''})` : ''} confidence=${r.top?.confidence ?? 'n/a'} status=${r.top?.validation_status ?? 'n/a'} age=${r.ageDays ?? 'n/a'}d distance=${r.top?.distance?.toFixed(3) ?? 'n/a'} band=${r.band} → ${r.gated ? `GATED (${r.reason})${r.navigable ? ' but navigable — still showing the screen' : ''}` : 'answer'}`],
  };
}

// ── shared UI-driving used by navigate + resume ──────────────────────────────
interface DriveOutcome { navigation: { ok: boolean; healedVia: string | null; url: string }; blockedMutations: string[]; opened: boolean; label: string; traceLines: string[]; navAction?: { label?: string; selectors?: string[]; url?: string }; noMatch?: boolean; screenFacts?: string | null /* RC-06: the navigated node's compact UX surface (buttons/actions/required-fields/permissions) */ }

async function driveTo(state: DemoStateT, intent: string, opts?: { targetLabel?: string | null }): Promise<DriveOutcome> {
  // Navigation (de-gated this session): the ACTIVE graph's NAVIGABLE nodes (verified + pending + draft, broken
  // excluded) are candidates, preferring verified + the approved WORKFLOW matching the active stakeholder/persona.
  // The runtime gotoNode tests each locator on the REAL DOM and falls back to the route, else fails honestly —
  // so the live DOM test is the truth gate; a confirmed-broken node is never driven and the loop degrades honestly.
  // Journey walk: when a target node is named (opts.targetLabel), select over ALL navigable nodes (no
  // stakeholder-role workflow constraint, which could exclude the journey's target) and force that node below.
  const sel = await selectNavigation(state.productId, opts?.targetLabel ? null : (state.activeStakeholder?.role ?? null));
  if (!sel.graph) return { navigation: { ok: false, healedVia: null, url: '' }, blockedMutations: [], opened: false, label: '', traceLines: ['drive: no active DemoGraph'] };
  if (!sel.candidates.length) return { navigation: { ok: false, healedVia: null, url: '' }, blockedMutations: [], opened: false, label: '', traceLines: ['drive: active graph has no navigable nodes — not navigating (degrade: nothing to show for this request)'] };
  const labels = sel.candidates.map((r) => r.intent_label);
  // Navigation-truth line — fed to the trace so explainWhy can state which workflow / graph version /
  // verified date / environment drove the navigation (the spec's "explain what was selected and why").
  const truthLine = `drive: ${sel.workflow ? `workflow "${sel.workflow.name}"${sel.workflow.stakeholderType && sel.workflow.stakeholderType.toLowerCase() !== 'none' ? ` (for ${sel.workflow.stakeholderType})` : ''}` : 'no stakeholder-workflow match — choosing across all navigable screens'} · graph v${sel.graph.graphVersion}${sel.graph.verifiedAt ? ` · verified ${sel.graph.verifiedAt.slice(0, 10)}` : ''}${sel.graph.environment ? ` · env "${sel.graph.environment}"` : ''}`;
  // Phase 4 REEL→node re-model + Journey walk: if a node is named (journey targetLabel, else the turn's
  // navHint) and it's a navigable candidate, take it; otherwise pick intent-driven via pickNode.
  const navHintLabel = opts?.targetLabel ?? state.navHint;
  const hinted = navHintLabel ? labels.find((l) => l.toLowerCase() === String(navHintLabel).toLowerCase()) : undefined;
  // pickNode returns '' when NO screen fits (off-domain / out of scope). HONOR that — do NOT force a
  // first-label fallback. The old `|| labels[0]` / `?? candidates[0]` is exactly what mapped "capital of
  // france" → a random screen AND recorded it as a confident intent→node row. A journey targetLabel / navHint
  // always wins (the journey is on rails); free-roam respects "none fit".
  const picked = hinted ?? (await getLlm().pickNode(intent, labels, true)); // fast=true: runtime nav routing on the fast tier (#5)
  const node = picked ? sel.candidates.find((r) => r.intent_label === picked) : undefined;
  if (!node) {
    // No screen fits → don't navigate, and crucially DON'T recordNavAttempt (a no-match never enters the
    // empirical intent registry — that's how the bogus mappings appeared). The turn degrades honestly; the
    // confidence-gated answer speaks to scope. Returns BEFORE any recordNavAttempt below.
    return { navigation: { ok: false, healedVia: null, url: '' }, blockedMutations: [], opened: false, label: '', traceLines: [truthLine, picked ? `drive: picked "${picked}" is not a navigable candidate — not navigating` : 'drive: no screen fits this request — out of scope; not navigating (honest degrade)'], noMatch: true };
  }

  // Client-driven nav (desktop embedded browser): don't drive a server browser — resolve the node to
  // the role's on-screen label + its verified locators + screen route, and hand the click to the embedded pane.
  // The human is logged in there; the agent only navigates (read-only) within their own session.
  if (state.clientNav) {
    const label = node.persona_labels?.[state.role] ?? node.persona_labels?.['default'] ?? node.intent_label;
    // RC-32: pass the node's FULL ordered locator_strategies (with {label} resolved), NOT just id/class. The
    // client tries these verified locators IN ORDER (skipping any that aren't valid querySelector CSS, e.g.
    // Playwright text=/:has-text) BEFORE any label-text fallback — so the ordered, verified graph wins over a
    // shortest-substring label guess (which clicked "Approve" for "Approvals").
    const selectors = (node.locator_strategies ?? []).map((s) => String(s.value).replaceAll('{label}', label));
    // RC-31: when the node has a verified screen_route, prefer a direct route navigation on the client (the
    // route is the most authoritative locator — no DOM guessing). Passed as `url`; the client resolves it
    // against the live webview origin and navigates there before trying click locators.
    const route = node.screen_route || undefined;
    // Phase 2 telemetry: record the node SELECTION (client-driven → ok=NULL, the DOM outcome isn't observed
    // server-side, but the node + intent are real signal for the intent→node registry).
    await recordNavAttempt({ source: 'path-a', productId: state.productId, sessionId: state.sessionId, graphId: sel.graph.graphId, nodeId: node.id, intent, url: node.screen_route || '', ok: null, healedVia: null, selectorUsed: selectors[0] ?? label });
    const screenFacts = await screenFactsFor(node.id); // RC-06: this node's modeled buttons/actions/required-fields → answerAs hint
    return {
      navigation: { ok: true, healedVia: null, url: '' },
      blockedMutations: [], opened: true, label,
      traceLines: [truthLine, `drive (client-nav): instruct embedded browser → "${label}" as ${state.role}${route ? ` (prefer route ${route})` : ''} · ${selectors.length} ordered locator(s)`],
      navAction: { label, selectors, url: route },
      screenFacts,
    };
  }

  const driver = await getAdapter(sel.graph.productName, state.mode, state.baseUrl);
  try {
    await driver.open(state.role);
    const nav = await driver.gotoNode(node, state.role);
    await record('navigation', 'none', {}, { url: nav.url, node: node.intent_label });
    // Phase 2 telemetry: server-side drive → a REAL ok/healed_via outcome recorded against the node.
    await recordNavAttempt({ source: 'path-a', productId: state.productId, sessionId: state.sessionId, graphId: sel.graph.graphId, nodeId: node.id, intent, url: nav.url || node.screen_route || '', ok: nav.ok, healedVia: nav.healedVia, selectorUsed: null });
    const opened = nav.ok ? await driver.openRecord() : false;
    const scan = opened ? await driver.scanActions() : [];
    const confirmed = scan.filter((s) => s.cls === 'mutating' && s.confident && !s.permitted).map((s) => s.label);
    const defensive = scan.filter((s) => s.cls === 'mutating' && !s.confident && !s.permitted).length;
    // Watch mode: caption the real screen with what VIN Demo says + its trust metadata + the
    // read-only safety result, so a human watching sees a demo, not a silently-driven browser.
    // Watch mode (SHOW_DEMO) captions the real screen; live-stream mode (CAPTURE_SHOTS) writes a
    // fixed screenshot the control room reads. Off by default — no capture in eval/normal runs.
    if (nav.ok && (process.env.SHOW_DEMO || process.env.CAPTURE_SHOTS)) {
      const top = state.retrieved?.[0];
      const said = top?.content ?? `Here's the ${node.intent_label} screen.`;
      const meta = [
        top && `source: ${top.source} · confidence ${top.confidence} · ${top.product_version ?? ''} · ${top.validation_status ?? ''}`,
        `mode: ${state.mode} — ${confirmed.length ? `blocked ${confirmed.join(', ')}` : 'no mutating action fired'}`,
      ].filter(Boolean).join('     |     ');
      await driver.narrate?.(said, meta).catch(() => {});
      const shotPath = process.env.CAPTURE_SHOTS ? 'tmp/live/last.png' : `tmp/demo-shots/${node.intent_label.replace(/\W+/g, '-')}.png`;
      await driver.screenshot?.(shotPath, false).catch(() => {});
    }
    const screenFacts = nav.ok ? await screenFactsFor(node.id) : null; // RC-06: only when we actually landed on the screen
    return {
      navigation: nav,
      blockedMutations: confirmed,
      opened,
      label: node.intent_label,
      traceLines: [
        truthLine,
        `drive: "${node.intent_label}" as ${state.role} → ${nav.ok ? nav.url : 'FAILED'}${nav.healedVia ? ` [self-heal via ${nav.healedVia}]` : ' [primary ok]'}`,
        `drive: mode=${state.mode}; PO ${opened ? 'opened' : 'not opened'}; ${scan.length === 0 ? 'no action panel' : `blocked ${confirmed.length} confirmed mutating${defensive ? ` (+${defensive} held)` : ''} of ${scan.length}`}`,
      ],
      screenFacts,
    };
  } catch (e: any) {
    return { navigation: { ok: false, healedVia: null, url: '' }, blockedMutations: [], opened: false, label: node.intent_label, traceLines: [truthLine, `drive: ERROR — ${e?.message ?? e}`] };
  } finally {
    await driver.close();
  }
}

// ── navigate: free-roam (intent-driven; no pinned journey) — with mid-flight pivot push ───────
async function navigateFreeRoam(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const intent = state.interpretation?.intent ?? state.utterance;
  const d = await driveTo(state, intent);
  if (d.noMatch) {
    // No product screen fits this request (off-domain / out of scope). Don't navigate, clear any pending nav
    // action, leave the breadcrumb where it is; the confidence-gated answer responds honestly. No intent→node
    // mapping was recorded, so the empirical registry never learns a bogus "X → random screen".
    return {
      navigation: d.navigation,
      navAction: null,
      blockedMutations: [],
      trace: [...d.traceLines, `navigate: "${intent}" is outside this product's screens — answering honestly without navigating`],
    };
  }
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
    navAction: d.navAction ?? null,
    blockedMutations: d.blockedMutations,
    currentPosition: newPos,
    contextStack,
    screenFacts: d.screenFacts ?? null, // RC-06: thread the navigated screen's UX surface to answerAs
    trace: [...(pivot ? [`pivot: pushed "${state.currentPosition!.intent}" onto the context stack (depth ${contextStack.length})`] : []), ...d.traceLines],
  };
}

// ── navigate: JOURNEY walk — the pinned journey drives WHERE we go, in order (V5; mig 0026) ───
// When state.journeyId is set, ignore free-roam pickNode and walk the journey's ordered plan one entry per
// turn: a 'node' entry drives the live product to that exact verified screen; a 'beat' is a narration moment
// (the voice layer composes the words in P3). journeyStep advances + persists via the thread checkpointer.
async function navigateJourneyStep(state: DemoStateT, config?: GraphRunConfig): Promise<Partial<DemoStateT>> {
  const wp = state.journeyId ? await journeyWalkPlan(state.journeyId).catch(() => null) : null;
  if (!wp || !wp.plan.length) return await navigateFreeRoam(state); // nothing to walk → honest free-roam fallback
  const step = state.journeyStep ?? 0;
  const total = wp.plan.length;
  // Walk complete (the run lifecycle is owned by walkJourney in live-session.ts, not per-node).
  if (step >= total) return { journeyStep: step, navigation: null, navAction: null, explanation: null, trace: [`journey: walk complete — "${wp.journey.name}" (${total} steps)`] };
  const entry = wp.plan[step];
  const advance = { journeyStep: step + 1 };
  const audience = state.activeStakeholder?.role ?? null;
  const onDelta = config?.configurable?.onDelta; // RC-03: stream this step's narration to TTS when the voice channel gave us a sink
  const stepNum = step + 1;
  const recent = state.recentNarrations ?? []; // #2: the last few spoken lines, threaded for anti-repetition
  // #2: the OUTCOME frames only the bookend beats (open/close); injecting it on every step is the chief cause of
  // 97%-repetitive narration. Elsewhere it's null so the beat advances the story instead of restating the goal.
  const outcomeFraming = (entry.arcRole === 'open' || entry.arcRole === 'close') ? wp.journey.businessGoal : null;
  if (entry.kind === 'beat') {
    // Narration beat (knowledge/note/tour) — no navigation; compose ONE warm spoken line (clean fallback).
    // RC-16: pass the resolved knowledge chunk (entry.sourceText) so a knowledge beat paraphrases a GROUNDED
    // source instead of free-improvising product claims; null for note/tour beats → the span orients to context.
    const say = await getLlm().narrate({ personaPreamble: state.personaPreamble, stepKind: entry.stepKind, caption: entry.caption, screen: null, audience, outcome: outcomeFraming, sourceText: entry.sourceText ?? null, recentNarrations: recent, stepIndex: stepNum, stepTotal: total, arcRole: entry.arcRole, onDelta });
    return { ...advance, navigation: null, navAction: null, blockedMutations: [], explanation: say, recentNarrations: [say], trace: [`journey: [${stepNum}/${total}] ${entry.stepKind} narration beat (${entry.arcRole})`] };
  }
  // #7: a SILENT transit node — drive the screen but speak NOTHING (the walk advances without restating a value
  // prop on every interior screen). No narrate() call (faster + truly silent); explanation stays null and
  // runTurn emits no AI line for it (it must NOT fall through to answerAs — guarded by turn.advance there).
  if (!entry.narrated) {
    const d = await driveTo(state, entry.caption ?? entry.nodeLabel ?? 'demonstrate', { targetLabel: entry.nodeLabel ?? null });
    const ok = d.navigation.ok || !!d.navAction;
    const newPos: Position = { intent: entry.nodeLabel ?? 'journey step', url: d.navigation.url, answer: state.retrieved?.[0]?.content ?? null };
    // Trace: drive detail first, the journey/GAP status LAST so the operator beat (which surfaces the last trace
    // line) shows a transit GAP — otherwise a silent transit screen that failed to load would be invisible live.
    return { ...advance, navigation: d.navigation, navAction: d.navAction ?? null, blockedMutations: d.blockedMutations, currentPosition: ok ? newPos : state.currentPosition, screenFacts: d.screenFacts ?? null, explanation: null, trace: [...d.traceLines, ok ? `journey: [${stepNum}/${total}] → "${entry.nodeLabel}" (transit · silent)` : `journey: [${stepNum}/${total}] GAP — "${entry.nodeLabel}" did NOT resolve (transit) — operator: this screen did not load`] };
  }
  // Narrated 'node' — drive the live product to this exact screen, on the journey's rails (forced target label).
  // #8/#35: enrich the narration with the node's display screenName + purpose + screenFacts (STATIC metadata
  // resolved independent of the live drive — a fast prelude that preserves the Wave-A #13 narrate ∥ driveTo
  // concurrency for the expensive LLM + nav work). Best-effort: nulls → narrate falls back to the bare label.
  const facts = await nodeNarrationFacts(state.productId, entry.nodeLabel ?? '');
  const [d, say] = await Promise.all([
    driveTo(state, entry.caption ?? entry.nodeLabel ?? 'demonstrate', { targetLabel: entry.nodeLabel ?? null }),
    getLlm().narrate({ personaPreamble: state.personaPreamble, stepKind: entry.stepKind, caption: entry.caption, screen: facts.screenName ?? entry.nodeLabel ?? null, screenName: facts.screenName, purpose: facts.purpose, screenFacts: facts.screenFacts, audience, outcome: outcomeFraming, sourceText: entry.sourceText ?? null, recentNarrations: recent, stepIndex: stepNum, stepTotal: total, arcRole: entry.arcRole, onDelta }),
  ]);
  const ok = d.navigation.ok || !!d.navAction;
  const newPos: Position = { intent: entry.nodeLabel ?? 'journey step', url: d.navigation.url, answer: state.retrieved?.[0]?.content ?? null };
  return {
    ...advance,
    navigation: d.navigation,
    navAction: d.navAction ?? null,
    blockedMutations: d.blockedMutations,
    currentPosition: ok ? newPos : state.currentPosition,
    screenFacts: d.screenFacts ?? null, // RC-06: an off-script question on this walk-pinned session answers FROM this screen's surface
    explanation: say,
    recentNarrations: [say], // #2: remember what we just said so the next beat doesn't repeat it
    // RC-26: a forced journey target that didn't resolve on the live product is a GAP — flag it in the operator
    // trace (surfaced as a beat) rather than letting the step glide past silently as if the screen were shown.
    trace: [ok ? `journey: [${stepNum}/${total}] → "${entry.nodeLabel}" (${entry.arcRole})` : `journey: [${stepNum}/${total}] GAP — "${entry.nodeLabel}" did not resolve on the live product (degraded — narrated without the screen)`, ...d.traceLines],
  };
}

// ── navigate: dispatcher — walk the pinned journey, else free-roam (intent-driven default) ────
async function navigate(state: DemoStateT, config?: GraphRunConfig): Promise<Partial<DemoStateT>> {
  if (!state.productId) return { trace: ['navigate: skipped (no productId)'] };
  // Walk a journey step ONLY on an explicit walk turn (journeyAdvance). An off-script question on a
  // journey-pinned session is answered normally (free-roam) and does NOT consume a journey step.
  if (state.journeyId && state.journeyAdvance) return await navigateJourneyStep(state, config);
  return await navigateFreeRoam(state);
}

// ── discover (active discovery, P2.2 / Gap E) — capture signals + offer one Q ──
async function discover(state: DemoStateT): Promise<Partial<DemoStateT>> {
  if (!state.sessionId || !state.interpretation) return {};
  // Experience-audit (Wave B, kill the scripted feel): on a JOURNEY WALK step the AI is presenting a narrated
  // story — it must NOT interrupt itself with a discovery question after every beat (the walk caption isn't a
  // buyer utterance, so there's no real signal to extract either). Discovery still runs on off-script/interactive
  // turns (journeyAdvance=false), where a real stakeholder spoke.
  if (state.journeyAdvance) return { trace: ['discover: skipped on a journey walk step (presenter-led narration, no discovery interrupt)'] };
  try {
    const d = await getLlm().discover({
      utterance: state.utterance,
      kind: state.interpretation.kind,
      answer: state.retrieved[0]?.content ?? '',
      personaPreamble: state.personaPreamble || undefined,
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
    personaPreamble: state.personaPreamble || undefined,
  });
  return { explanation: why, trace: ['explain: justified the last action from the decision trace'] };
}

// ── resume (pop the stack, return to context) ────────────────────────────────
async function resume(state: DemoStateT): Promise<Partial<DemoStateT>> {
  const stack = state.contextStack;
  if (!stack.length) return { explanation: 'There’s nothing to return to — we’re at the start of the demo.', trace: ['resume: empty stack'] };
  const target = stack[stack.length - 1];
  const d = await driveTo(state, target.intent);
  // If we couldn't actually get back (no-match on re-score, or a failed drive — e.g. the pushed node was
  // archived between turns), DON'T overwrite the breadcrumb with an empty url and DON'T pop the stack — leave
  // both intact so a later "take me back" still returns somewhere real (mirrors navigateFreeRoam's guard).
  if (d.noMatch || !d.navigation.ok) {
    return {
      navigation: d.navigation,
      navAction: d.navAction ?? null,
      blockedMutations: d.blockedMutations,
      trace: [...d.traceLines, `resume: could not return to "${target.intent}" — staying put; stack left intact`],
    };
  }
  return {
    navigation: d.navigation,
    navAction: d.navAction ?? null,
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
    // Gate the ANSWER, not the SCREEN: a gated-but-navigable query still navigates (showing the live
    // product isn't inventing). Only a truly off-topic query (gated AND not navigable) ends here.
    // A journey WALK turn always proceeds to navigate (the journey decides the screen, not retrieval
    // relevance, so a beat/screen is never skipped because the synthetic step query "gated"). An off-script
    // question on a journey-pinned session (journeyAdvance=false) gates normally.
    .addConditionalEdges('retrieve', (s: DemoStateT) => (!(s.journeyId && s.journeyAdvance) && s.gated && !s.navigable ? END : 'navigate'), { navigate: 'navigate', [END]: END })
    .addEdge('navigate', 'discover')
    .addEdge('discover', END)
    .addEdge('explain', END)
    .addEdge('resume', END)
    .addEdge('govern', END)
    .compile({ checkpointer: new MemorySaver() });
}

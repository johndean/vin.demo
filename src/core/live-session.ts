/**
 * Live demo session loop — the REAL LangGraph brain (read-only) streaming structured events
 * (+ real product screenshots) through an `emit` callback. The per-turn work is `runTurn`, reused by:
 *   • the canned REEL (`runLiveSession`, 3 fixed questions) — repeatable demo,
 *   • the INTERACTIVE session (apps/engine/src/interactive-session.ts) — live typed/spoken questions,
 *   • the CLI guard at the bottom (local QA / desktop dev fallback) → NDJSON on stdout.
 * The brain is identical across all three; only the SOURCE of utterances differs. CAPTURE_SHOTS is
 * forced on so the graph writes tmp/live/last.png on each navigation, which `shot()` reads as base64.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { buildGraph } from './graph.js';
import { getLlm } from './llm.js';
import { createDemoSession, saveSessionState, loadSessionState } from './session.js';
import { journeyWalkPlan, startJourneyRun, completeJourneyRun, getJourneyById } from './journeys.js';
import { beginCostSession, sessionCost } from './cost.js';
import { db } from './db.js';
import type { ExecutionMode } from './safety.js';
import { loadPersona, personaPreamble, handoffSuggestionFor, type Persona } from './persona.js';
import { getStakeholders, getStakeholderRegistry, type Stakeholder } from './stakeholders.js';
import { getDiscovery } from './discovery.js';
import { chunkPassesGate } from './retrieval.js'; // Wave C #18: gate the SECONDARY source to the same bar as the primary
import { validateCompliance, shouldCite, recordEscalation, recordAuditTurn, type ComplianceResult } from './governance.js';

export type Emit = (ev: Record<string, unknown>) => void;

/** What the OPERATOR can define per session (from the desktop target picker / engine query params).
 *  Every field is optional — omitted fields fall back to env (back-compat with the env-driven boot). */
export interface SessionTarget {
  productId?: string | null;  // which product to demo (UUID); falls back to PO_VIN_PRODUCT_ID
  role?: string | null;       // persona/role to drive as (admin|manager|owner|…); falls back to PO_VIN_ROLE
  mode?: ExecutionMode | null;// execution mode; coerced to read-only unless an allowed non-write mode
  baseUrl?: string | null;    // optional per-session URL override for the chosen product's adapter
  scenario?: string | null;   // optional opening question/scenario the engine asks first (entry-point concern)
  clientNav?: boolean | null; // desktop embedded browser drives navigation (no server Playwright/screenshot)
  personaId?: string | null;  // active specialist persona (hand-off); null = the lead consultant (no overlay)
  seedRoom?: boolean | null;  // seed the synthetic multi-stakeholder fixture? Scripted demos only — LIVE
                              // interactive/voice default OFF so the AI never addresses people who don't exist.
  journeyId?: string | null;  // V5: pin a journey — the loop WALKS its story_flow on verified rails instead
                              // of free-roaming. null = ad-hoc/off-script (today's intent-driven default).
}

// Operator-selectable execution modes. 'execution' (full-write) is an explicit, warned per-session
// opt-in (the operator authorizes live writes against their OWN demo/QA target) — default stays
// read-only. This is the sanctioned path in CLAUDE.md §8 ("customer authorizes mutating actions").
const SELECTABLE_MODES: ExecutionMode[] = ['read-only', 'safe', 'approval', 'execution'];

export interface SessionCtx {
  productId: string;
  productName: string;
  role: string;
  mode: ExecutionMode;
  baseUrl: string | null;
  clientNav: boolean;
  sessionId: string;
  // Active specialist persona id (mutable — a hand-off updates it so subsequent turns use the new
  // specialist's overlay/voice/gate). null = the lead consultant (no overlay; default behavior).
  personaId: string | null;
  journeyId: string | null; // pinned journey the loop walks (null = off-script / intent-driven default)
  journeyGoal: string | null; // RC-17: the pinned journey's business outcome — answers are FRAMED against it
  // Wave C #10: the linked outcome's quantified frame (metric/baseline/target) → the demo can SPEAK a real number.
  outcomeMetric: string | null; outcomeBaseline: string | null; outcomeTarget: string | null;
  // Wave C #9: the journey's buying committee (role + authored objections + decision criteria) → answer executives.
  committee: { role: string; objections: string[]; decisionCriteria: string[] }[];
  // Wave C #17: a concise role-level summary of the committee this journey is FRAMED for (roles + top concerns),
  // threaded into the walk's opening narration — distinct from the live in-the-room audience. Null when no committee.
  framedFor: string | null;
  graph: ReturnType<typeof buildGraph>;
  thread: { configurable: { thread_id: string } };
}

export const LOOP = ['Intent', 'Retrieve', 'Navigate', 'Demonstrate', 'Explain', 'Follow-up', 'Return'];

// Baseline "brain" for the always-on Lead Consultant (no specialist handed off). Gives the default
// voice a real consultant personality so answers are composed + human — not a robotic canned line.
const LEAD_PREAMBLE =
  'You are the VIN Lead Consultant running a live product demo for enterprise stakeholders. You are ' +
  'consultative, clear, and outcome-oriented: understand intent, connect features to business value, ' +
  'and keep the room engaged. You coordinate specialist hand-offs when a question needs deep expertise. ' +
  'Never over-commit on legal, security, pricing, or roadmap. Speak naturally and concisely, never robotically.';

async function shot(): Promise<string | null> {
  try { return 'data:image/png;base64,' + (await readFile('tmp/live/last.png')).toString('base64'); }
  catch { return null; }
}

/** Boot a real demo session against an OPERATOR-CHOSEN target (product/role/mode/url), falling back
 *  to env for any field the operator didn't set. Resolves the product's real name (for the adapter +
 *  the `start` event), creates the session row, builds the graph + thread. Returns null if no product
 *  is configured or the productId is unknown — the caller surfaces a clear error and closes. */
export async function bootSession(threadPrefix = 'live', target: SessionTarget = {}): Promise<SessionCtx | null> {
  process.env.CAPTURE_SHOTS = '1'; // graph writes tmp/live/last.png on each navigation
  await mkdir('tmp/live', { recursive: true }).catch(() => {});

  const productId = (target.productId?.trim() || process.env.PO_VIN_PRODUCT_ID) ?? null;
  if (!productId) return null;
  const role = target.role?.trim() || process.env.PO_VIN_ROLE || 'admin';
  const requested = (target.mode ?? 'read-only') as ExecutionMode;
  const mode: ExecutionMode = SELECTABLE_MODES.includes(requested) ? requested : 'read-only';
  const baseUrl = target.baseUrl?.trim() || null;
  const clientNav = !!target.clientNav;

  // Resolve (and validate) the product — its real name drives the adapter registry + the start event.
  const p = await db().query<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId]);
  const productName = p.rows[0]?.name;
  if (!productName) return null; // unknown product id (operator picked something not in this workspace)

  // Default OFF for bootSession callers: interactive + voice are LIVE single-operator sessions where a
  // fabricated audience made the AI address fictional attendees. The reel opts back in (scripted showcase).
  const journeyId = target.journeyId?.trim() || null;
  // RC-17 / Wave C #10+#9: load the pinned journey's full business OUTCOME (metric/baseline/target — for a spoken
  // ROI number) AND its buying COMMITTEE (objections + decision criteria — to answer executives head-on) once at
  // boot. This authored intelligence was mute; this is where it reaches the spoken layer. Best-effort throughout.
  let journeyGoal: string | null = null;
  let outcomeMetric: string | null = null, outcomeBaseline: string | null = null, outcomeTarget: string | null = null;
  let committee: { role: string; objections: string[]; decisionCriteria: string[] }[] = [];
  let framedFor: string | null = null;
  if (journeyId) {
    try {
      const j = await getJourneyById(journeyId);
      if (j) {
        journeyGoal = j.businessGoal;
        outcomeMetric = j.outcomeMetric ?? null; outcomeBaseline = j.outcomeBaseline ?? null; outcomeTarget = j.outcomeTarget ?? null;
        // #9: resolve the journey's stakeholder_refs to the registry rows that carry objections + decision
        // criteria; fall back to the product's full committee when the journey names none. Keep only members WITH
        // authored objections/criteria (no empty noise), keyed by ROLE (never a fabricated person name).
        const reg = await getStakeholderRegistry(productId);
        const refSet = new Set(j.stakeholderRefs.map((r) => r.toLowerCase())); // case-insensitive UUID ref match
        const scoped = j.stakeholderRefs.length ? reg.filter((s) => refSet.has(s.id.toLowerCase())) : reg;
        // Keep members WITH authored objections — the #9 answer channel matches on objections; criteria ride along.
        committee = scoped.filter((s) => s.objections?.length).map((s) => ({ role: s.role ?? s.name ?? 'a stakeholder', objections: s.objections ?? [], decisionCriteria: s.decisionCriteria ?? [] }));
        // Wave C #17: a role-level framing summary from the FULL journey committee (roles + their top concerns) for
        // the walk's opening beat — framed by role, never claiming presence. Sanitized + capped.
        const san = (s: string) => s.replace(/[·•|*`]+/g, ';').replace(/\s+/g, ' ').trim();
        const fRoles = Array.from(new Set(scoped.map((s) => s.role).filter((r): r is string => !!r).map((r) => san(r).slice(0, 40)))).slice(0, 4);
        const fConcerns = Array.from(new Set(scoped.flatMap((s) => s.decisionCriteria ?? []).filter(Boolean).map((c) => san(c).slice(0, 70)))).slice(0, 2);
        framedFor = fRoles.length ? `the ${fRoles.join(', ')}${fConcerns.length ? `, who evaluate on ${fConcerns.join('; ')}` : ''}`.slice(0, 240) : null;
      }
    } catch { /* best-effort: a missing journey / outcome / committee degrades to nulls, never blocks the demo */ }
  }
  const session = await createDemoSession(productId, mode, target.seedRoom ?? false, journeyId);
  beginCostSession(session.id);
  const graph = buildGraph();
  const thread = { configurable: { thread_id: `${threadPrefix}-${session.id}` } };
  // RC-30: cross-process resume. A brand-new session has no snapshot → this is a no-op and boot is
  // unchanged. If a prior process persisted one (engine redeploy/crash mid-demo), SEED the in-process
  // checkpointer for this thread so the first invoke resumes from the persisted position — we only restore
  // REPLACE-reducer channels (journeyId/journeyStep/currentPosition/sessionStatus), so append channels
  // (contextStack/trace) are NOT doubled. Best-effort: missing column / no snapshot / API error → boots as today.
  try {
    const snap = await loadSessionState(session.id);
    if (snap && Object.keys(snap).length) {
      const seed: Record<string, unknown> = {};
      if (snap.journeyId !== undefined) seed.journeyId = snap.journeyId;
      if (typeof snap.journeyStep === 'number') seed.journeyStep = snap.journeyStep;
      if (snap.currentPosition !== undefined) seed.currentPosition = snap.currentPosition;
      if (snap.sessionStatus) seed.sessionStatus = snap.sessionStatus;
      if (Object.keys(seed).length) await graph.updateState(thread, seed);
    }
  } catch { /* best-effort: no snapshot / column absent / seed failed → unchanged boot behavior */ }
  const personaId = target.personaId?.trim() || null;
  return { productId, productName, role, mode, baseUrl, clientNav, sessionId: session.id, personaId, journeyId, journeyGoal, outcomeMetric, outcomeBaseline, outcomeTarget, committee, framedFor, graph, thread };
}

/** Stakeholder intelligence + relationship memory (REUSES the existing session stakeholder collection +
 *  discovery — no new memory model). Builds an `audience` line (who's in the room) + `priorContext`
 *  (objective / pain points / signals raised so far) the composer can reference per participationMode. */
async function gatherRoom(sessionId: string | null, active: Stakeholder | null | undefined): Promise<{ audience: string; priorContext: string }> {
  if (!sessionId) return { audience: '', priorContext: '' };
  try {
    const [people, disc] = await Promise.all([getStakeholders(sessionId), getDiscovery(sessionId)]);
    // Stakeholder governance the specialist should weigh: decision authority · influence · risk level.
    // (riskLevel was seeded + shown in the console but never reached the brain — now it does.)
    const auth = (s: Stakeholder) => {
      const bits = [
        s.decisionAuthority && s.decisionAuthority !== 'none' ? s.decisionAuthority.replace(/_/g, ' ') : '',
        s.influence ? `${s.influence} influence` : '',
        s.riskLevel ? `${s.riskLevel} risk` : '',
      ].filter(Boolean);
      return bits.length ? `, ${bits.join('/')}` : '';
    };
    const fmt = (s: Stakeholder) => `${s.name ?? 'someone'}${s.role ? ` (${s.role}${auth(s)})` : ''}${s.interests.length ? ` — cares about ${s.interests.slice(0, 2).join(', ')}` : ''}${s.openItems.length ? `; open items: ${s.openItems.slice(0, 2).join(', ')}` : ''}`;
    const activeP = active ?? people.find((p) => p.isActive) ?? null;
    const others = people.filter((p) => p.id !== activeP?.id);
    const audience = people.length
      ? `Speaking now: ${activeP ? fmt(activeP) : 'unknown'}.${others.length ? ` Also in the room: ${others.map(fmt).join('; ')}.` : ''}`
      : '';
    const priorContext = [
      disc.businessObjective ? `objective — ${disc.businessObjective}` : '',
      disc.painPoints.length ? `pain points raised — ${disc.painPoints.slice(0, 3).join('; ')}` : '',
      disc.buyingSignals.length ? `buying signals — ${disc.buyingSignals.slice(0, 3).join('; ')}` : '',
    ].filter(Boolean).join(' · ');
    return { audience, priorContext };
  } catch { return { audience: '', priorContext: '' }; }
}

/** Run ONE turn through the brain and emit its events. Same logic whether the utterance came from the
 *  reel, a typed message, or speech — that's how voice/text stay a thin channel over one brain. */
export async function runTurn(ctx: SessionCtx, turn: { speaker: string; text: string; loop?: number; node?: string; advance?: boolean; stream?: boolean }, emit: Emit): Promise<{ journeyStep: number | null }> {
  emit({ type: 'message', side: 'them', who: turn.speaker, role: turn.speaker, text: turn.text, tag: 'question' });
  emit({ type: 'beat', loopIdx: 0, phase: 'Understand intent', brain: `Parsing the question and planning the demo.`, sub: 'interpret' });

  // Active specialist (if handed off): its overlay shapes the explain/discovery text and its confidence
  // threshold tightens the gate — a real per-persona effect on the interactive/voice answer path, not
  // just the desktop drive loop. null personaId / non-approved persona → lead consultant (no overlay).
  const persona: Persona | null = await loadPersona(ctx.personaId);
  // Every answer is composed in a real voice — the active specialist's, or the Lead Consultant's baseline.
  const preamble = persona ? personaPreamble(persona) : LEAD_PREAMBLE;
  const minConfidence = persona?.confidenceThreshold ?? null;
  const knowledgePriority = persona?.knowledgePriority ?? [];
  const aiWho = persona?.name ?? 'Consultant'; // surface the active specialist as the answering voice

  let out: any;
  try {
    // RC-03: on a streaming (voice) turn, ride a TTS sink through the LangGraph config (NOT state — config
    // isn't checkpointed) so navigateJourneyStep's narrate streams the WALK narration out sentence-by-sentence.
    // Carry framedFor (Wave C #17) on EVERY walk turn + the TTS sink on streaming turns, both via config (config
    // is NOT checkpointed). navigateJourneyStep reads framedFor for the opening beat's committee framing.
    const runConfig = { configurable: { ...ctx.thread.configurable, framedFor: ctx.framedFor, ...(turn.stream ? { onDelta: (s: string) => emit({ type: 'say_chunk', text: s }) } : {}) } };
    out = await ctx.graph.invoke({ utterance: turn.text, speaker: turn.speaker, productId: ctx.productId, sessionId: ctx.sessionId, role: ctx.role, mode: ctx.mode, baseUrl: ctx.baseUrl, clientNav: ctx.clientNav, navHint: turn.node ?? null, journeyId: ctx.journeyId, journeyAdvance: turn.advance ?? false, personaPreamble: preamble, minConfidence, knowledgePriority }, runConfig);
  } catch (e: any) {
    emit({ type: 'message', side: 'ai', who: aiWho, role: 'VIN Demo', text: `(engine error: ${e?.message ?? e})`, uncertain: true });
    return { journeyStep: null };
  }

  // RC-30: the invoke SUCCEEDED — persist a small resumable snapshot of `out` so a NEW process (after an
  // engine redeploy/crash) can re-seed this thread's checkpointer and resume coherently. Only the
  // REPLACE-reducer, serializable channels that matter for resume (NOT append channels like contextStack/trace,
  // which would double on rehydrate). Best-effort: missing column (0029 not yet applied) → silent no-op.
  await saveSessionState(ctx.sessionId, {
    journeyId: ctx.journeyId,
    journeyStep: typeof out.journeyStep === 'number' ? out.journeyStep : undefined,
    currentPosition: out.currentPosition ?? null,
    sessionStatus: out.sessionStatus,
  });

  const top = out.retrieved?.[0];
  // #18 (review HIGH): the secondary must INDEPENDENTLY clear the SAME trust gate as the primary (gateForVector
  // only validated `top`) AND be a DISTINCT source (no near-duplicate restatement) — else there is no secondary.
  const altRaw = out.retrieved?.[1];
  const sourceAlt = (altRaw && chunkPassesGate(altRaw, minConfidence) && altRaw.source !== top?.source) ? altRaw : undefined;
  // Recency (days since last verified) — feeds the trust panel + the AI's recency-honest hedging (Phase B).
  const recencyDays = top?.last_verified ? Math.floor((Date.now() - Date.parse(top.last_verified)) / 86_400_000) : null;
  emit({
    type: 'beat',
    loopIdx: turn.loop ?? (out.interpretation?.isMetaExplain ? 4 : out.gated ? 2 : 3),
    phase: out.interpretation?.isMetaExplain ? 'Explain' : out.gated ? 'Confidence gate' : 'Retrieve · Navigate',
    brain: (out.trace ?? []).slice(-1)[0] ?? 'Running the loop.',
    sub: out.interpretation?.intent ?? '',
    conf: top?.confidence ?? null,
  });

  const navigated = !!out.navAction || !!out.navigation?.ok;
  const band: 'high' | 'medium' | 'low' | 'very_low' = out.band ?? (out.gated ? 'very_low' : 'medium');
  const hasSource = !!(!out.gated && top);
  // Knowledge governance: the trust panel shows the source (operator transparency) when present + relevant.
  if (top && (!out.gated || navigated)) {
    emit({ type: 'cite', k: { title: top.source_title ?? String(top.content).slice(0, 64), content: top.content, source: top.source, conf: top.confidence, ver: String(top.product_version ?? '').replace(/^v/i, ''), status: top.validation_status, verified: top.last_verified, type: top.category ?? 'docs', lifecycle: top.lifecycle_state ?? null, owner: top.source_owner ?? null, validatedBy: top.validated_by ?? null, validatedAt: top.validated_at ?? null, recencyDays } });
    // Wave C #18 (review): a secondary-grounded clause must be ATTRIBUTABLE too — surface the GATED secondary's
    // provenance in the trust panel so no spoken fact is uncited.
    if (hasSource && sourceAlt) {
      const altAge = sourceAlt.last_verified ? Math.floor((Date.now() - Date.parse(sourceAlt.last_verified)) / 86_400_000) : null;
      emit({ type: 'cite', k: { title: sourceAlt.source_title ?? String(sourceAlt.content).slice(0, 64), content: sourceAlt.content, source: sourceAlt.source, conf: sourceAlt.confidence, ver: String(sourceAlt.product_version ?? '').replace(/^v/i, ''), status: sourceAlt.validation_status, verified: sourceAlt.last_verified, type: sourceAlt.category ?? 'docs', lifecycle: sourceAlt.lifecycle_state ?? null, owner: sourceAlt.source_owner ?? null, validatedBy: sourceAlt.validated_by ?? null, validatedAt: sourceAlt.validated_at ?? null, recencyDays: altAge, secondary: true } });
    }
  }
  if (out.navAction) {
    // RC-31: carry productId + intent so the desktop can report the LANDED url back for drift detection
    // (the engine turns this nav's ok=NULL selection into a real outcome + a drift event on divergence).
    emit({ type: 'nav', clientDriven: true, label: out.navAction.label, selectors: out.navAction.selectors ?? [], url: out.navAction.url ?? '', healedVia: null, productId: ctx.productId, intent: turn.text });
  } else if (out.navigation?.url) {
    emit({ type: 'nav', url: out.navigation.url, healedVia: out.navigation.healedVia ?? null, screenshot: await shot() });
  }
  if (out.blockedMutations?.length) emit({ type: 'blocked', actions: out.blockedMutations });

  const screen = out.navAction?.label ?? out.navigation?.url ?? 'the relevant screen';
  // ── COMPLIANCE GATE (Behavior + Knowledge governance) — validate BEFORE generating the answer.
  const compliance: ComplianceResult = validateCompliance({ persona, text: `${turn.text} ${out.interpretation?.intent ?? ''}`, band, hasSource });
  let escalation: { trigger: string; reason: string; toPersona: string | null } | null = null;

  if (out.explanation) {
    // Meta-explain / govern / resume / journey narration — already composed in-voice.
    emit({ type: 'message', side: 'ai', who: aiWho, role: 'VIN Demo', text: out.explanation, uncertain: !!out.gated });
  } else if (turn.advance) {
    // #7: a SILENT journey transit step — the screen was driven but intentionally not narrated. Emit no AI
    // line and do NOT fall through to answerAs (which would invent an off-script answer for a transit screen).
  } else if (!compliance.ok) {
    // A guardrail fired → DEGRADE: never emit the ungoverned answer. Record + (on escalate) suggest a hand-off.
    const cat = (compliance.violations.find((v) => v.layer === 'behavior')?.rule.split(':')[0] ?? 'that').replace(/_/g, ' ');
    if (compliance.action === 'block') {
      emit({ type: 'message', side: 'ai', who: aiWho, role: 'VIN Demo', text: `I'm not able to commit to anything on ${cat} — that's outside what I can stand behind. I can show you the relevant screen, or bring in the right specialist.`, uncertain: true });
    } else { // escalate
      const to = compliance.escalateTo ?? 'Lead Consultant';
      escalation = { trigger: 'guardrail', reason: compliance.violations.map((v) => v.detail).join('; '), toPersona: to };
      await recordEscalation(ctx.sessionId, persona?.id ?? null, to, 'guardrail', escalation.reason);
      emit({ type: 'message', side: 'ai', who: aiWho, role: 'VIN Demo', text: `That's really a ${cat} question — as the ${aiWho} I won't commit to that, so I'd bring in the ${to} to give you a straight answer. Want me to?`, uncertain: true });
      if (compliance.escalateTo) emit({ type: 'handoff_suggestion', topic: cat, toPersona: compliance.escalateTo });
    }
  } else {
    // ALLOWED → grounded composition in the active voice; citation policy decides inline citing.
    const room = await gatherRoom(ctx.sessionId, out.activeStakeholder);
    // #1 / RC-17 (undo the regression): the pinned outcome should FRAME an answer only on a genuinely value-relevant
    // turn — an objection, a stated business objective, or value-seeking curiosity (e.g. an ROI/payback question) —
    // NOT every turn (passing it on plain 'question'/'clarification' turns is what padded every answer). The
    // outcomeHint span still self-gates ("when genuinely relevant... never force it"), so this only narrows WHEN it
    // can appear; it never forces it.
    const k = out.interpretation?.kind;
    const valueRelevant = k === 'objection' || k === 'business_objective' || k === 'curiosity';
    // Wave C #9 (review-hardened): ONLY on a GROUNDED objection turn, surface the committee concern(s) that
    // actually OVERLAP the buyer's words (token overlap ≥2 — the assembler's relevance discipline) — never an
    // unrelated authored objection. Sanitize the authored text, cap to the top 3, keep it role-level (no presence).
    let committee: { role: string; objection: string; criteria?: string[] }[] | undefined;
    if (hasSource && k === 'objection' && ctx.committee.length) {
      const qTokens = new Set(`${turn.text} ${out.interpretation?.intent ?? ''}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));
      const overlap = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 && qTokens.has(t)).length;
      const sani = (s: string) => s.replace(/[·•|*`]+/g, ';').replace(/\s+/g, ' ').trim();
      const matched = ctx.committee
        .map((c) => { const best = (c.objections ?? []).map((o) => ({ o, n: overlap(o) })).sort((a, b) => b.n - a.n)[0]; return best && best.n >= 2 ? { role: c.role, objection: sani(best.o), criteria: (c.decisionCriteria ?? []).map(sani).slice(0, 3), n: best.n } : null; })
        .filter((x): x is { role: string; objection: string; criteria: string[]; n: number } => !!x)
        .sort((a, b) => b.n - a.n).slice(0, 3)
        .map(({ role, objection, criteria }) => ({ role, objection, criteria }));
      committee = matched.length ? matched : undefined;
    }
    let text: string;
    try {
      text = await getLlm().answerAs({
        personaPreamble: preamble,
        question: turn.text,
        intent: out.interpretation?.intent ?? turn.text,
        band,
        source: hasSource ? { content: top.content, source: top.source, version: top.product_version, confidence: top.confidence, owner: top.source_owner, validatedBy: top.validated_by, validatedAt: top.validated_at, sourceType: top.source_type, recencyDays } : null,
        sourceAlternate: hasSource && sourceAlt ? { content: String(sourceAlt.content), source: String(sourceAlt.source) } : undefined, // Wave C #18: 2nd chunk for one extra grounded clause
        screen: navigated ? screen : undefined,
        screenFacts: out.screenFacts || undefined, // RC-06: the navigated screen's buttons/actions/required-fields → product-aware answer
        audience: room.audience || undefined,
        priorContext: room.priorContext || undefined,
        cite: shouldCite(persona?.citationPolicy, band, hasSource),
        outcome: valueRelevant && ctx.journeyGoal ? ctx.journeyGoal : undefined, // #1/RC-17: frame against the outcome ONLY on a value/objection turn — not every turn (that padded every answer)
        // Wave C #10: alongside the outcome (so the metric rides WITH the goal frame, never stranded), the
        // quantified metric/baseline→target so an ROI/payback answer can state a REAL number when one is committed.
        outcomeMetric: valueRelevant && ctx.journeyGoal ? ctx.outcomeMetric || undefined : undefined,
        outcomeBaseline: valueRelevant && ctx.journeyGoal ? ctx.outcomeBaseline || undefined : undefined,
        outcomeTarget: valueRelevant && ctx.journeyGoal ? ctx.outcomeTarget || undefined : undefined,
        committee, // Wave C #9: the GROUNDED, relevance-matched, sanitized committee concern(s) computed above

        // RC-03: when the caller is the voice channel (turn.stream), stream completed sentences out as
        // `say_chunk` events so TTS starts on sentence 1. The interactive/reel/CLI paths leave it off (blocking).
        onDelta: turn.stream ? (s) => emit({ type: 'say_chunk', text: s }) : undefined,
      });
    } catch {
      text = hasSource ? String(top.content) : "Let me show you on the screen rather than guess at the specifics.";
    }
    emit({ type: 'message', side: 'ai', who: aiWho, role: 'VIN Demo', text, uncertain: band === 'very_low' || band === 'low' });
  }

  if (out.discoveryPrompt) emit({ type: 'message', side: 'ai', who: aiWho, role: 'VIN Demo', text: out.discoveryPrompt, tag: 'discovery' });

  // Collaboration intelligence: out-of-scope hand-off SUGGESTION (skip if we already escalated above).
  // Captured so the audit row records WHICH specialist was suggested (was always null before P2).
  let handoffSuggestion: { topic: string; toPersona: string } | null = null;
  if (!escalation) {
    const suggestion = handoffSuggestionFor(persona, turn.text);
    if (suggestion) {
      handoffSuggestion = { topic: suggestion.topic, toPersona: suggestion.toPersona };
      emit({ type: 'handoff_suggestion', topic: suggestion.topic, toPersona: suggestion.toPersona });
    }
  }

  const c = await sessionCost(ctx.sessionId);
  emit({ type: 'cost', total: c.totalUsd, byType: c.byType });

  // ── Meeting audit trail — record the full turn so it's reconstructable (best-effort).
  await recordAuditTurn({
    sessionId: ctx.sessionId, personaId: persona?.id ?? null, personaName: aiWho, promptVersion: persona?.version ?? 1,
    utterance: turn.text, intent: out.interpretation?.intent ?? '',
    knowledgeUsed: top ? [{ source: top.source, confidence: top.confidence, product_version: top.product_version, validation_status: top.validation_status }] : [],
    citations: hasSource ? [{ source: top.source, product_version: top.product_version }] : [],
    confidenceBand: band,
    actionsConsidered: out.blockedMutations ?? [], actionsRejected: out.blockedMutations ?? [],
    handoff: handoffSuggestion, escalation, compliance,
  });
  // RC-02: the GRAPH owns the journey position (state.journeyStep, persisted via the checkpointer). Return it
  // so the voice walk MIRRORS it instead of keeping its own counter that can silently desync after an off-script
  // question. journeyStep is the NEXT step index (navigateJourneyStep advances it); null on a non-walk turn.
  return { journeyStep: typeof out.journeyStep === 'number' ? out.journeyStep : null };
}

// REEL→node re-model (Phase 4): each scripted turn DECLARES the node it targets (`node` = a verified node's
// intent_label). driveTo prefers it when it's a candidate (deterministic scripted path), else falls back to
// the intent-driven pickNode — so a hint that doesn't match this product's graph is simply ignored (safe).
const REEL: { speaker: string; text: string; loop?: number; node?: string }[] = [
  { speaker: 'Procurement', text: 'How does approval delegation work?', loop: 3, node: 'delegation settings' },
  { speaker: 'CFO', text: 'Our approvals stall when I travel — show me the bypassed / delegated approvals.', loop: 3, node: 'bypassed approvals' },
  { speaker: 'Procurement', text: 'Why did you show me that screen?', loop: 4 },
];

/**
 * The REEL: a repeatable canned run of the 3-question approval-delegation scenario through the real
 * brain. Resolves when complete; never calls process.exit (the hosted engine is long-lived).
 */
export async function runLiveSession(emit: Emit, target: SessionTarget = {}): Promise<void> {
  // The reel is the SCRIPTED multi-stakeholder demo — seed the room so the showcase (addressing the CFO,
  // tailoring to each role) works as designed. Live interactive/voice keep it off.
  const ctx = await bootSession('live', { ...target, seedRoom: target.seedRoom ?? true });
  if (!ctx) { emit({ type: 'error', message: 'No product configured — pick a target or set PO_VIN_PRODUCT_ID (run `npm run seed`).' }); return; }

  emit({ type: 'start', product: ctx.productName, scenario: 'Approval delegation', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId });
  for (const turn of REEL) await runTurn(ctx, turn, emit);
  emit({ type: 'beat', loopIdx: 6, phase: 'Demo complete', brain: 'Scenario complete — never fired a mutating action; cost recorded to the session.', sub: 'done' });
  emit({ type: 'done' });
}

/**
 * WALK a pinned journey end to end — the journey RUNS the demo. Each turn advances exactly one story step
 * (the graph's navigateJourneyStep drives the screen on the journey's verified rails AND composes the warm
 * spoken narration into `explanation`, which runTurn emits as the voice line). The JOURNEY decides where the
 * demo goes and in what order — the per-step utterance is just narration context. Owns the journey_run
 * lifecycle. Off-script questions are NOT walked here: the operator/voice routes those through runTurn
 * directly, and the walk resumes at the next step (journeyStep persists via the checkpointer).
 */
export async function walkJourney(ctx: SessionCtx, emit: Emit): Promise<void> {
  if (!ctx.journeyId) { emit({ type: 'error', message: 'No journey pinned for this session.' }); return; }
  const wp = await journeyWalkPlan(ctx.journeyId).catch(() => null);
  if (!wp || !wp.plan.length) { emit({ type: 'error', message: 'This journey has no walkable steps yet — author its workflow(s) first.' }); return; }
  emit({ type: 'journey_start', journey: wp.journey.name, goal: wp.journey.businessGoal ?? '', steps: wp.plan.length, sessionId: ctx.sessionId });
  const run = await startJourneyRun(ctx.journeyId, ctx.sessionId).catch(() => null);
  try {
    for (let i = 0; i < wp.plan.length; i++) {
      const entry = wp.plan[i];
      emit({ type: 'journey_step', index: i, total: wp.plan.length, kind: entry.stepKind, node: entry.nodeLabel ?? null });
      // The JOURNEY decides the screen (navigateJourneyStep); the utterance is only narration context.
      await runTurn(ctx, { speaker: 'Presenter', text: entry.caption ?? `Step ${i + 1}`, loop: 3, advance: true }, emit);
    }
    if (run) await completeJourneyRun(run.runId, 'completed').catch(() => {});
    emit({ type: 'journey_complete', journey: wp.journey.name, steps: wp.plan.length });
  } catch (e: any) {
    if (run) await completeJourneyRun(run.runId, 'aborted').catch(() => {});
    emit({ type: 'error', message: `Journey walk error: ${e?.message ?? e}` });
  }
  emit({ type: 'done' });
}

// CLI entry — local QA and the desktop's dev-only local fallback. Writes NDJSON to stdout, then
// exits. Skipped when this module is imported (e.g. by the hosted engine), so the server stays up.
if (process.argv[1] && /live-session\.(ts|js)$/.test(process.argv[1])) {
  runLiveSession((ev) => process.stdout.write(JSON.stringify(ev) + '\n'))
    .then(() => process.exit(0))
    .catch((e) => { process.stdout.write(JSON.stringify({ type: 'error', message: String(e?.message ?? e) }) + '\n'); process.exit(1); });
}

/**
 * Gemini provider — a second LlmProvider implementation (Google Gemini), selectable from the AI Control model
 * switcher. Talks to the Generative Language REST API directly (no SDK dependency), authenticating with the
 * GEMINI_API_KEY env var via the x-goog-api-key header.
 *
 * PROMPT PARITY: every system prompt comes from the SAME shared builders (sysInterpret/sysAnswerAs/… in llm.ts)
 * that ClaudeProvider uses — so switching the demo to Gemini runs the byte-identical tuned prompts (proven by
 * eval-prompts.ts via the Claude path). Only the transport, structured-output mechanism, and usage/refusal
 * extraction differ here; the user-content assembly and result parsing mirror ClaudeProvider exactly.
 *
 * Capture + cost: every call logs prompt→reply to ai_calls (AI Conversation History) and records a cost event,
 * exactly like ClaudeProvider. Gemini 2.5 "thinking" tokens (thoughtsTokenCount) are billed as output. Thinking
 * is disabled on *flash* models (fast + predictable, no budget-eating truncation); *pro* keeps default thinking
 * with a generous output ceiling.
 */
import { record, currentSession } from './cost.js';
import { db } from './db.js';
import { currentModel } from './settings.js';
import {
  detectFn,
  sysInterpret, sysPickNode, sysExplainWhy, sysAgentStep, sysAnswerAs, sysNarrate, sysDiscover,
  sysHarvestChunks, sysVerifyFaithful, sysDeriveScreens, sysDeriveWorkflows, sysDeriveScreenElements,
  type LlmProvider, type Interpretation, type UtteranceKind, type ExplainContext, type DiscoverContext,
  type AnswerContext, type NarrateContext, type AgentStepContext, type AgentStep, type DiscoverResult,
  type DerivedScreen, type DerivedWorkflow, type DerivedScreenElement,
} from './llm.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResult { text: string; blocked: boolean; }

/** Convert a JSON-Schema (the shape ClaudeProvider passes to output_config) into Gemini's responseSchema:
 *  UPPER-CASE type names, keep enum/description/required/properties/items, drop additionalProperties, and add
 *  propertyOrdering (Gemini emits fields in this order). */
function toGeminiSchema(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const out: any = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) {
    out.properties = {};
    for (const k of Object.keys(s.properties)) out.properties[k] = toGeminiSchema(s.properties[k]);
    out.propertyOrdering = Object.keys(s.properties);
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.required) out.required = s.required;
  return out;
}

/** One Gemini generateContent call. Records cost + logs to ai_calls (best-effort). Returns the text and whether
 *  the response was safety-blocked (so callers degrade exactly like ClaudeProvider does on a refusal). */
async function geminiGenerate(system: string, user: string, maxTokens: number, node: string, schema?: any): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set.');
  const model = currentModel();
  const isFlash = /flash/i.test(model);
  // Flash: thinking OFF → fast + predictable. Pro: thinking CANNOT be disabled and shares the maxOutputTokens
  // pool, so BOUND it and add it ON TOP of the answer budget — the visible answer always keeps its full
  // requested allowance even under heavy thinking (prevents empty/truncated MAX_TOKENS responses).
  const thinkingBudget = isFlash ? 0 : 1024;
  const generationConfig: any = { maxOutputTokens: maxTokens + thinkingBudget, thinkingConfig: { thinkingBudget } };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = toGeminiSchema(schema); }
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig,
  };
  const r = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gemini ${r.status}: ${String(j?.error?.message ?? 'request failed').slice(0, 200)}`);
  const cand = j?.candidates?.[0];
  const fr = cand?.finishReason;
  const text = ((cand?.content?.parts ?? []).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')) || '';
  // Refusal-equivalent → callers degrade cleanly instead of JSON.parse(''): an input block, the model
  // declining (SAFETY/RECITATION/SPII/…), OR any non-STOP finish that left NO usable text (e.g. MAX_TOKENS
  // spent entirely on thinking). A MAX_TOKENS finish that DID emit partial text is left to the parser.
  const declined = fr === 'SAFETY' || fr === 'PROHIBITED_CONTENT' || fr === 'BLOCKLIST' || fr === 'RECITATION' || fr === 'SPII';
  const blocked = !!j?.promptFeedback?.blockReason || declined || (!!fr && fr !== 'STOP' && !text.trim());
  const u = j?.usageMetadata ?? {};
  // Cached prompt tokens bill at ~25% on Gemini → discount them so input cost isn't overstated. Thinking → output.
  const cached = u.cachedContentTokenCount ?? 0;
  const input = Math.max(0, (u.promptTokenCount ?? 0) - Math.round(cached * 0.75));
  const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  await record('llm', model, { input, output }, { node });
  try {
    await db().query(
      `INSERT INTO ai_calls (demo_session_id, fn, model, system_prompt, user_prompt, reply, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [currentSession(), detectFn(system), model, system, user, text, input, output],
    );
  } catch { /* best-effort: never break or slow a demo to log a call */ }
  return { text, blocked };
}

// Schemas mirror ClaudeProvider's output_config schemas (plain JSON-Schema; converted to Gemini's shape above).
const SCHEMA_INTERPRET = { type: 'object', properties: { intent: { type: 'string' }, kind: { type: 'string', enum: ['question', 'clarification', 'objection', 'curiosity', 'business_objective'] }, isMetaExplain: { type: 'boolean' }, isResume: { type: 'boolean' }, control: { type: 'string', enum: ['pause', 'stop', 'continue', 'none'] }, reasoning: { type: 'string' } }, required: ['intent', 'kind', 'isMetaExplain', 'isResume', 'control', 'reasoning'] };
const SCHEMA_AGENTSTEP = { type: 'object', properties: { action: { type: 'string', enum: ['click', 'type', 'select', 'navigate', 'done'] }, ref: { type: 'integer' }, value: { type: 'string' }, say: { type: 'string' } }, required: ['action', 'ref', 'value', 'say'] };
const SCHEMA_DISCOVER = { type: 'object', properties: { painPoints: { type: 'array', items: { type: 'string' } }, buyingSignals: { type: 'array', items: { type: 'string' } }, businessObjective: { type: 'string' }, question: { type: 'string' } }, required: ['painPoints', 'buyingSignals', 'businessObjective', 'question'] };
const SCHEMA_HARVEST = { type: 'object', properties: { chunks: { type: 'array', items: { type: 'string' } } }, required: ['chunks'] };
const SCHEMA_VERIFY = { type: 'object', properties: { supported: { type: 'boolean' } }, required: ['supported'] };
const SCHEMA_SCREENS = { type: 'object', properties: { screens: { type: 'array', items: { type: 'object', properties: { intentLabel: { type: 'string' }, screenName: { type: 'string' }, screenType: { type: 'string' }, evidence: { type: 'string' } }, required: ['intentLabel', 'screenName', 'screenType', 'evidence'] } } }, required: ['screens'] };
const SCHEMA_WORKFLOWS = { type: 'object', properties: { workflows: { type: 'array', items: { type: 'object', properties: { workflowName: { type: 'string' }, businessPurpose: { type: 'string' }, personaType: { type: 'string' }, stakeholderType: { type: 'string' }, nodeSequence: { type: 'array', items: { type: 'string' } }, successCriteria: { type: 'string' }, evidence: { type: 'string' } }, required: ['workflowName', 'businessPurpose', 'personaType', 'stakeholderType', 'nodeSequence', 'successCriteria', 'evidence'] } } }, required: ['workflows'] };
const SCHEMA_ELEMENTS = { type: 'object', properties: { elements: { type: 'array', items: { type: 'object', properties: { elementType: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } }, required: ['elementType', 'label', 'description'] } } }, required: ['elements'] };

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';

  async interpret(utterance: string): Promise<Interpretation> {
    const r = await geminiGenerate(sysInterpret(), utterance, 2048, 'interpret', SCHEMA_INTERPRET);
    if (r.blocked) throw new Error('interpret: model refused the utterance');
    let parsed: Partial<Interpretation>;
    try { parsed = JSON.parse(r.text); } catch { throw new Error(`interpret: structured output was not valid JSON: ${r.text.slice(0, 200)}`); }
    const kinds: UtteranceKind[] = ['question', 'clarification', 'objection', 'curiosity', 'business_objective'];
    if (typeof parsed.intent !== 'string' || !parsed.kind || !kinds.includes(parsed.kind)) throw new Error(`interpret: invalid interpretation: ${JSON.stringify(parsed)}`);
    const rawControl = (parsed as { control?: string }).control;
    const control = rawControl === 'pause' || rawControl === 'stop' || rawControl === 'continue' ? rawControl : null;
    return { intent: parsed.intent, kind: parsed.kind, isMetaExplain: !!parsed.isMetaExplain, isResume: !!parsed.isResume, control, reasoning: parsed.reasoning ?? '' };
  }

  async pickNode(intent: string, labels: string[]): Promise<string> {
    if (labels.length === 0) return ''; // no candidates → nothing fits (1 candidate still gets a real fit-check)
    // Gemini rejects an empty-string enum value, so the "none fit" sentinel is 'NONE' (mapped back to '').
    // This is schema-only — the shared system prompt stays byte-identical to Claude's.
    const schema = { type: 'object', properties: { label: { type: 'string', enum: [...labels, 'NONE'] } }, required: ['label'] };
    const r = await geminiGenerate(sysPickNode(), `Intent: ${JSON.stringify(intent)}\nScreens: ${JSON.stringify(labels)}`, 512, 'pickNode', schema);
    try { const l = JSON.parse(r.text).label; return (!l || l === 'NONE') ? '' : l; } catch { return ''; }
  }

  async explainWhy(ctx: ExplainContext): Promise<string> {
    const user =
      `Their question: ${ctx.question}\n` +
      `Your prior detected intent: ${ctx.priorIntent}\n` +
      `The answer you gave: ${ctx.answer}\n` +
      `The screen you navigated to: ${ctx.navUrl}\n` +
      `Decision trace:\n${ctx.trace.join('\n')}`;
    const r = await geminiGenerate(sysExplainWhy(ctx), user, 1024, 'explain');
    if (r.blocked) return "I'd rather not guess at a justification — I can show you the source again instead.";
    return r.text.trim() || "I can't reconstruct why from the trace — let me show you the source again instead.";
  }

  async agentStep(ctx: AgentStepContext): Promise<AgentStep> {
    const done = (say: string): AgentStep => ({ action: 'done', ref: -1, value: '', say });
    const elementList = ctx.elements.map((e) => {
      const flags = [e.required ? 'REQUIRED' : '', e.filled ? 'filled' : (e.kind && /text|select|textarea|email|number|tel|date|password|search/.test(e.kind) ? 'EMPTY' : '')].filter(Boolean).join(',');
      const opts = e.options && e.options.length ? ` options=[${e.options.slice(0, 25).map((o) => JSON.stringify(o)).join(', ')}]` : '';
      return `[${e.ref}] ${e.kind ?? e.role ?? 'el'}: ${JSON.stringify(e.text)}${flags ? ` (${flags})` : ''}${opts}`;
    }).join('\n');
    const user =
      `Goal: ${JSON.stringify(ctx.goal)}\n` +
      // RC-01: session-awareness + shared working state (provider parity with ClaudeProvider). USER message only.
      (ctx.sessionGoal ? `This demo is in service of: ${JSON.stringify(ctx.sessionGoal)} — keep actions aligned to it.\n` : '') +
      (ctx.currentScreen ? `The session was last on: ${JSON.stringify(ctx.currentScreen)}${ctx.journeyStep != null ? ` (journey step ${ctx.journeyStep})` : ''} — continue from there; don't re-navigate to it if you're already here.\n` : '') +
      (ctx.fieldsDone?.length ? `Fields already set this session (do NOT re-fill or re-select these): ${ctx.fieldsDone.map((f) => JSON.stringify(f)).join(', ')}\n` : '') +
      `Driving as: ${ctx.role}\n` +
      `Current URL: ${ctx.url}\nTitle: ${ctx.title}\n` +
      `Headings: ${JSON.stringify(ctx.headings.slice(0, 12))}\n` +
      `Steps already taken this turn:\n${ctx.history.length ? ctx.history.map((h, i) => `${i + 1}. ${h}`).join('\n') : '(none yet)'}\n\n` +
      (ctx.knownScreens?.length ? `Verified demo-graph screens for this product (the navigation AUTHORITY — when the goal matches one of these, prefer reaching it by its name/route): ${ctx.knownScreens.map((s) => (s.route ? `${s.label} (${s.route})` : s.label)).join(' · ')}\n\n` : '') +
      `Interactive elements on screen:\n${elementList || '(none detected)'}`;
    const r = await geminiGenerate(sysAgentStep(ctx), user, 1024, 'agentStep', SCHEMA_AGENTSTEP);
    if (r.blocked) return done("I'd rather not guess my next move here — want to take over?");
    try {
      const p = JSON.parse(r.text);
      const action = p.action === 'click' || p.action === 'type' || p.action === 'select' || p.action === 'navigate' ? p.action : 'done';
      return { action, ref: Number.isInteger(p.ref) ? p.ref : -1, value: typeof p.value === 'string' ? p.value : '', say: typeof p.say === 'string' ? p.say : '' };
    } catch { return done('I had trouble planning the next step — take over whenever you like.'); }
  }

  async answerAs(ctx: AnswerContext): Promise<string> {
    const grounded = ctx.band !== 'very_low' && ctx.source?.content;
    const user =
      `Question: ${JSON.stringify(ctx.question)}\n` +
      `Detected intent: ${ctx.intent}\n` +
      (ctx.screen ? `Live screen now: ${ctx.screen}\n` : '') +
      (ctx.audience ? `In the room: ${ctx.audience}\n` : '') +
      (ctx.priorContext ? `Earlier in this session: ${ctx.priorContext}\n` : '') +
      (grounded
        ? `\nSOURCE (the only facts you may state — verbatim from the product knowledge base):\n"""\n${ctx.source!.content}\n"""\n` +
          `Provenance: ${ctx.source!.source}` +
          (ctx.source!.version ? ` · ${ctx.source!.version}` : '') +
          (ctx.source!.owner ? ` · owned by ${ctx.source!.owner}` : '') +
          (ctx.source!.validatedBy ? ` · validated by ${ctx.source!.validatedBy}${ctx.source!.validatedAt ? ` on ${String(ctx.source!.validatedAt).slice(0, 10)}` : ''}` : '') +
          (ctx.source!.recencyDays != null ? ` · last verified ${ctx.source!.recencyDays}d ago` : '')
        : `\n(No verified source is available for this question.)`);
    const r = await geminiGenerate(sysAnswerAs(ctx), user, 900, 'answerAs');
    if (r.blocked) return "I'd rather not guess here — let me show you the screen instead.";
    return r.text.trim() || "Let me show you on the screen rather than guess at the specifics.";
  }

  async narrate(ctx: NarrateContext): Promise<string> {
    const fallback = (ctx.caption?.trim()) || (ctx.screen ? `Here's the ${ctx.screen}.` : 'Let me walk you through this.');
    try {
      const user =
        `Now showing: ${ctx.screen ?? '(a narration moment — no screen change)'}\n` +
        (ctx.caption ? `Beat to convey (paraphrase naturally, do NOT read aloud): ${ctx.caption}\n` : '') +
        // RC-16: grounded source — paraphrase ONLY this (provider parity with ClaudeProvider).
        (ctx.sourceText ? `Source to paraphrase (the ONLY product facts you may state; do NOT read verbatim): ${ctx.sourceText}\n` : '') +
        (ctx.outcome ? `Outcome this advances: ${ctx.outcome}\n` : '') +
        (ctx.audience ? `In the room: ${ctx.audience}\n` : '') +
        `\nSpeak the one or two sentence narration now.`;
      const r = await geminiGenerate(sysNarrate(ctx), user, 160, 'narrate');
      if (r.blocked) return fallback;
      return r.text.trim() || fallback;
    } catch { return fallback; }
  }

  async discover(ctx: DiscoverContext): Promise<DiscoverResult> {
    const empty: DiscoverResult = { painPoints: [], buyingSignals: [], businessObjective: null, question: '' };
    const user =
      `Utterance: ${JSON.stringify(ctx.utterance)}\n` +
      `Detected kind: ${ctx.kind}\n` +
      `What we just showed them: ${ctx.answer.slice(0, 400)}`;
    const r = await geminiGenerate(sysDiscover(ctx), user, 1024, 'discover', SCHEMA_DISCOVER);
    if (r.blocked) return empty;
    try {
      const p = JSON.parse(r.text);
      const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);
      const obj = typeof p.businessObjective === 'string' && p.businessObjective.trim() ? p.businessObjective.trim() : null;
      return { painPoints: strs(p.painPoints), buyingSignals: strs(p.buyingSignals), businessObjective: obj, question: typeof p.question === 'string' ? p.question.trim() : '' };
    } catch { return empty; }
  }

  async harvestChunks(ctx: { product: string; screen: string; capturedText: string }): Promise<string[]> {
    if (!ctx.capturedText || ctx.capturedText.trim().length < 40) return [];
    const r = await geminiGenerate(sysHarvestChunks(), `Product: ${ctx.product}\nScreen: ${ctx.screen}\n\nCAPTURED SCREEN TEXT (the ONLY source you may use):\n"""\n${ctx.capturedText.slice(0, 6000)}\n"""`, 1024, 'harvestChunks', SCHEMA_HARVEST);
    if (r.blocked) return [];
    try {
      const p = JSON.parse(r.text);
      return Array.isArray(p.chunks) ? p.chunks.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 15).map((c: string) => c.trim()) : [];
    } catch { return []; }
  }

  async verifyFaithful(ctx: { statement: string; source: string }): Promise<boolean> {
    const r = await geminiGenerate(sysVerifyFaithful(), `SOURCE:\n"""\n${ctx.source.slice(0, 6000)}\n"""\n\nSTATEMENT:\n"""\n${ctx.statement}\n"""`, 256, 'verifyFaithful', SCHEMA_VERIFY);
    if (r.blocked) return false;
    try { return JSON.parse(r.text).supported === true; } catch { return false; }
  }

  async deriveScreens(ctx: { product: string; knowledge: string }): Promise<DerivedScreen[]> {
    if (!ctx.knowledge || ctx.knowledge.trim().length < 40) return [];
    const r = await geminiGenerate(sysDeriveScreens(), `Product: ${ctx.product}\n\nVERIFIED KNOWLEDGE (the ONLY source you may use):\n"""\n${ctx.knowledge.slice(0, 200000)}\n"""`, 4096, 'deriveScreens', SCHEMA_SCREENS);
    if (r.blocked) return [];
    try {
      const p = JSON.parse(r.text);
      return Array.isArray(p.screens)
        ? p.screens.filter((s: any) => s && typeof s.intentLabel === 'string' && s.intentLabel.trim())
            .map((s: any) => ({ intentLabel: String(s.intentLabel).trim().toLowerCase(), screenName: String(s.screenName ?? s.intentLabel).trim(), screenType: String(s.screenType ?? 'other').trim(), evidence: String(s.evidence ?? '').trim() }))
        : [];
    } catch { return []; }
  }

  async deriveWorkflows(ctx: { product: string; knowledge: string; screens: string[] }): Promise<DerivedWorkflow[]> {
    if (!ctx.screens.length || !ctx.knowledge) return [];
    const r = await geminiGenerate(sysDeriveWorkflows(), `Product: ${ctx.product}\nSCREEN LABELS (nodeSequence may use ONLY these): ${JSON.stringify(ctx.screens)}\n\nVERIFIED KNOWLEDGE (the ONLY source you may use):\n"""\n${ctx.knowledge.slice(0, 200000)}\n"""`, 4096, 'deriveWorkflows', SCHEMA_WORKFLOWS);
    if (r.blocked) return [];
    try {
      const p = JSON.parse(r.text);
      const allowed = new Set(ctx.screens.map((s) => s.toLowerCase()));
      return Array.isArray(p.workflows)
        ? p.workflows.filter((w: any) => w && typeof w.workflowName === 'string' && w.workflowName.trim())
            .map((w: any) => ({ workflowName: String(w.workflowName).trim(), businessPurpose: String(w.businessPurpose ?? '').trim(), personaType: String(w.personaType ?? 'other').trim(), stakeholderType: String(w.stakeholderType ?? 'none').trim(), nodeSequence: Array.isArray(w.nodeSequence) ? w.nodeSequence.map((x: any) => String(x).trim().toLowerCase()).filter((x: string) => allowed.has(x)) : [], successCriteria: String(w.successCriteria ?? '').trim(), evidence: String(w.evidence ?? '').trim() }))
        : [];
    } catch { return []; }
  }

  async deriveScreenElements(ctx: { product: string; screenName: string; screenType: string; evidence: string; knowledge: string }): Promise<DerivedScreenElement[]> {
    const evidence = (ctx.evidence ?? '').trim();
    if (evidence.length < 20 && (!ctx.knowledge || ctx.knowledge.trim().length < 40)) return [];
    const r = await geminiGenerate(sysDeriveScreenElements(), `Product: ${ctx.product}\nScreen: ${ctx.screenName} (${ctx.screenType})\n\nEVIDENCE for this screen:\n"""\n${evidence.slice(0, 4000)}\n"""\n\nBROADER VERIFIED KNOWLEDGE (supporting context):\n"""\n${ctx.knowledge.slice(0, 8000)}\n"""`, 2048, 'deriveScreenElements', SCHEMA_ELEMENTS);
    if (r.blocked) return [];
    const ALLOWED = new Set(['field', 'button', 'action', 'tab', 'error', 'faq', 'note']);
    try {
      const p = JSON.parse(r.text);
      return Array.isArray(p.elements)
        ? p.elements.filter((e: any) => e && typeof e.label === 'string' && e.label.trim() && ALLOWED.has(String(e.elementType)))
            .map((e: any) => ({ elementType: String(e.elementType) as DerivedScreenElement['elementType'], label: String(e.label).trim(), description: String(e.description ?? '').trim() }))
        : [];
    } catch { return []; }
  }
}

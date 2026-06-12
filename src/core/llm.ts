/**
 * LLM provider — narrow interface, cloud-only build (Claude; model from ANTHROPIC_MODEL, default
 * claude-opus-4-8), per plan §4. The walking skeleton's `interpret` step lives here; `narrate`
 * (explain node) lands in increment 3.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';
import { record, currentSession } from './cost.js';
import { db } from './db.js';
import { rp } from './prompts.js';
import { currentModel, providerForModel } from './settings.js';
import { GeminiProvider } from './llm-gemini.js';
import type { ExecutionMode } from './safety.js';

loadEnv();

// The model is now a LIVE setting (settings.ts): the operator switches it from the web console and it applies
// on the next turn — no redeploy. Default stays the known-good claude-opus-4-8 (env ANTHROPIC_MODEL still seeds
// the default). Each method reads currentModel() so a mid-session switch is picked up. getLlm() selects the
// provider (Claude or Gemini, see GeminiProvider in llm-gemini.ts) from the chosen model.

/** Intent-driven, never script-driven (rule §3): classify what the stakeholder is doing. */
export type UtteranceKind = 'question' | 'clarification' | 'objection' | 'curiosity' | 'business_objective';

export interface Interpretation {
  intent: string;        // the information need, as a retrieval query
  kind: UtteranceKind;
  isMetaExplain: boolean; // asking the agent to justify its OWN last action ("why did you show that?")
  isResume: boolean;      // asking to go back to where we were before a detour
  control: 'pause' | 'stop' | 'continue' | null; // governance over the SESSION (pause/stop/resume)
  reasoning: string;
}

export interface ExplainContext {
  question: string;
  priorIntent: string;
  answer: string;
  navUrl: string;
  trace: string[];
  personaPreamble?: string; // active specialist overlay (system prompt + scope + hard limits), if handed off
}

export interface DiscoverContext {
  utterance: string;
  kind: UtteranceKind;
  answer: string; // the chunk just shown, to ground the discovery question
  personaPreamble?: string; // active specialist overlay, if handed off
}

/** Grounded persona answer: re-express the CITED source in the specialist's voice/framework/audience-
 *  awareness, instructed to use only the source's facts. Grounding is PROMPT-ENFORCED (the system prompt
 *  hard-instructs "ground only in the SOURCE; if it doesn't answer, say so") + gated upstream by the
 *  confidence band — it is not output-verified, so treat it as strong mitigation, not a hard guarantee. */
export interface AnswerContext {
  personaPreamble: string;        // the specialist "brain" overlay (voice, framework, traits, …)
  question: string;
  intent: string;
  band: 'high' | 'medium' | 'low' | 'very_low';
  // the cited chunk + its PROVENANCE (migration 0011) so the AI can prove itself when probed:
  source?: {
    content: string; source: string; version?: string | null; confidence?: number | null;
    owner?: string | null; validatedBy?: string | null; validatedAt?: string | null;
    sourceType?: string | null; recencyDays?: number | null;
  } | null;
  screen?: string;                // the live screen navigated to (context only)
  screenFacts?: string;           // RC-06: a COMPACT read of the navigated screen's UX surface (key buttons/actions/required-fields/permissions, from the per-element model) so the answer speaks from what's ACTUALLY on the page, not just the doc chunk
  audience?: string;              // who's in the room (active speaker + stakeholder collection) — Phase 2
  priorContext?: string;          // prior concerns/objections/topics this session — Phase 2 relationship memory
  cite?: boolean;                 // citation policy (governance) — name the source inline when true
  outcome?: string;               // RC-17: the buyer's business outcome to FRAME the answer against (when relevant) — turns a doc-bot answer into a consultant one
  // RC-03 (streaming voice): when set, the answer is STREAMED and each completed sentence is delivered here
  // as it arrives, so the voice channel can start TTS on sentence 1 instead of waiting for the whole reply.
  // Omitted (interactive/reel/CLI) → the existing blocking call. Claude only; Gemini answers blocking.
  onDelta?: (sentence: string) => void;
}

export interface DiscoverResult {
  painPoints: string[];
  buyingSignals: string[];
  businessObjective: string | null;
  question: string; // ONE concise discovery question to offer next
}

/** One element on the live page the agent can act on (perceived from the embedded browser's DOM). */
export interface PageElement { ref: number; text: string; role?: string; kind?: string; options?: string[]; required?: boolean; filled?: boolean; value?: string; /* RC-08: the CHOSEN/typed value (dropdowns, inputs) so the model sees what a field is set to, not just that it's filled */ }
export interface NarrateContext {
  personaPreamble: string;
  stepKind: 'workflow' | 'tour' | 'knowledge' | 'note';
  caption?: string | null;   // authored beat caption / step label — a HINT to paraphrase, never read verbatim
  screen?: string | null;    // the screen now on display (node steps); null for a narration-only beat
  audience?: string | null;  // who's in the room (committee role/summary)
  outcome?: string | null;   // the business outcome this journey advances
  // RC-16: GROUNDED source for a knowledge beat — the resolved chunk content. When present, the narration
  // paraphrases ONLY this; when absent, the model orients to the screen rather than asserting product specifics.
  sourceText?: string | null;
  // RC-03 (streaming voice): the voice-led WALK is the primary demo path — stream each completed sentence
  // here so its narration starts speaking on sentence 1 too (not after the whole line). Omitted → blocking.
  onDelta?: (sentence: string) => void;
}

export interface AgentStepContext {
  goal: string;            // the stakeholder's request — what to demonstrate / answer
  url: string;
  title: string;
  headings: string[];
  elements: PageElement[]; // the interactive elements currently on screen (with stable refs)
  history: string[];       // narrations of the steps already taken this turn
  role: string;            // the persona the agent is driving as
  mode: ExecutionMode;     // read-only/safe/approval → never commit; execution → may save/submit
  personaPreamble?: string; // active specialist overlay (system prompt + scope + hard limits), if handed off
  knownScreens?: { label: string; route: string | null }[]; // the product's VERIFIED demo-graph screens (the navigation authority) — prefer these (Phase 2 bridge)
  notices?: string[];      // RC-08: visible alerts/validation/toasts on screen now (so the agent can react to a failed submit, a success banner, etc.)
  sessionGoal?: string | null; // RC-01: the session's pinned-journey business goal/outcome — light framing so the (otherwise stateless) drive loop keeps its actions aligned to the demo's purpose. Best-effort; absent → drives exactly as before.
}
/** The single next action the agent takes to drive the live demo (read-only: never commits). */
export interface AgentStep {
  action: 'click' | 'type' | 'select' | 'done';
  ref: number;             // element ref for click/type/select (-1 when action=done)
  value: string;           // text to type, or the option to choose for 'select' ("" otherwise)
  say: string;             // one-sentence narration, grounded in what's on screen
}

/** Knowledge→graph derivation (Phase B): a candidate SCREEN strictly grounded in validated knowledge. */
export interface DerivedScreen { intentLabel: string; screenName: string; screenType: string; evidence: string }
/** Knowledge→graph derivation (Phase B): a candidate WORKFLOW over derived screen labels, grounded in knowledge. */
export interface DerivedWorkflow { workflowName: string; businessPurpose: string; personaType: string; stakeholderType: string; nodeSequence: string[]; successCriteria: string; evidence: string }
/** Knowledge→graph derivation: a candidate ELEMENT (button/action/form field/…) on a screen, grounded in knowledge. */
export interface DerivedScreenElement { elementType: 'field' | 'button' | 'action' | 'tab' | 'error' | 'faq' | 'note'; label: string; description: string }

export interface LlmProvider {
  readonly id: string;
  interpret(utterance: string): Promise<Interpretation>;
  /** Pick the best-matching demo target from candidate labels (or '' if none fit). */
  pickNode(intent: string, labels: string[]): Promise<string>;
  /** Explain, grounded in the trace, why the agent showed what it showed. */
  explainWhy(ctx: ExplainContext): Promise<string>;
  /** Active discovery (E): extract expressed pain/signal/objective and offer ONE question. */
  discover(ctx: DiscoverContext): Promise<DiscoverResult>;
  /** Decide the next action to DRIVE a live demo from the current page (read-only ReAct step). */
  agentStep(ctx: AgentStepContext): Promise<AgentStep>;
  /** Compose a persona-voiced answer grounded in the cited source (prompt-enforced, band-gated). */
  answerAs(ctx: AnswerContext): Promise<string>;
  /** Compose ONE warm, conversational spoken line for a journey step — what the specialist SAYS while the
   *  screen is shown. Natural human speech (no labels, markdown, or JSON). Falls back to a clean caption line. */
  narrate(ctx: NarrateContext): Promise<string>;
  /** Recon-harvest (fact-rooted KB generator): extract knowledge statements STRICTLY grounded in captured screen text. */
  harvestChunks(ctx: { product: string; screen: string; capturedText: string }): Promise<string[]>;
  /** Faithfulness gate (zero-hallucination): is every claim in `statement` explicitly supported by `source`? */
  verifyFaithful(ctx: { statement: string; source: string }): Promise<boolean>;
  /** Knowledge→graph (Phase B): derive candidate SCREENS strictly grounded in the product's validated knowledge. */
  deriveScreens(ctx: { product: string; knowledge: string }): Promise<DerivedScreen[]>;
  /** Knowledge→graph (Phase B): derive candidate WORKFLOWS over the given screen labels, grounded in knowledge. */
  deriveWorkflows(ctx: { product: string; knowledge: string; screens: string[] }): Promise<DerivedWorkflow[]>;
  /** Knowledge→graph derivation: the buttons/actions/forms/fields/errors a screen exposes, grounded in knowledge. */
  deriveScreenElements(ctx: { product: string; screenName: string; screenType: string; evidence: string; knowledge: string }): Promise<DerivedScreenElement[]>;
}

// Per-band posture for grounded persona answers — what the specialist DOES at each confidence level. The text
// is now editable in the prompt registry (answerAs.band.*); this just maps the band enum to its key.
const BAND_KEY: Record<AnswerContext['band'], string> = { high: 'answerAs.band.high', medium: 'answerAs.band.medium', low: 'answerAs.band.low', very_low: 'answerAs.band.veryLow' };
export function bandPosture(band: AnswerContext['band']): string { return rp(BAND_KEY[band]); }

// ── Shared system-prompt builders ─────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the assembled system prompt of every function — used by BOTH ClaudeProvider and
// GeminiProvider so the two providers run BYTE-IDENTICAL prompts (the tuned, safety-critical text). Each
// composes the editable registry spans (rp) with the in-code dynamic wrappers. The byte-identity eval
// (eval-prompts.ts) captures these via the Claude path; keeping the providers on the same builders means
// switching to Gemini cannot silently detune a prompt. Do NOT inline a system prompt in a provider method.
export const sysInterpret = (): string => rp('interpret');
export const sysPickNode = (): string => rp('pickNode');
export const sysExplainWhy = (ctx: ExplainContext): string =>
  (ctx.personaPreamble ? ctx.personaPreamble + '\n\n— — —\n' : '') +
  rp('explainWhy') +
  (ctx.personaPreamble ? ' Answer in this specialist\'s voice and stay within its scope and hard limits.' : '');
export const sysAgentStep = (ctx: AgentStepContext): string =>
  (ctx.personaPreamble ? ctx.personaPreamble + '\n\n— — —\n' : '') +
  rp('agentStep.intro') +
  (ctx.mode === 'execution' ? rp('agentStep.policyExecution') : rp('agentStep.policyReadonly')) + '\n' +
  rp('agentStep.forms');
export const sysAnswerAs = (ctx: AnswerContext): string => {
  const grounded = ctx.band !== 'very_low' && ctx.source?.content;
  const recencyHint = grounded && ctx.source?.recencyDays != null && ctx.source.recencyDays > 120
    ? ` This source was last verified ${ctx.source.recencyDays} days ago — if it bears on the answer, hedge honestly that it may be due for review.`
    : '';
  const navHint = ctx.screen
    ? ` You have already navigated to "${ctx.screen}" and are looking at it together — you are demonstrating RIGHT NOW. Walk through the steps that are actually on this screen, in order and concisely; do NOT ask permission to demonstrate, and never offer to perform an action you are not actually taking.`
    : '';
  // RC-06: ground the answer in the navigated screen's ACTUAL UX surface (its real buttons/actions/required
  // fields/permissions). In-code wrapper (like navHint) — only appears when screenFacts is supplied, so the
  // byte-identity eval cases (which set none) leave the golden unchanged. Turns the doc-bot into a product-aware
  // consultant: reference only elements named here; never invent buttons or fields the screen does not have.
  const screenFactsHint = ctx.screenFacts
    ? ` ${ctx.screenFacts} Reference only the buttons, actions, and fields actually present here — never invent UI that isn't listed, and respect any noted permissions or not-live markers.`
    : '';
  // RC-17: frame the answer against the buyer's outcome when there is one. In-code wrapper (like navHint), so it
  // only appears when an outcome is supplied — the byte-identity eval cases set none, so the golden is unchanged.
  const outcomeHint = ctx.outcome
    ? ` When it is genuinely relevant, connect your answer to the buyer's goal — ${ctx.outcome} — in one natural phrase; never force it, pad with it, or repeat it.`
    : '';
  return ctx.personaPreamble + '\n\n— — —\n' +
    rp('answerAs.opening') + bandPosture(ctx.band) + recencyHint + '\n' +
    (grounded
      ? rp('answerAs.grounded') + (ctx.cite ? rp('answerAs.cite') : rp('answerAs.noCite')) + rp('answerAs.provenance')
      : rp('answerAs.ungrounded')) +
    rp('answerAs.style') + navHint + screenFactsHint + outcomeHint + rp('answerAs.closing');
};
export const sysNarrate = (ctx: NarrateContext): string => ctx.personaPreamble + '\n\n— — —\n' + rp('narrate');
export const sysDiscover = (ctx: DiscoverContext): string =>
  (ctx.personaPreamble ? ctx.personaPreamble + '\n\n— — —\n' : '') +
  rp('discover.intro') +
  (ctx.personaPreamble ? ' and in this specialist\'s area of focus' : '') +
  rp('discover.tail');
export const sysHarvestChunks = (): string => rp('harvestChunks');
export const sysVerifyFaithful = (): string => rp('verifyFaithful');
export const sysDeriveScreens = (): string => rp('deriveScreens');
export const sysDeriveWorkflows = (): string => rp('deriveWorkflows');
export const sysDeriveScreenElements = (): string => rp('deriveScreenElements');

// Label an LLM call by a stable phrase in its system prompt — best-effort, used to GROUP the AI Conversation
// History by function. (Survives prompt edits as long as the phrase remains; unknown → 'llm'.)
const FN_SIG: [string, string][] = [
  ['You are the interpreter', 'interpret'],
  ['Pick the demo screen', 'pickNode'],
  ['justify your OWN previous action', 'explainWhy'],
  ['DRIVING a live product demo', 'agentStep'],
  ['answering live, out loud', 'answerAs'],
  ['presenting a LIVE product demo, speaking OUT LOUD', 'narrate'],
  ['live solution discovery during a product demo', 'discover'],
  ['extracting VERIFIABLE, BUSINESS-FACING product knowledge', 'harvestChunks'],
  ['STRICT faithfulness checker', 'verifyFaithful'],
  ["map a real product's SCREENS", 'deriveScreens'],
  ["map a real product's WORKFLOWS", 'deriveWorkflows'],
  ['extract the interactive ELEMENTS of ONE screen', 'deriveScreenElements'],
];
export function detectFn(systemPrompt: string): string {
  for (const [sig, fn] of FN_SIG) if (systemPrompt.includes(sig)) return fn;
  return 'llm';
}

// RC-03 (streaming voice): emit COMPLETED sentences from a growing buffer so TTS can start on sentence 1.
// Returns the new cursor (chars already emitted). `flushAll` (end of stream) emits the trailing remainder
// even without a terminator. Kept dependency-free (core must not import the engine's voice segmenter).
export function flushSentences(buf: string, cursor: number, onText: (s: string) => void, flushAll: boolean): number {
  const region = buf.slice(cursor);
  if (!region) return cursor;
  let upto = region.length;
  if (!flushAll) {
    const SENT = /[.!?…](?:["'”’)\]]+)?(?:\s|$)/g;
    let last = -1, m: RegExpExecArray | null;
    while ((m = SENT.exec(region)) !== null) last = m.index + m[0].length;
    if (last < 0) return cursor; // no complete sentence yet — wait for more
    upto = last;
  }
  const piece = region.slice(0, upto).trim();
  if (piece) onText(piece);
  return cursor + upto;
}

class ClaudeProvider implements LlmProvider {
  readonly id = 'claude';
  private client = new Anthropic();

  constructor() {
    // Capture EVERY LLM call (prompt -> reply) to ai_calls — the "AI Conversation History". Wrap the SDK's
    // create() ONCE so all 12 functions are logged with zero call-site changes (no behavior risk). Best-effort.
    const orig = this.client.messages.create.bind(this.client.messages);
    (this.client.messages as unknown as { create: (a: any) => Promise<any> }).create = async (args: any) => {
      const res = await orig(args);
      void this.logAiCall(args, res);
      return res;
    };
  }

  private async logAiCall(args: any, res: any): Promise<void> {
    try {
      const sys = typeof args?.system === 'string' ? args.system : (args?.system != null ? JSON.stringify(args.system) : '');
      const user = Array.isArray(args?.messages)
        ? args.messages.map((m: any) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content))).join('\n\n')
        : '';
      const block = Array.isArray(res?.content) ? res.content.find((b: any) => b?.type === 'text') : null;
      const reply = block && typeof block.text === 'string' ? block.text : '';
      await db().query(
        `INSERT INTO ai_calls (demo_session_id, fn, model, system_prompt, user_prompt, reply, input_tokens, output_tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [currentSession(), detectFn(sys), args?.model ?? currentModel(), sys, user, reply, res?.usage?.input_tokens ?? null, res?.usage?.output_tokens ?? null],
      );
    } catch { /* best-effort: never break or slow a demo to log a call */ }
  }

  async interpret(utterance: string): Promise<Interpretation> {
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048, // headroom so the JSON object (incl. reasoning) can't truncate
      system: sysInterpret(),
      messages: [{ role: 'user', content: utterance }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              intent: { type: 'string', description: 'concise retrieval query for the knowledge base' },
              kind: { type: 'string', enum: ['question', 'clarification', 'objection', 'curiosity', 'business_objective'] },
              isMetaExplain: { type: 'boolean' },
              isResume: { type: 'boolean' },
              control: { type: 'string', enum: ['pause', 'stop', 'continue', 'none'] },
              reasoning: { type: 'string' },
            },
            required: ['intent', 'kind', 'isMetaExplain', 'isResume', 'control', 'reasoning'],
            additionalProperties: false,
          },
        },
      },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'interpret' });
    if (res.stop_reason === 'refusal') throw new Error('interpret: model refused the utterance');
    const block = res.content.find((b) => b.type === 'text');
    if (!block || !('text' in block)) throw new Error(`interpret: no text block (stop_reason=${res.stop_reason})`);
    let parsed: Partial<Interpretation>;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      throw new Error(`interpret: structured output was not valid JSON: ${block.text.slice(0, 200)}`);
    }
    const kinds: UtteranceKind[] = ['question', 'clarification', 'objection', 'curiosity', 'business_objective'];
    if (typeof parsed.intent !== 'string' || !parsed.kind || !kinds.includes(parsed.kind)) {
      throw new Error(`interpret: invalid interpretation: ${JSON.stringify(parsed)}`);
    }
    const rawControl = (parsed as { control?: string }).control;
    const control = rawControl === 'pause' || rawControl === 'stop' || rawControl === 'continue' ? rawControl : null;
    return {
      intent: parsed.intent,
      kind: parsed.kind,
      isMetaExplain: !!parsed.isMetaExplain,
      isResume: !!parsed.isResume,
      control,
      reasoning: parsed.reasoning ?? '',
    };
  }

  async pickNode(intent: string, labels: string[]): Promise<string> {
    if (labels.length === 0) return ''; // no candidates → nothing fits. (1 candidate still gets a real fit-check
    // so an off-domain request to a single-screen product can correctly resolve to "" rather than force-mapping.)
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: sysPickNode(),
      messages: [{ role: 'user', content: `Intent: ${JSON.stringify(intent)}\nScreens: ${JSON.stringify(labels)}` }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { label: { type: 'string', enum: [...labels, ''] } },
            required: ['label'],
            additionalProperties: false,
          },
        },
      },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'pickNode' });
    const b = res.content.find((x) => x.type === 'text');
    try {
      return JSON.parse(b && 'text' in b ? b.text : '{}').label ?? '';
    } catch {
      return '';
    }
  }

  async explainWhy(ctx: ExplainContext): Promise<string> {
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sysExplainWhy(ctx),
      messages: [
        {
          role: 'user',
          content:
            `Their question: ${ctx.question}\n` +
            `Your prior detected intent: ${ctx.priorIntent}\n` +
            `The answer you gave: ${ctx.answer}\n` +
            `The screen you navigated to: ${ctx.navUrl}\n` +
            `Decision trace:\n${ctx.trace.join('\n')}`,
        },
      ],
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'explain' });
    // Guard like interpret(): never let a refusal / empty response pass through as a
    // confident-sounding justification. Be honest instead of inventing one.
    if (res.stop_reason === 'refusal') return "I'd rather not guess at a justification — I can show you the source again instead.";
    const b = res.content.find((x) => x.type === 'text');
    const text = b && 'text' in b ? b.text.trim() : '';
    return text || "I can't reconstruct why from the trace — let me show you the source again instead.";
  }

  async agentStep(ctx: AgentStepContext): Promise<AgentStep> {
    const done = (say: string): AgentStep => ({ action: 'done', ref: -1, value: '', say });
    const elementList = ctx.elements.map((e) => {
      // RC-08: show the CHOSEN value of a filled field (e.g. filled="FA104 — Fixed Assets") so the model can
      // tell a dropdown is already set, and to what — the fix for re-selecting / looping on a set field.
      const filledFlag = e.filled ? (e.value ? `filled=${JSON.stringify(e.value)}` : 'filled') : (e.kind && /text|select|textarea|email|number|tel|date|password|search/.test(e.kind) ? 'EMPTY' : '');
      const flags = [e.required ? 'REQUIRED' : '', filledFlag].filter(Boolean).join(',');
      const opts = e.options && e.options.length ? ` options=[${e.options.slice(0, 25).map((o) => JSON.stringify(o)).join(', ')}]` : '';
      return `[${e.ref}] ${e.kind ?? e.role ?? 'el'}: ${JSON.stringify(e.text)}${flags ? ` (${flags})` : ''}${opts}`;
    }).join('\n');
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sysAgentStep(ctx),
      messages: [{
        role: 'user',
        content:
          `Goal: ${JSON.stringify(ctx.goal)}\n` +
          // RC-01: session awareness — frame the immediate goal against the pinned journey's business outcome so
          // an otherwise-stateless drive step stays aligned to the demo's purpose. USER message only (no golden change).
          (ctx.sessionGoal ? `This demo is in service of: ${JSON.stringify(ctx.sessionGoal)} — keep actions aligned to it.\n` : '') +
          `Driving as: ${ctx.role}\n` +
          `Current URL: ${ctx.url}\nTitle: ${ctx.title}\n` +
          `Headings: ${JSON.stringify(ctx.headings.slice(0, 12))}\n` +
          `Steps already taken this turn:\n${ctx.history.length ? ctx.history.map((h, i) => `${i + 1}. ${h}`).join('\n') : '(none yet)'}\n\n` +
          (ctx.knownScreens?.length ? `Verified demo-graph screens for this product (the navigation AUTHORITY — when the goal matches one of these, prefer reaching it by its name/route): ${ctx.knownScreens.map((s) => (s.route ? `${s.label} (${s.route})` : s.label)).join(' · ')}\n\n` : '') +
          (ctx.notices?.length ? `Notices on screen now (alerts/validation/toasts — react to these): ${ctx.notices.map((n) => JSON.stringify(n)).join(' · ')}\n\n` : '') +
          `Interactive elements on screen:\n${elementList || '(none detected)'}`,
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'type', 'select', 'done'] },
              ref: { type: 'integer', description: 'element ref for click/type/select; -1 for done' },
              value: { type: 'string', description: 'text to type, or the dropdown option to choose for select; "" otherwise' },
              say: { type: 'string', description: 'one-sentence narration of this step, grounded in the screen' },
            },
            required: ['action', 'ref', 'value', 'say'],
            additionalProperties: false,
          },
        },
      },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'agentStep' });
    if (res.stop_reason === 'refusal') return done("I'd rather not guess my next move here — want to take over?");
    const b = res.content.find((x) => x.type === 'text');
    if (!b || !('text' in b)) return done('I could not read the screen clearly — you can take over and click directly.');
    try {
      const p = JSON.parse(b.text);
      const action = p.action === 'click' || p.action === 'type' || p.action === 'select' ? p.action : 'done';
      return { action, ref: Number.isInteger(p.ref) ? p.ref : -1, value: typeof p.value === 'string' ? p.value : '', say: typeof p.say === 'string' ? p.say : '' };
    } catch {
      return done('I had trouble planning the next step — take over whenever you like.');
    }
  }

  async answerAs(ctx: AnswerContext): Promise<string> {
    const grounded = ctx.band !== 'very_low' && ctx.source?.content; // also gates the SOURCE block in the user content below
    const MODEL = currentModel();
    const userContent =
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
    // RC-04: adaptive thinking keeps the model's REASONING in (omitted) thinking blocks, not in the spoken
    // answer text — we extract only the text block, so the spoken line is the clean final answer rather than
    // a reasoning monologue. max_tokens is thinking+answer headroom; spoken LENGTH is governed by the concision
    // span in the prompt, not by this ceiling.
    const params = {
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' as const },
      system: sysAnswerAs(ctx),
      messages: [{ role: 'user' as const, content: userContent }],
    };
    const REFUSAL = "I'd rather not guess here — let me show you the screen instead.";
    const EMPTY = "Let me show you on the screen rather than guess at the specifics.";
    // RC-03: stream when the caller wants incremental speech (the voice path passes onDelta). Emit each
    // completed sentence as it lands so TTS starts on sentence 1 instead of after the whole reply.
    if (ctx.onDelta) {
      const stream = this.client.messages.stream(params);
      let acc = '', cursor = 0;
      stream.on('text', (delta: string) => { acc += delta; cursor = flushSentences(acc, cursor, ctx.onDelta!, false); });
      const msg = await stream.finalMessage();
      void this.logAiCall(params, msg); // the create()-wrapper doesn't see stream() — log this call explicitly
      await record('llm', MODEL, { input: msg.usage?.input_tokens, output: msg.usage?.output_tokens }, { node: 'answerAs' });
      flushSentences(acc, cursor, ctx.onDelta, true); // speak any trailing partial sentence
      if (msg.stop_reason === 'refusal') return REFUSAL;
      const b = msg.content.find((x) => x.type === 'text');
      const text = b && 'text' in b ? b.text.trim() : '';
      return text || EMPTY;
    }
    const res = await this.client.messages.create(params);
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'answerAs' });
    if (res.stop_reason === 'refusal') return REFUSAL;
    const b = res.content.find((x) => x.type === 'text');
    const text = b && 'text' in b ? b.text.trim() : '';
    return text || EMPTY;
  }

  async narrate(ctx: NarrateContext): Promise<string> {
    const fallback = (ctx.caption?.trim()) || (ctx.screen ? `Here's the ${ctx.screen}.` : 'Let me walk you through this.');
    const MODEL = currentModel();
    // No thinking on narrate: a 1-2 sentence paraphrase must start INSTANTLY (the walk is the primary path) —
    // adaptive thinking would add silence before speech here, and at 160 tokens could even starve the line.
    const params = {
      model: MODEL,
      max_tokens: 160,
      system: sysNarrate(ctx),
      messages: [{
        role: 'user' as const,
        content:
          `Now showing: ${ctx.screen ?? '(a narration moment — no screen change)'}\n` +
          (ctx.caption ? `Beat to convey (paraphrase naturally, do NOT read aloud): ${ctx.caption}\n` : '') +
          // RC-16: the grounded source — paraphrase ONLY this; without it the system span keeps us off specifics.
          (ctx.sourceText ? `Source to paraphrase (the ONLY product facts you may state; do NOT read verbatim): ${ctx.sourceText}\n` : '') +
          (ctx.outcome ? `Outcome this advances: ${ctx.outcome}\n` : '') +
          (ctx.audience ? `In the room: ${ctx.audience}\n` : '') +
          `\nSpeak the one or two sentence narration now.`,
      }],
    };
    try {
      // RC-03: stream the walk narration to TTS sentence-by-sentence so the spoken line starts the moment the
      // first clause lands. Falls back cleanly on any failure (the demo never goes silent on a narration beat).
      if (ctx.onDelta) {
        const stream = this.client.messages.stream(params);
        let acc = '', cursor = 0;
        stream.on('text', (delta: string) => { acc += delta; cursor = flushSentences(acc, cursor, ctx.onDelta!, false); });
        const msg = await stream.finalMessage();
        void this.logAiCall(params, msg); // stream() bypasses the create()-wrapper — log explicitly
        await record('llm', MODEL, { input: msg.usage?.input_tokens, output: msg.usage?.output_tokens }, { node: 'narrate' });
        flushSentences(acc, cursor, ctx.onDelta, true);
        if (msg.stop_reason === 'refusal') return fallback;
        const b = msg.content.find((x) => x.type === 'text');
        const text = b && 'text' in b ? b.text.trim() : '';
        return text || fallback;
      }
      const res = await this.client.messages.create(params);
      await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'narrate' });
      if (res.stop_reason === 'refusal') return fallback;
      const b = res.content.find((x) => x.type === 'text');
      const text = b && 'text' in b ? b.text.trim() : '';
      return text || fallback;
    } catch { return fallback; }
  }

  async discover(ctx: DiscoverContext): Promise<DiscoverResult> {
    const empty: DiscoverResult = { painPoints: [], buyingSignals: [], businessObjective: null, question: '' };
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sysDiscover(ctx),
      messages: [{
        role: 'user',
        content:
          `Utterance: ${JSON.stringify(ctx.utterance)}\n` +
          `Detected kind: ${ctx.kind}\n` +
          `What we just showed them: ${ctx.answer.slice(0, 400)}`,
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              painPoints: { type: 'array', items: { type: 'string' } },
              buyingSignals: { type: 'array', items: { type: 'string' } },
              businessObjective: { type: 'string', description: 'stated business objective, or "" if none' },
              question: { type: 'string' },
            },
            required: ['painPoints', 'buyingSignals', 'businessObjective', 'question'],
            additionalProperties: false,
          },
        },
      },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'discover' });
    const b = res.content.find((x) => x.type === 'text');
    if (res.stop_reason === 'refusal' || !b || !('text' in b)) return empty;
    try {
      const p = JSON.parse(b.text);
      const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);
      const obj = typeof p.businessObjective === 'string' && p.businessObjective.trim() ? p.businessObjective.trim() : null;
      return { painPoints: strs(p.painPoints), buyingSignals: strs(p.buyingSignals), businessObjective: obj, question: typeof p.question === 'string' ? p.question.trim() : '' };
    } catch {
      return empty;
    }
  }

  async harvestChunks(ctx: { product: string; screen: string; capturedText: string }): Promise<string[]> {
    if (!ctx.capturedText || ctx.capturedText.trim().length < 40) return [];
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sysHarvestChunks(),
      messages: [{ role: 'user', content: `Product: ${ctx.product}\nScreen: ${ctx.screen}\n\nCAPTURED SCREEN TEXT (the ONLY source you may use):\n"""\n${ctx.capturedText.slice(0, 6000)}\n"""` }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { chunks: { type: 'array', items: { type: 'string' } } }, required: ['chunks'], additionalProperties: false } } },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'harvestChunks' });
    const b = res.content.find((x) => x.type === 'text');
    if (res.stop_reason === 'refusal' || !b || !('text' in b)) return [];
    try {
      const p = JSON.parse(b.text);
      return Array.isArray(p.chunks) ? p.chunks.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 15).map((c: string) => c.trim()) : [];
    } catch { return []; }
  }

  async verifyFaithful(ctx: { statement: string; source: string }): Promise<boolean> {
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: sysVerifyFaithful(),
      messages: [{ role: 'user', content: `SOURCE:\n"""\n${ctx.source.slice(0, 6000)}\n"""\n\nSTATEMENT:\n"""\n${ctx.statement}\n"""` }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { supported: { type: 'boolean' } }, required: ['supported'], additionalProperties: false } } },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'verifyFaithful' });
    const b = res.content.find((x) => x.type === 'text');
    if (res.stop_reason === 'refusal' || !b || !('text' in b)) return false;
    try { return JSON.parse(b.text).supported === true; } catch { return false; }
  }

  async deriveScreens(ctx: { product: string; knowledge: string }): Promise<DerivedScreen[]> {
    if (!ctx.knowledge || ctx.knowledge.trim().length < 40) return [];
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: sysDeriveScreens(),
      messages: [{ role: 'user', content: `Product: ${ctx.product}\n\nVERIFIED KNOWLEDGE (the ONLY source you may use):\n"""\n${ctx.knowledge.slice(0, 200000)}\n"""` }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { screens: { type: 'array', items: { type: 'object', properties: { intentLabel: { type: 'string' }, screenName: { type: 'string' }, screenType: { type: 'string' }, evidence: { type: 'string' } }, required: ['intentLabel', 'screenName', 'screenType', 'evidence'], additionalProperties: false } } }, required: ['screens'], additionalProperties: false } } },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'deriveScreens' });
    const b = res.content.find((x) => x.type === 'text');
    if (res.stop_reason === 'refusal' || !b || !('text' in b)) return [];
    try {
      const p = JSON.parse(b.text);
      return Array.isArray(p.screens)
        ? p.screens.filter((s: any) => s && typeof s.intentLabel === 'string' && s.intentLabel.trim())
            .map((s: any) => ({ intentLabel: String(s.intentLabel).trim().toLowerCase(), screenName: String(s.screenName ?? s.intentLabel).trim(), screenType: String(s.screenType ?? 'other').trim(), evidence: String(s.evidence ?? '').trim() }))
        : [];
    } catch { return []; }
  }

  async deriveWorkflows(ctx: { product: string; knowledge: string; screens: string[] }): Promise<DerivedWorkflow[]> {
    if (!ctx.screens.length || !ctx.knowledge) return [];
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: sysDeriveWorkflows(),
      messages: [{ role: 'user', content: `Product: ${ctx.product}\nSCREEN LABELS (nodeSequence may use ONLY these): ${JSON.stringify(ctx.screens)}\n\nVERIFIED KNOWLEDGE (the ONLY source you may use):\n"""\n${ctx.knowledge.slice(0, 200000)}\n"""` }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { workflows: { type: 'array', items: { type: 'object', properties: { workflowName: { type: 'string' }, businessPurpose: { type: 'string' }, personaType: { type: 'string' }, stakeholderType: { type: 'string' }, nodeSequence: { type: 'array', items: { type: 'string' } }, successCriteria: { type: 'string' }, evidence: { type: 'string' } }, required: ['workflowName', 'businessPurpose', 'personaType', 'stakeholderType', 'nodeSequence', 'successCriteria', 'evidence'], additionalProperties: false } } }, required: ['workflows'], additionalProperties: false } } },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'deriveWorkflows' });
    const b = res.content.find((x) => x.type === 'text');
    if (res.stop_reason === 'refusal' || !b || !('text' in b)) return [];
    try {
      const p = JSON.parse(b.text);
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
    const MODEL = currentModel();
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: sysDeriveScreenElements(),
      messages: [{ role: 'user', content: `Product: ${ctx.product}\nScreen: ${ctx.screenName} (${ctx.screenType})\n\nEVIDENCE for this screen:\n"""\n${evidence.slice(0, 4000)}\n"""\n\nBROADER VERIFIED KNOWLEDGE (supporting context):\n"""\n${ctx.knowledge.slice(0, 8000)}\n"""` }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { elements: { type: 'array', items: { type: 'object', properties: { elementType: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } }, required: ['elementType', 'label', 'description'], additionalProperties: false } } }, required: ['elements'], additionalProperties: false } } },
    });
    await record('llm', MODEL, { input: res.usage?.input_tokens, output: res.usage?.output_tokens }, { node: 'deriveScreenElements' });
    const b = res.content.find((x) => x.type === 'text');
    if (res.stop_reason === 'refusal' || !b || !('text' in b)) return [];
    const ALLOWED = new Set(['field', 'button', 'action', 'tab', 'error', 'faq', 'note']);
    try {
      const p = JSON.parse(b.text);
      return Array.isArray(p.elements)
        ? p.elements
            .filter((e: any) => e && typeof e.label === 'string' && e.label.trim() && ALLOWED.has(String(e.elementType)))
            .map((e: any) => ({ elementType: String(e.elementType) as DerivedScreenElement['elementType'], label: String(e.label).trim(), description: String(e.description ?? '').trim() }))
        : [];
    } catch { return []; }
  }
}

export function getLlm(): LlmProvider {
  // Provider follows the operator's chosen model (AI Control). Gemini when a gemini-* model is selected,
  // Claude otherwise. Each is constructed per call so a live model switch is picked up on the next turn.
  if (providerForModel(currentModel()) === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set — set it on the engine to use a Gemini model.');
    return new GeminiProvider();
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  return new ClaudeProvider();
}

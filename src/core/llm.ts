/**
 * LLM provider — narrow interface, cloud-only build (Claude, claude-opus-4-8),
 * per plan §4. The walking skeleton's `interpret` step lives here; `narrate`
 * (explain node) lands in increment 3.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';
import { record } from './cost.js';

loadEnv();

const MODEL = 'claude-opus-4-8';

/** Intent-driven, never script-driven (rule §3): classify what the stakeholder is doing. */
export type UtteranceKind = 'question' | 'clarification' | 'objection' | 'curiosity' | 'business_objective';

export interface Interpretation {
  intent: string;        // the information need, as a retrieval query
  kind: UtteranceKind;
  isMetaExplain: boolean; // asking the agent to justify its OWN last action ("why did you show that?")
  isResume: boolean;      // asking to go back to where we were before a detour
  reasoning: string;
}

export interface ExplainContext {
  question: string;
  priorIntent: string;
  answer: string;
  navUrl: string;
  trace: string[];
}

export interface LlmProvider {
  readonly id: string;
  interpret(utterance: string): Promise<Interpretation>;
  /** Pick the best-matching demo target from candidate labels (or '' if none fit). */
  pickNode(intent: string, labels: string[]): Promise<string>;
  /** Explain, grounded in the trace, why the agent showed what it showed. */
  explainWhy(ctx: ExplainContext): Promise<string>;
}

class ClaudeProvider implements LlmProvider {
  readonly id = 'claude';
  private client = new Anthropic();

  async interpret(utterance: string): Promise<Interpretation> {
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048, // headroom so the JSON object (incl. reasoning) can't truncate
      system:
        'You are the interpreter for an autonomous solution consultant running a live product demo. ' +
        'Classify the stakeholder utterance and distill the underlying information need into a concise ' +
        'retrieval query (what to look up in the product knowledge base). Be literal; do not invent scope. ' +
        'Set isMetaExplain=true when the stakeholder asks the agent to justify or explain its OWN last action ' +
        '(e.g. "why did you show me that?", "what was that screen?"). Set isResume=true when they ask to go ' +
        'back to where you were before a detour (e.g. "ok, back to what we were doing", "return to that").',
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
              reasoning: { type: 'string' },
            },
            required: ['intent', 'kind', 'isMetaExplain', 'isResume', 'reasoning'],
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
    return {
      intent: parsed.intent,
      kind: parsed.kind,
      isMetaExplain: !!parsed.isMetaExplain,
      isResume: !!parsed.isResume,
      reasoning: parsed.reasoning ?? '',
    };
  }

  async pickNode(intent: string, labels: string[]): Promise<string> {
    if (labels.length <= 1) return labels[0] ?? '';
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system:
        'Pick the demo screen the stakeholder should be taken to. Prefer the PRIMARY workflow screen where the ' +
        'feature is performed or explained; only choose a sub-view / result list (e.g. a "bypassed", "history", or ' +
        '"completed" list) when the stakeholder EXPLICITLY asks for that sub-view. Return "" if none fit.',
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
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        'You are VIN Demo. The stakeholder is asking you to justify your OWN previous action. Explain, in 2-3 ' +
        'sentences, WHY you showed what you showed — grounded ONLY in the decision trace and the answer you gave. ' +
        'Reference the intent you detected and the screen you navigated to. Do not invent new product facts.',
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
}

export function getLlm(): LlmProvider {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  return new ClaudeProvider();
}

/**
 * LLM provider — narrow interface, cloud-only build (Claude, claude-opus-4-8),
 * per plan §4. The walking skeleton's `interpret` step lives here; `narrate`
 * (explain node) lands in increment 3.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';

loadEnv();

const MODEL = 'claude-opus-4-8';

/** Intent-driven, never script-driven (rule §3): classify what the stakeholder is doing. */
export type UtteranceKind = 'question' | 'clarification' | 'objection' | 'curiosity' | 'business_objective';

export interface Interpretation {
  intent: string;        // the information need, as a retrieval query
  kind: UtteranceKind;
  reasoning: string;
}

export interface LlmProvider {
  readonly id: string;
  interpret(utterance: string): Promise<Interpretation>;
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
        'retrieval query (what to look up in the product knowledge base). Be literal; do not invent scope.',
      messages: [{ role: 'user', content: utterance }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              intent: { type: 'string', description: 'concise retrieval query for the knowledge base' },
              kind: { type: 'string', enum: ['question', 'clarification', 'objection', 'curiosity', 'business_objective'] },
              reasoning: { type: 'string' },
            },
            required: ['intent', 'kind', 'reasoning'],
            additionalProperties: false,
          },
        },
      },
    });
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
    return { intent: parsed.intent, kind: parsed.kind, reasoning: parsed.reasoning ?? '' };
  }
}

export function getLlm(): LlmProvider {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  return new ClaudeProvider();
}

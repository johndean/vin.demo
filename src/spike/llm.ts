/**
 * LLM seam for the spike — Claude (claude-opus-4-8) via the official SDK.
 *
 *  - parseIntent: maps a stakeholder's free-text question to a knowledge topic
 *    (structured output, so we get a validated topic key back).
 *  - narrate: turns a retrieved knowledge chunk into what VIN Demo says out loud,
 *    grounded in the chunk and required to cite source/confidence/version.
 *
 * If ANTHROPIC_API_KEY is absent, both fall back to deterministic behaviour so
 * `npm run demo` still runs without a key.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';

loadEnv();

const MODEL = 'claude-opus-4-8';
export const hasLLM = !!process.env.ANTHROPIC_API_KEY;
const client = hasLLM ? new Anthropic() : null;

export interface KnowledgeChunk {
  answer: string;
  confidence: number;
  source: string;
  last_verified: string;
  product_version: string;
  validation_status: string;
}

/** Map the question to one of `topics`, or null if out of scope. */
export async function parseIntent(question: string, topics: string[]): Promise<{ topic: string | null; reasoning: string }> {
  if (!client) {
    // Fallback: naive keyword overlap.
    const q = question.toLowerCase();
    const hit = topics.find((t) => t.split(' ').some((w) => q.includes(w)));
    return { topic: hit ?? null, reasoning: 'keyword fallback (no LLM key)' };
  }
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      'You route a stakeholder question to the single best-matching knowledge topic for a live product demo. ' +
      'Return null for `topic` only if none plausibly apply.',
    messages: [{ role: 'user', content: `Question: ${JSON.stringify(question)}\nTopics: ${JSON.stringify(topics)}` }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            topic: { type: 'string', enum: [...topics, 'none'], description: '"none" if no topic applies' },
            reasoning: { type: 'string' },
          },
          required: ['topic', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
  });
  const text = res.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(text && 'text' in text ? text.text : '{"topic":"none","reasoning":"no output"}');
  return { topic: parsed.topic === 'none' ? null : parsed.topic, reasoning: parsed.reasoning };
}

/** What VIN Demo says to the stakeholder, grounded in the retrieved chunk. */
export async function narrate(question: string, k: KnowledgeChunk, persona: string): Promise<string> {
  const citation = `(source: ${k.source} · confidence: ${k.confidence} · version: ${k.product_version} · ${k.validation_status})`;
  if (!client) {
    return `${k.answer}\n   ↳ ${citation}`;
  }
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      'You are VIN Demo, an autonomous solution consultant giving a live, read-only product demo. ' +
      `You are presenting to a ${persona}. Answer the question using ONLY the provided knowledge — never invent ` +
      'capabilities. Be concise (2-4 sentences), concrete, and end by citing your source, confidence, and product ' +
      'version verbatim so the stakeholder can trust it.',
    messages: [
      { role: 'user', content: `Stakeholder question: ${question}\n\nKnowledge: ${JSON.stringify(k)}\n\nCitation to append: ${citation}` },
    ],
  });
  const text = res.content.find((b) => b.type === 'text');
  return text && 'text' in text ? text.text : `${k.answer}\n   ↳ ${citation}`;
}

/**
 * Embedding provider — narrow interface, build Voyage now, leave Gemini/Vertex
 * as registered swaps (design interfaces broadly, build narrowly — plan §4).
 * Provider is chosen by EMBEDDING_PROVIDER (default "voyage"); each provider
 * declares its vector dimension, which must match the knowledge_chunks column.
 */
import { VoyageAIClient } from 'voyageai';
import { config as loadEnv } from 'dotenv';
import { record } from './cost.js';

loadEnv();

export interface EmbeddingProvider {
  readonly id: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

class VoyageProvider implements EmbeddingProvider {
  readonly id = 'voyage';
  readonly dim = 1024; // voyage-3
  private client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY ?? '' });
  async embed(texts: string[]): Promise<number[][]> {
    // Paid tier (account has billing) lifts the free 3 RPM cap — transient 429s under burst clear fast,
    // so retry with SHORT backoff (was 21s/42s, tuned for the free tier's per-minute window).
    const delays = [1_500, 4_000, 8_000];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.client.embed({ input: texts, model: 'voyage-3' });
        const u: any = (res as any).usage ?? {};
        await record('embeddings', 'voyage-3', { total: u.totalTokens ?? u.total_tokens });
        const vecs = (res.data ?? []).map((d) => d.embedding as number[]);
        for (const v of vecs) {
          if (v.length !== this.dim) {
            throw new Error(`Embedding dim mismatch: provider returned ${v.length}, schema column is ${this.dim}. Run a dim migration before switching providers.`);
          }
        }
        return vecs;
      } catch (e: any) {
        if (e?.statusCode === 429 && attempt < delays.length) {
          console.error(`  (transient Voyage rate-limit; retrying in ${delays[attempt] / 1000}s)`);
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        throw e;
      }
    }
  }
}

/** Placeholder swaps — same interface, wire when a key/use-case lands. */
class NotConfiguredProvider implements EmbeddingProvider {
  constructor(readonly id: string, readonly dim: number) {}
  async embed(): Promise<number[][]> {
    throw new Error(`Embedding provider "${this.id}" is registered but not yet implemented — using Voyage by default.`);
  }
}

const REGISTRY: Record<string, () => EmbeddingProvider> = {
  voyage: () => new VoyageProvider(),
  gemini: () => new NotConfiguredProvider('gemini', 768), // text-embedding-004
  vertex: () => new NotConfiguredProvider('vertex', 768), // text-embedding-005
};

export function getEmbeddingProvider(): EmbeddingProvider {
  const id = (process.env.EMBEDDING_PROVIDER ?? 'voyage').toLowerCase();
  const make = REGISTRY[id];
  if (!make) throw new Error(`Unknown EMBEDDING_PROVIDER "${id}". Options: ${Object.keys(REGISTRY).join(', ')}`);
  return make();
}

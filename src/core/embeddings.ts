/**
 * Embedding provider — narrow interface, build Voyage now, leave Gemini/Vertex
 * as registered swaps (design interfaces broadly, build narrowly — plan §4).
 * Provider is chosen by EMBEDDING_PROVIDER (default "voyage"); each provider
 * declares its vector dimension, which must match the knowledge_chunks column.
 */
import { VoyageAIClient } from 'voyageai';
import { config as loadEnv } from 'dotenv';

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
    // Free tier is 3 RPM without a payment method — retry 429s with backoff.
    const delays = [21_000, 42_000];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.client.embed({ input: texts, model: 'voyage-3' });
        return (res.data ?? []).map((d) => d.embedding as number[]);
      } catch (e: any) {
        if (e?.statusCode === 429 && attempt < delays.length) {
          console.error(`  (Voyage rate-limited; retrying in ${delays[attempt] / 1000}s — add a payment method to lift the 3 RPM free limit)`);
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

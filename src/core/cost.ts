/**
 * Per-demo cost events (Gap J) — every LLM / embedding / navigation call emits a
 * cost_events row tagged to the active demo session, so per-demo and per-customer
 * unit cost is queryable from day one.
 *
 * The "active session" is a module global set per run (fine for the CLI walking
 * skeleton). A server should scope this via AsyncLocalStorage / request context.
 */
import { db } from './db.js';

export type CostType = 'llm' | 'embeddings' | 'storage' | 'compute' | 'navigation';

// Approximate USD per token. LLM from the model card; embeddings ~ voyage-3 list.
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 5 / 1e6, out: 25 / 1e6 },
  'voyage-3': { in: 0.06 / 1e6, out: 0 },
};

let activeSession: string | null = null;
export function beginCostSession(id: string | null): void {
  activeSession = id;
}

export async function record(
  type: CostType,
  model: string,
  usage: { input?: number; output?: number; total?: number },
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (!activeSession) return;
  const p = PRICES[model] ?? { in: 0, out: 0 };
  const inputT = usage.input ?? usage.total ?? 0;
  const outputT = usage.output ?? 0;
  const amount = inputT * p.in + outputT * p.out;
  await db()
    .query(
      `INSERT INTO cost_events (demo_session_id, type, tokens, amount_usd, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [activeSession, type, inputT + outputT, amount, JSON.stringify({ model, ...meta })],
    )
    .catch((e) => console.error('  (cost record failed:', e.message, ')'));
}

export interface CostSummary {
  totalUsd: number;
  totalTokens: number;
  byType: { type: string; tokens: number; usd: number }[];
}

export async function sessionCost(id: string): Promise<CostSummary> {
  const { rows } = await db().query<{ type: string; tokens: string; usd: string }>(
    `SELECT type, COALESCE(SUM(tokens),0)::text AS tokens, COALESCE(SUM(amount_usd),0)::text AS usd
       FROM cost_events WHERE demo_session_id = $1 GROUP BY type ORDER BY type`,
    [id],
  );
  const byType = rows.map((r) => ({ type: r.type, tokens: Number(r.tokens), usd: Number(r.usd) }));
  return {
    totalUsd: byType.reduce((a, b) => a + b.usd, 0),
    totalTokens: byType.reduce((a, b) => a + b.tokens, 0),
    byType,
  };
}

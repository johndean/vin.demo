/**
 * Per-demo cost events (Gap J) — every LLM / embedding / navigation call emits a
 * cost_events row tagged to the active demo session, so per-demo and per-customer
 * unit cost is queryable from day one.
 *
 * The "active session" is a module global set per run (fine for the CLI walking
 * skeleton). A server should scope this via AsyncLocalStorage / request context.
 */
import { db } from './db.js';

export type CostType = 'llm' | 'embeddings' | 'navigation' | 'stt' | 'tts';

// Approximate USD per token. LLM from the model card; embeddings ~ voyage-3 list.
// List prices, USD per token (per-M figures in comments). Verify periodically; an unknown model bills 0 (see below).
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-fable-5': { in: 10 / 1e6, out: 50 / 1e6 },   // GA 2026-06-09 — $10/$50 per M tokens
  'claude-opus-4-8': { in: 5 / 1e6, out: 25 / 1e6 },   // $5/$25 per M
  'claude-sonnet-4-6': { in: 3 / 1e6, out: 15 / 1e6 }, // $3/$15 per M
  'claude-haiku-4-5-20251001': { in: 1 / 1e6, out: 5 / 1e6 }, // $1/$5 per M
  'gemini-2.5-pro': { in: 1.25 / 1e6, out: 10 / 1e6 }, // Google — $1.25/$10 per M (≤200k tier); thinking tokens bill as output
  'gemini-2.5-flash': { in: 0.3 / 1e6, out: 2.5 / 1e6 }, // Google — $0.30/$2.50 per M
  'voyage-3': { in: 0.06 / 1e6, out: 0 },
};

let activeSession: string | null = null;
export function beginCostSession(id: string | null): void {
  activeSession = id;
}
/** The session LLM/cost events are currently attributed to (used to tag ai_calls). null outside a session. */
export function currentSession(): string | null {
  return activeSession;
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

// Voice list prices: Google STT v2 ≈ $0.016/min; TTS (Neural2/WaveNet) ≈ $16 / 1M chars. Same posture as
// the token rates above — public list prices × REAL metered units (STT audio seconds, TTS characters).
const VOICE_RATES = { sttPerSec: 0.016 / 60, ttsPerChar: 16 / 1e6 };

/** Record a VOICE cost event: STT billed by audio SECONDS, TTS by CHARACTERS (the units those vendors
 *  bill). Mirrors record() — real metered units × list price, tagged to the active session. */
export async function recordVoice(kind: 'stt' | 'tts', units: number, meta: Record<string, unknown> = {}): Promise<void> {
  if (!activeSession || !(units > 0)) return;
  const amount = kind === 'stt' ? units * VOICE_RATES.sttPerSec : units * VOICE_RATES.ttsPerChar;
  await db()
    .query(
      `INSERT INTO cost_events (demo_session_id, type, tokens, amount_usd, meta) VALUES ($1, $2, $3, $4, $5)`,
      [activeSession, kind, Math.round(units), amount, JSON.stringify({ unit: kind === 'stt' ? 'seconds' : 'chars', ...meta })],
    )
    .catch((e) => console.error('  (voice cost record failed:', e.message, ')'));
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

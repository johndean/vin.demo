/**
 * Runtime AI settings — the model the demo brain runs on, switchable LIVE from the web console (no redeploy).
 *
 * WHY: the model used to be ONLY the engine env var ANTHROPIC_MODEL — changing it meant a Railway redeploy.
 * Now the choice is persisted in app_settings (migration 0028) and cached in-process; the engine reloads the
 * cache at boot and after every change, so a switch takes effect on the next turn. The env var still SEEDS the
 * default, and the known-good claude-opus-4-8 is the fallback so a missing/invalid setting can never strand us.
 *
 * Models span two providers: Claude (Anthropic) and Gemini (Google, llm-gemini.ts). getLlm() selects the
 * provider from the chosen model's `provider` (see providerForModel). Gemini options require GEMINI_API_KEY on
 * the engine; an option marked available:false renders as "Coming soon" and setModel() rejects it.
 */
import { db } from './db.js';

export interface ModelOption { id: string; provider: 'claude' | 'gemini'; label: string; note: string; available: boolean }

// The switcher's catalog. `available:false` would render an option as not-yet-selectable (Gemini, once added).
export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'claude-opus-4-8', provider: 'claude', label: 'Claude Opus 4.8', note: 'Default — most capable; the known-good demo brain.', available: true },
  { id: 'claude-sonnet-4-6', provider: 'claude', label: 'Claude Sonnet 4.6', note: 'Faster and cheaper; strong for most demos.', available: true },
  { id: 'claude-haiku-4-5-20251001', provider: 'claude', label: 'Claude Haiku 4.5', note: 'Fastest and cheapest; lightest reasoning.', available: true },
  { id: 'claude-fable-5', provider: 'claude', label: 'Claude Fable 5', note: 'On hold — needs the Anthropic account terms accepted before it stops erroring; flip available:true once verified live.', available: false },
  { id: 'gemini-2.5-pro', provider: 'gemini', label: 'Gemini 2.5 Pro', note: 'Google — large context, strong reasoning (thinking on). Requires GEMINI_API_KEY on the engine.', available: true },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', note: 'Google — fast + low-cost (thinking off for snappy demos). Requires GEMINI_API_KEY on the engine.', available: true },
];

/** Which provider serves a given model id (drives getLlm() provider selection). Defaults to claude. */
export function providerForModel(id: string): 'claude' | 'gemini' {
  return MODEL_OPTIONS.find((m) => m.id === id)?.provider ?? 'claude';
}

const VALID = new Set(MODEL_OPTIONS.filter((m) => m.available).map((m) => m.id));
// Validate the env SEED too (not just the DB override): a typo'd/retired ANTHROPIC_MODEL must degrade to the
// known-good Opus, never strand every LLM call with an invalid id. (The `||` alone only guarded falsy.)
const ENV_MODEL = process.env.ANTHROPIC_MODEL;
const DEFAULT_MODEL = ENV_MODEL && VALID.has(ENV_MODEL) ? ENV_MODEL : 'claude-opus-4-8';
if (ENV_MODEL && !VALID.has(ENV_MODEL)) console.warn(`[settings] ANTHROPIC_MODEL="${ENV_MODEL}" is not a known model — falling back to ${DEFAULT_MODEL}.`);

// In-process cache. null ⇒ no override set ⇒ use DEFAULT_MODEL. Loaded at boot + after each setModel().
let cachedModel: string | null = null;

/** The model id to send to the SDK right now (override if set + valid, else the env/known-good default). */
export function currentModel(): string { return cachedModel && VALID.has(cachedModel) ? cachedModel : DEFAULT_MODEL; }
export function modelSource(): 'override' | 'default' { return cachedModel && VALID.has(cachedModel) ? 'override' : 'default'; }

// The FAST tier for INTERNAL routing calls only — interpret + pickNode (classify the utterance / "which screen?").
// Experience audit #5: those were serial Opus round-trips that gated time-to-first-word; routing this plumbing to
// Haiku removes them from the slow path WITHOUT downgrading the SPOKEN brain (answerAs/narrate/agentStep/explainWhy
// stay on currentModel()). Claude-tier by design (used inside ClaudeProvider); env FAST_MODEL overrides, falling
// back to Haiku unless the override is a known, available Claude model. Could become AI-Control-switchable later.
const FAST_ENV = process.env.FAST_MODEL;
const FAST_DEFAULT = FAST_ENV && VALID.has(FAST_ENV) && providerForModel(FAST_ENV) === 'claude' ? FAST_ENV : 'claude-haiku-4-5-20251001';
export function fastModel(): string { return FAST_DEFAULT; }

/** Load the persisted model setting into the cache (best-effort — never fail a demo over a settings read). */
export async function loadSettings(): Promise<void> {
  try {
    const row = (await db().query<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'ai_model'`)).rows[0];
    cachedModel = row?.value ?? null;
  } catch { /* keep current cache */ }
}

/** Persist the chosen model (upsert) + refresh the cache so it applies live. Rejects unknown ids (injection-safe). */
export async function setModel(modelId: string, actor: string): Promise<void> {
  if (!VALID.has(modelId)) throw new Error(`unknown or unavailable model: ${modelId}`);
  await db().query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('ai_model',$1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [modelId, actor],
  );
  cachedModel = modelId;
}

/** Clear the model override (restore the env/known-good default) + refresh the cache — the symmetric "reset". */
export async function clearModel(): Promise<void> {
  await db().query(`DELETE FROM app_settings WHERE key = 'ai_model'`);
  cachedModel = null;
}

/** The editor payload: the active model, where it comes from, the catalog, and which id IS the default. */
export function modelCatalog(): { current: string; source: 'override' | 'default'; defaultId: string; options: ModelOption[] } {
  return { current: currentModel(), source: modelSource(), defaultId: DEFAULT_MODEL, options: MODEL_OPTIONS };
}

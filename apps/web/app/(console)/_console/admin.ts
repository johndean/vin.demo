/* Client helper for the table-driven admin CRUD endpoint. Throws on failure with the server's
   message so forms can surface it. Callers refresh the server data (router.refresh()) after a write. */
export async function adminMutate(entity: string, op: 'create' | 'update' | 'archive' | 'unarchive', payload: { id?: string; data?: any }) {
  const res = await fetch('/api/console/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entity, op, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

/* Knowledge mutations (Phase C) — RBAC-proxied to the engine (which embeds + writes + audits).
   add/edit re-embed; validate/archive are metadata + audit. Callers router.refresh() after a write. */
export async function knowledgeMutate(action: 'add' | 'edit' | 'validate' | 'archive', payload: Record<string, unknown>) {
  const res = await fetch('/api/console/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

/* Demo-graph actions (Phase E) — RBAC-proxied to the engine (which holds the LLM + Playwright). autogen
   derives a DRAFT graph from validated knowledge; verify recon-validates the active graph (drift);
   publish promotes a draft; archive soft-archives. autogen/verify are long (LLM + a real browser drive),
   so callers show a spinner. Callers router.refresh() after a write. */
export async function graphMutate(
  action: 'autogen' | 'verify' | 'publish' | 'archive' | 'workflow.create' | 'workflow.update' | 'workflow.approve' | 'workflow.archive' | 'node.create' | 'node.update' | 'node.archive' | 'rollback' | 'tour.link',
  payload: Record<string, unknown>,
) {
  const res = await fetch('/api/console/graph', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

/* Experience registry actions (V5 Guided Experience Platform, Phase 1) — RBAC-proxied to the engine (pure-DB
   writes). Business Outcome Registry (outcome.*) + the buying-committee Stakeholder Registry (stakeholder.*) +
   the influence graph (relationship.*). Fast (no LLM/browser). Callers router.refresh() after a write. */
export async function experienceMutate(
  action: 'outcome.create' | 'outcome.update' | 'outcome.archive' | 'outcome.link' | 'stakeholder.create' | 'stakeholder.update' | 'stakeholder.archive' | 'relationship.create' | 'relationship.archive' | 'journey.create' | 'journey.update' | 'journey.status' | 'journey.archive' | 'orgPerson.create' | 'orgPerson.update' | 'orgPerson.archive' | 'journey.assemble' | 'gap.resolve' | 'gap.dismiss',
  payload: Record<string, unknown>,
) {
  const res = await fetch('/api/console/experience', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

/* AI Control (migrations 0027 + 0028) — RBAC-proxied to the engine. aiConfigGet() loads the editor catalog
   (default + override per prompt, current model + options); aiConfigMutate() saves/resets a prompt override or
   switches the model — each applies LIVE on the engine's next turn (no redeploy). Returns the refreshed catalog. */
export async function aiConfigGet() {
  const res = await fetch('/api/console/ai-config', { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as { prompts: AiPromptRow[]; model: AiModelInfo };
}
export async function aiConfigMutate(action: 'prompt.save' | 'prompt.reset' | 'model.set' | 'model.reset', payload: Record<string, unknown>) {
  const res = await fetch('/api/console/ai-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as { ok: true; prompts: AiPromptRow[]; model: AiModelInfo };
}
export interface AiPromptRow { key: string; fn: string; group: string; title: string; help: string; default: string; override: string | null; effective: string; overridden: boolean }
export interface AiModelOption { id: string; provider: 'claude' | 'gemini'; label: string; note: string; available: boolean }
export interface AiModelInfo { current: string; source: 'override' | 'default'; defaultId: string; options: AiModelOption[] }

/* Run an eval suite server-side (RBAC-proxied to the engine, which spawns the real eval script and records
   eval_runs). A suite hits the LLM and can take minutes — callers show a spinner + router.refresh() after. */
export async function runEval(suite: string, product?: string) {
  const res = await fetch('/api/console/evals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ suite, ...(product ? { product } : {}) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

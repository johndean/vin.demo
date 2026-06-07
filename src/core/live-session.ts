/**
 * Live demo session loop — the REAL LangGraph brain (read-only) streaming structured events
 * (+ real product screenshots) through an `emit` callback. The per-turn work is `runTurn`, reused by:
 *   • the canned REEL (`runLiveSession`, 3 fixed questions) — repeatable demo,
 *   • the INTERACTIVE session (apps/engine/src/interactive-session.ts) — live typed/spoken questions,
 *   • the CLI guard at the bottom (local QA / desktop dev fallback) → NDJSON on stdout.
 * The brain is identical across all three; only the SOURCE of utterances differs. CAPTURE_SHOTS is
 * forced on so the graph writes tmp/live/last.png on each navigation, which `shot()` reads as base64.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { buildGraph } from './graph.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';
import type { ExecutionMode } from './safety.js';

export type Emit = (ev: Record<string, unknown>) => void;

export interface SessionCtx {
  productId: string;
  role: string;
  mode: ExecutionMode;
  sessionId: string;
  graph: ReturnType<typeof buildGraph>;
  thread: { configurable: { thread_id: string } };
}

export const LOOP = ['Intent', 'Retrieve', 'Navigate', 'Demonstrate', 'Explain', 'Follow-up', 'Return'];

async function shot(): Promise<string | null> {
  try { return 'data:image/png;base64,' + (await readFile('tmp/live/last.png')).toString('base64'); }
  catch { return null; }
}

/** Boot a real demo session: env → product/role/mode, create the session row, build the graph + thread. */
export async function bootSession(threadPrefix = 'live'): Promise<SessionCtx | null> {
  process.env.CAPTURE_SHOTS = '1'; // graph writes tmp/live/last.png on each navigation
  await mkdir('tmp/live', { recursive: true }).catch(() => {});

  const productId = process.env.PO_VIN_PRODUCT_ID ?? null;
  if (!productId) return null;
  const role = process.env.PO_VIN_ROLE ?? 'admin';
  const mode: ExecutionMode = 'read-only';

  const session = await createDemoSession(productId, mode);
  beginCostSession(session.id);
  const graph = buildGraph();
  const thread = { configurable: { thread_id: `${threadPrefix}-${session.id}` } };
  return { productId, role, mode, sessionId: session.id, graph, thread };
}

/** Run ONE turn through the brain and emit its events. Same logic whether the utterance came from the
 *  reel, a typed message, or speech — that's how voice/text stay a thin channel over one brain. */
export async function runTurn(ctx: SessionCtx, turn: { speaker: string; text: string; loop?: number }, emit: Emit): Promise<void> {
  emit({ type: 'message', side: 'them', who: turn.speaker, role: turn.speaker, text: turn.text, tag: 'question' });
  emit({ type: 'beat', loopIdx: 0, phase: 'Understand intent', brain: `Parsing the question and planning the demo.`, sub: 'interpret' });

  let out: any;
  try {
    out = await ctx.graph.invoke({ utterance: turn.text, speaker: turn.speaker, productId: ctx.productId, sessionId: ctx.sessionId, role: ctx.role, mode: ctx.mode }, ctx.thread);
  } catch (e: any) {
    emit({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: `(engine error: ${e?.message ?? e})`, uncertain: true });
    return;
  }

  const top = out.retrieved?.[0];
  emit({
    type: 'beat',
    loopIdx: turn.loop ?? (out.interpretation?.isMetaExplain ? 4 : out.gated ? 2 : 3),
    phase: out.interpretation?.isMetaExplain ? 'Explain' : out.gated ? 'Confidence gate' : 'Retrieve · Navigate',
    brain: (out.trace ?? []).slice(-1)[0] ?? 'Running the loop.',
    sub: out.interpretation?.intent ?? '',
    conf: top?.confidence ?? null,
  });

  if (top && !out.gated) {
    emit({ type: 'cite', k: { title: String(top.content).slice(0, 64), content: top.content, source: top.source, conf: top.confidence, ver: String(top.product_version ?? '').replace(/^v/i, ''), status: top.validation_status, verified: top.last_verified, type: top.category ?? 'docs' } });
  }
  if (out.navigation?.url) {
    emit({ type: 'nav', url: out.navigation.url, healedVia: out.navigation.healedVia ?? null, screenshot: await shot() });
  }
  if (out.blockedMutations?.length) emit({ type: 'blocked', actions: out.blockedMutations });

  if (out.explanation) emit({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: out.explanation, uncertain: !!out.gated });
  else if (out.gated) emit({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: "I'm not certain about that — let me show you the source rather than guess.", uncertain: true });
  else if (top) emit({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: String(top.content) });

  if (out.discoveryPrompt) emit({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: out.discoveryPrompt, tag: 'discovery' });

  const c = await sessionCost(ctx.sessionId);
  emit({ type: 'cost', total: c.totalUsd, byType: c.byType });
}

const REEL = [
  { speaker: 'Procurement', text: 'How does approval delegation work?', loop: 3 },
  { speaker: 'CFO', text: 'Our approvals stall when I travel — show me the bypassed / delegated approvals.', loop: 3 },
  { speaker: 'Procurement', text: 'Why did you show me that screen?', loop: 4 },
];

/**
 * The REEL: a repeatable canned run of the 3-question approval-delegation scenario through the real
 * brain. Resolves when complete; never calls process.exit (the hosted engine is long-lived).
 */
export async function runLiveSession(emit: Emit): Promise<void> {
  const ctx = await bootSession('live');
  if (!ctx) { emit({ type: 'error', message: 'PO_VIN_PRODUCT_ID not set — run `npm run seed`.' }); return; }

  emit({ type: 'start', product: 'po.vin', scenario: 'Approval delegation', mode: ctx.mode, loop: LOOP, sessionId: ctx.sessionId });
  for (const turn of REEL) await runTurn(ctx, turn, emit);
  emit({ type: 'beat', loopIdx: 6, phase: 'Demo complete', brain: 'Scenario complete — never fired a mutating action; cost recorded to the session.', sub: 'done' });
  emit({ type: 'done' });
}

// CLI entry — local QA and the desktop's dev-only local fallback. Writes NDJSON to stdout, then
// exits. Skipped when this module is imported (e.g. by the hosted engine), so the server stays up.
if (process.argv[1] && /live-session\.(ts|js)$/.test(process.argv[1])) {
  runLiveSession((ev) => process.stdout.write(JSON.stringify(ev) + '\n'))
    .then(() => process.exit(0))
    .catch((e) => { process.stdout.write(JSON.stringify({ type: 'error', message: String(e?.message ?? e) }) + '\n'); process.exit(1); });
}

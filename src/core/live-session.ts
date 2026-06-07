/**
 * Live demo session SERVICE (Phase 4) — runs the REAL LangGraph loop on po.vin (read-only)
 * and streams structured NDJSON events (+ real product screenshots) to stdout for the
 * control room to render. The Electron main process spawns this and forwards each line over
 * IPC. This is the clean seam the scripted BEATS stood in for.
 *   Run: tsx src/core/live-session.ts   (CAPTURE_SHOTS is forced on so the graph writes shots)
 */
import { readFile, mkdir } from 'node:fs/promises';
import { buildGraph } from './graph.js';
import { createDemoSession } from './session.js';
import { beginCostSession, sessionCost } from './cost.js';
import type { ExecutionMode } from './safety.js';

process.env.CAPTURE_SHOTS = '1'; // graph writes tmp/live/last.png on each navigation
await mkdir('tmp/live', { recursive: true }).catch(() => {});

const emit = (ev: Record<string, unknown>) => process.stdout.write(JSON.stringify(ev) + '\n');
async function shot(): Promise<string | null> {
  try { return 'data:image/png;base64,' + (await readFile('tmp/live/last.png')).toString('base64'); }
  catch { return null; }
}

const productId = process.env.PO_VIN_PRODUCT_ID ?? null;
const role = process.env.PO_VIN_ROLE ?? 'admin';
const mode: ExecutionMode = 'read-only';

if (!productId) { emit({ type: 'error', message: 'PO_VIN_PRODUCT_ID not set — run `npm run seed`.' }); process.exit(1); }

const LOOP = ['Intent', 'Retrieve', 'Navigate', 'Demonstrate', 'Explain', 'Follow-up', 'Return'];
const turns = [
  { speaker: 'Procurement', text: 'How does approval delegation work?', loop: 3 },
  { speaker: 'CFO', text: 'Our approvals stall when I travel — show me the bypassed / delegated approvals.', loop: 3 },
  { speaker: 'Procurement', text: 'Why did you show me that screen?', loop: 4 },
];

const session = await createDemoSession(productId, mode);
beginCostSession(session.id);
const graph = buildGraph();
const thread = { configurable: { thread_id: `live-${session.id}` } };

emit({ type: 'start', product: 'po.vin', scenario: 'Approval delegation', mode, loop: LOOP, sessionId: session.id });

for (const turn of turns) {
  emit({ type: 'message', side: 'them', who: turn.speaker, role: turn.speaker, text: turn.text, tag: 'question' });
  emit({ type: 'beat', loopIdx: 0, phase: 'Understand intent', brain: `Parsing the question and planning the demo.`, sub: 'interpret' });

  let out: any;
  try {
    out = await graph.invoke({ utterance: turn.text, speaker: turn.speaker, productId, sessionId: session.id, role, mode }, thread);
  } catch (e: any) {
    emit({ type: 'message', side: 'ai', who: 'Consultant', role: 'VIN Demo', text: `(engine error: ${e?.message ?? e})`, uncertain: true });
    continue;
  }

  const top = out.retrieved?.[0];
  emit({
    type: 'beat',
    loopIdx: turn.loop,
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

  const c = await sessionCost(session.id);
  emit({ type: 'cost', total: c.totalUsd, byType: c.byType });
}

emit({ type: 'beat', loopIdx: 6, phase: 'Demo complete', brain: 'Scenario complete — never fired a mutating action; cost recorded to the session.', sub: 'done' });
emit({ type: 'done' });
process.exit(0);

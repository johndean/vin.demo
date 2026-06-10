/**
 * Scripted session — the GUIDED/DETERMINISTIC demo runner. Given an approved WORKFLOW, it logs into the
 * real product ONCE, then walks the workflow's screens in FIXED ORDER, screenshotting each and streaming
 * (screen + your authored caption + screenshot) to the viewer, advancing on a client "next" command.
 *
 * There is NO LLM in this loop — no intent recognition, retrieval, or answer generation. That makes it the
 * reliable, "click-to-present" path while the autonomous brain (interactive/voice) matures. It reuses the
 * SAME adapter + navigation primitive (driver.gotoNode) and the SAME SSE event shapes the console already
 * renders. Per-step RESILIENCE: if a selector breaks (or the screen isn't on the verified map), it still
 * shows the current page + caption and lets the presenter continue — a broken step never kills the demo.
 */
import { readFile } from 'node:fs/promises';
import { bootSession, type Emit, type SessionTarget } from '../../../src/core/live-session.js';
import { getAdapter, type DemoNode, type InteractionAdapter } from '../../../src/core/driver.js';
import { db } from '../../../src/core/db.js';

export interface ScriptedSession {
  total: number;
  goto(index: number): Promise<void>;
  advance(): Promise<void>;
  back(): Promise<void>;
  close(): Promise<void>;
}

interface Step { label: string; caption: string; node: DemoNode | null; status: string }

async function snap(adapter: InteractionAdapter): Promise<string | null> {
  try {
    if (typeof adapter.screenshot !== 'function') return null;
    await adapter.screenshot('tmp/live/scripted.png', false);
    return 'data:image/png;base64,' + (await readFile('tmp/live/scripted.png')).toString('base64');
  } catch { return null; }
}

/** Open a scripted session for a workflow. Streams `start` (with the step overview), then drives step 0;
 *  the client advances via the returned session. Returns null (after emitting an error) if the workflow or
 *  its product can't be resolved — the caller closes the stream. */
export async function startScripted(emit: Emit, workflowId: string, target: SessionTarget = {}): Promise<ScriptedSession | null> {
  if (!workflowId) { emit({ type: 'error', message: 'No workflow selected.' }); return null; }
  const wf = (await db().query<{ name: string; node_sequence: any; step_script: any; product_id: string }>(`
    SELECT w.workflow_name AS name, w.node_sequence, w.step_script, g.product_id
      FROM demo_graph_workflows w JOIN demo_graphs g ON g.id = w.demo_graph_id
     WHERE w.id = $1 AND w.archived_at IS NULL`, [workflowId])).rows[0];
  if (!wf) { emit({ type: 'error', message: 'Workflow not found.' }); return null; }

  const labels: string[] = (Array.isArray(wf.node_sequence) ? wf.node_sequence : []).map((s: any) => String(s));
  if (!labels.length) { emit({ type: 'error', message: 'This workflow has no screens yet — add some in the Workflow Builder.' }); return null; }
  const captions: Record<string, string> = (wf.step_script && typeof wf.step_script === 'object') ? wf.step_script : {};

  // The active graph's nodes carry the real locators the runner navigates with.
  const nodeRows = (await db().query<{ intent_label: string; screen_route: string | null; locator_strategies: any; persona_labels: any; verification_status: string }>(`
    SELECT n.intent_label, n.screen_route, n.locator_strategies, n.persona_labels, n.verification_status
      FROM demo_graph_nodes n JOIN demo_graphs g ON g.id = n.demo_graph_id
     WHERE g.product_id = $1 AND g.status = 'active' AND g.archived_at IS NULL`, [wf.product_id])).rows;
  const byLabel = new Map(nodeRows.map((n) => [n.intent_label.toLowerCase(), n]));
  const steps: Step[] = labels.map((l) => {
    const n = byLabel.get(l.toLowerCase());
    return {
      label: l,
      caption: captions[l] ?? captions[l.toLowerCase()] ?? '',
      node: n ? { intent_label: n.intent_label, screen_route: n.screen_route, locator_strategies: Array.isArray(n.locator_strategies) ? n.locator_strategies : [], persona_labels: (n.persona_labels && typeof n.persona_labels === 'object') ? n.persona_labels : {} } : null,
      status: n?.verification_status ?? 'unmapped',
    };
  });

  const ctx = await bootSession('scripted', { ...target, productId: wf.product_id });
  if (!ctx) { emit({ type: 'error', message: 'No product configured for this workflow.' }); return null; }

  emit({ type: 'start', scripted: true, product: ctx.productName, scenario: wf.name, mode: ctx.mode, sessionId: ctx.sessionId,
    total: steps.length, steps: steps.map((s, i) => ({ index: i, label: s.label, status: s.status, hasCaption: !!s.caption })) });

  // TWO drive paths. DESKTOP (clientNav): no server browser — per step we EMIT a client-driven nav
  // instruction (role label + plain id/class selectors + route) and the operator's embedded webview performs
  // it on the REAL product they're logged into (same mechanism ASK/REEL use). Instant, no headless login to
  // hang on. WEB (no clientNav): drive a server-side headless browser + stream screenshots.
  const clientNav = ctx.clientNav;
  let adapter: InteractionAdapter | null = null;
  let opened = false;
  if (!clientNav) {
    emit({ type: 'connecting', message: `Opening ${ctx.productName}…` });
    try { adapter = await getAdapter(ctx.productName, ctx.mode, ctx.baseUrl); await adapter.open(ctx.role); opened = true; }
    catch (e: any) { emit({ type: 'message', text: `Couldn't sign in to ${ctx.productName} (${String(e?.message ?? e)}). You can still step through; screens may not load.` }); }
  }

  let idx = -1;
  let working = false;

  const renderStep = async (i: number): Promise<void> => {
    if (working || i < 0 || i >= steps.length) return;
    working = true;
    idx = i;
    const step = steps[i];
    emit({ type: 'step', index: i, total: steps.length, label: step.label, caption: step.caption, status: step.status });
    if (clientNav) {
      // Instruct the embedded browser. Resolve the role's on-screen label + plain CSS selectors (Playwright
      // `:has-text` locators are dropped — the client matches the label text). The webview clicks it.
      const n = step.node;
      const label = n ? (n.persona_labels?.[ctx.role] ?? n.persona_labels?.['default'] ?? n.intent_label) : step.label;
      const selectors = n ? (n.locator_strategies ?? []).map((s) => String(s.value).replaceAll('{label}', label)).filter((v) => /^[#.]/.test(v)) : [];
      emit({ type: 'nav', scripted: true, clientDriven: true, index: i, label, selectors, url: n?.screen_route || '', navOk: !!n, navNote: n ? '' : 'this screen isn’t on the verified map' });
      working = false;
      return;
    }
    // WEB headless path: drive + screenshot.
    let url = ''; let navOk = false; let navNote = '';
    if (opened && adapter && step.node) {
      try { const r = await adapter.gotoNode(step.node, ctx.role); navOk = r.ok; url = r.url; if (!r.ok) navNote = `couldn't navigate (${r.healedVia ?? 'no working selector'})`; }
      catch (e: any) { navNote = String(e?.message ?? e); }
    } else if (!step.node) { navNote = 'this screen isn’t on the verified map — showing the current page'; }
    else if (!opened) { navNote = 'not signed in'; }
    const screenshot = adapter ? await snap(adapter) : null;
    emit({ type: 'nav', scripted: true, index: i, url, screenshot, navOk, navNote });
    working = false;
  };

  const session: ScriptedSession = {
    total: steps.length,
    async goto(i) { await renderStep(i); },
    async advance() {
      if (idx >= steps.length - 1) { emit({ type: 'done', total: steps.length }); return; }
      await renderStep(idx + 1);
    },
    async back() { await renderStep(Math.max(idx - 1, 0)); },
    async close() { try { await adapter?.close(); } catch { /* */ } },
  };

  void renderStep(0); // first screen streams on the SSE; the client drives the rest
  return session;
}

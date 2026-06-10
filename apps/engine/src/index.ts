/**
 * VIN Demo engine — hosted, auth-gated live-session streaming service.
 *
 * WHY THIS EXISTS: the desktop control room used to spawn the engine LOCALLY, which would force a
 * distributed app to ship Chromium + the DB/LLM/target-site credentials — instantly rejected by
 * app stores and trivially extractable from an Electron asar. Instead the engine runs HERE,
 * server-side on Railway, holding every secret as an env var, and streams results to thin clients
 * that carry only a short-lived signed session token. The rewired thin client is
 * apps/desktop/electron/main.cjs.
 *
 * Endpoints (all token-gated with the same SESSION_SECRET the web console issues at login):
 *   GET  /health              → 200 (Railway healthcheck)
 *   GET  /session/stream      → SSE; runs the canned REEL (3-question scenario).
 *   GET  /session/interactive → SSE; opens an INTERACTIVE session (emits start→ready), then stays
 *                               open waiting for typed/spoken questions.
 *   POST /session/utterance   → feed a question {text, speaker?} to the open interactive session;
 *                               the dynamic answer streams back on the interactive SSE.
 * All emit the same `data: <json>\n\n` events the desktop renderer already consumes.
 *
 * Concurrency (MVP): the engine uses a singleton Chromium + one shared screenshot file, so it
 * serves ONE live session at a time. It's a single-user demo tool, so a NEW session PREEMPTS the
 * current one (last-wins) rather than being rejected — switching Ask↔Talk↔Reel or reconnecting
 * always succeeds, and a dropped connection can't zombie-lock later sessions (see claim/release).
 * Multi-session (per-session browser contexts / replicas) is deferred until real concurrent demand.
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { runLiveSession, type SessionTarget } from '../../../src/core/live-session.js';
import { startInteractive, type InteractiveSession } from './interactive-session.js';
import { startScripted, type ScriptedSession } from './scripted-session.js';
import { startVoiceSession } from './voice-session.js';
import { verifyToken } from './session-token.js';
import { type ExecutionMode, classifyAction, permits } from '../../../src/core/safety.js';
import { getLlm } from '../../../src/core/llm.js';
import { loadPersona, personaPreamble, personaForbids, personaPermitsAction, recordHandoff } from '../../../src/core/persona.js';
import { recordAuditTurn, recordEscalation } from '../../../src/core/governance.js';
import { addChunk, editChunk, validateChunk, archiveChunk } from '../../../src/core/knowledge.js';
import { runAutogen } from '../../../src/core/graph-autogen.js';
import { runGraphVerify } from '../../../src/core/graph-verify.js';
import { publishGraph, archiveGraph, createWorkflow, updateWorkflow, setWorkflowApproval, archiveWorkflow, createNode, updateNode, archiveNode, selectNavigation, resolveNodeForScreen, recordNavAttempt, rollbackGraph, linkTourNodes } from '../../../src/core/graph-lifecycle.js';
import { createOutcome, updateOutcome, archiveOutcome, setWorkflowOutcome } from '../../../src/core/outcomes.js';
import { createProductStakeholder, updateProductStakeholder, archiveProductStakeholder, addStakeholderRelationship, archiveStakeholderRelationship } from '../../../src/core/stakeholders.js';
import { createJourney, updateJourney, setJourneyStatus, archiveJourney } from '../../../src/core/journeys.js';
import { createOrgPerson, updateOrgPerson, archiveOrgPerson } from '../../../src/core/orgchart.js';
import { assembleJourney } from '../../../src/core/journey-assembler.js';
import { setGapStatus } from '../../../src/core/gap-records.js';
import { beginCostSession } from '../../../src/core/cost.js';
import { promptCatalog, loadOverrides, saveOverride, resetOverride } from '../../../src/core/prompts.js';
import { modelCatalog, loadSettings, setModel, clearModel } from '../../../src/core/settings.js';
import { db } from '../../../src/core/db.js';

// Console-triggered eval suites (server-side). The runners are top-level scripts (recordEvalRun on import),
// so we SPAWN the existing npm scripts in the repo the engine container already ships (Dockerfile copies
// src + root package.json; tsx is a runtime dep). Suite→script is a server-side allowlist (injection-safe).
const EVAL_SUITES: Record<string, string> = {
  coverage: 'coverage',
  phase1: 'eval:phase1', phase6: 'eval:phase6', phase7: 'eval:phase7',
  phase9: 'eval:phase9', phase10: 'eval:phase10', phase11: 'eval:phase11',
  phase12: 'eval:phase12', phase13: 'eval:phase13', phase14: 'eval:phase14', phase15: 'eval:phase15', phase16: 'eval:phase16', phase17: 'eval:phase17',
  phase18: 'eval:phase18', phase19: 'eval:phase19', phase20: 'eval:phase20', phase21: 'eval:phase21', phase22: 'eval:phase22',
};
function runEvalSuite(script: string, product?: string): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const args = ['run', script, ...(product ? ['--', product] : [])];
    const child = spawn('npm', args, { cwd: process.cwd(), env: process.env });
    let out = '';
    const cap = (b: Buffer) => { out += b.toString(); if (out.length > 8000) out = out.slice(-8000); };
    child.stdout.on('data', cap); child.stderr.on('data', cap);
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 280_000);
    child.on('close', (code) => { clearTimeout(killer); resolve({ code: code ?? -1, tail: out.slice(-1200) }); });
    child.on('error', (e) => { clearTimeout(killer); resolve({ code: -1, tail: String(e?.message ?? e) }); });
  });
}

const PORT = Number(process.env.PORT ?? 8080);
const COOKIE_NAME = 'vin_demo_session'; // must match apps/web/middleware.ts SESSION_COOKIE

// Fail fast on misconfiguration — never run an engine that can't authenticate its callers.
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set — refusing to start an unauthenticated engine.');
  process.exit(1);
}

// Voice: materialize the base64 GCP service-account key (Railway env) to a file the Google SDKs read
// via GOOGLE_APPLICATION_CREDENTIALS. Skipped if that var is already a path (local dev).
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const p = join(tmpdir(), 'vin-gcp-key.json');
    writeFileSync(p, Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, 'base64').toString('utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = p;
    console.log('[engine] GCP voice credentials ready');
  } catch (e) { console.error('[engine] failed writing GCP key:', e); }
}

// Single live session at a time (singleton browser + shared shot file). This is a single-user demo
// tool, so a NEW session PREEMPTS the old one (last-wins) instead of being rejected — that's what the
// founder wants when switching Ask↔Talk↔Reel or reconnecting, and it prevents a dropped connection
// (a voice WS with no clean close) from zombie-locking every later session. Each session gets a
// monotonic id; only the current owner may release the global lock (a preempted session's late
// teardown must not clobber the new owner).
let activeId = 0;     // id of the session that currently owns the lock (0 = idle)
let sessionSeq = 0;   // monotonic session counter
let preempt: (() => void) | null = null; // tear down the current owner so a newcomer can take over
let interactive: InteractiveSession | null = null; // the open interactive session, fed by POST /session/utterance
let scripted: ScriptedSession | null = null; // the open SCRIPTED session, advanced by POST /session/advance

/** Claim the single-session lock for a new session, tearing down whoever holds it. Returns this
 *  session's id; pass it to `release(id)` when the session ends so a preempted session's late
 *  cleanup can't release a newer owner. `teardown` is how THIS session is itself preempted later. */
function claim(teardown: () => void): number {
  if (preempt) { try { preempt(); } catch { /* */ } }
  const id = ++sessionSeq;
  activeId = id; preempt = teardown;
  return id;
}
function release(id: number): void {
  if (activeId !== id) return; // a newer session already took over — don't touch its state
  activeId = 0; preempt = null; interactive = null; scripted = null;
}

/** Read and JSON-parse a small request body. */
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/** Pull the signed token from a Bearer header, the session cookie, or a ?token= query param. */
function tokenFrom(req: http.IncomingMessage, url: URL): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers['cookie'];
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return url.searchParams.get('token');
}

/** The operator-chosen demo target, parsed from query params (the desktop picker appends these).
 *  All optional — bootSession falls back to env, validates the productId, and coerces the mode. */
function targetFrom(url: URL): SessionTarget {
  const g = (k: string) => url.searchParams.get(k)?.trim() || undefined;
  return { productId: g('productId'), role: g('role'), mode: g('mode') as ExecutionMode | undefined, baseUrl: g('url'), scenario: g('scenario'), clientNav: url.searchParams.get('clientNav') === '1', personaId: g('personaId'), journeyId: g('journeyId') };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // CORS — the web console (a different origin) connects from the browser. The signed token is the
  // real gate; CORS just lets the browser READ the responses. Echo the request origin.
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const cors: Record<string, string> = origin
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin' }
    : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/session/stream') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // disable proxy buffering so events flush immediately
    });

    let open = true;
    const emit = (ev: Record<string, unknown>) => { if (open) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    req.on('close', () => { open = false; }); // client (desktop) hung up — stop writing

    const myId = claim(() => { open = false; try { res.end(); } catch { /* */ } }); // new session preempts any prior one
    console.log(`[engine] session start for ${payload.email}`);
    try {
      await runLiveSession(emit, targetFrom(url));
    } catch (e: any) {
      emit({ type: 'error', message: String(e?.message ?? e) });
      console.error('[engine] session failed:', e);
    } finally {
      release(myId);
      if (open) res.end();
      console.log(`[engine] session end for ${payload.email}`);
    }
    return;
  }

  // Interactive session: open the SSE, create the session, then stay open. Turns arrive via POST.
  if (req.method === 'GET' && url.pathname === '/session/interactive') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', ...cors });
    let open = true;
    const emit = (ev: Record<string, unknown>) => { if (open) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    const myId = claim(() => { open = false; try { res.end(); } catch { /* */ } }); // new session preempts any prior one
    req.on('close', () => release(myId));

    console.log(`[engine] interactive session start for ${payload.email}`);
    try {
      interactive = await startInteractive(emit, targetFrom(url));
      if (!interactive) { res.end(); release(myId); } // no product configured — startInteractive already emitted the error
      // else: keep the SSE open; POST /session/utterance drives each turn until the client disconnects
    } catch (e: any) {
      emit({ type: 'error', message: String(e?.message ?? e) });
      console.error('[engine] interactive start failed:', e);
      res.end(); release(myId);
    }
    return;
  }

  // Feed a typed/spoken question to the open interactive session; the answer streams on its SSE.
  if (req.method === 'POST' && url.pathname === '/session/utterance') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    if (!interactive) { res.writeHead(409, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'no active interactive session' })); return; }
    const body = await readJson(req);
    const text = typeof body?.text === 'string' ? body.text : '';
    const speaker = typeof body?.speaker === 'string' ? body.speaker : undefined;
    // Active specialist (hand-off) can ride along with each utterance so the answer/explain/gate use it.
    if (typeof body?.personaId !== 'undefined') interactive.ctx.personaId = (typeof body.personaId === 'string' && body.personaId.trim()) ? body.personaId.trim() : null;
    if (!text.trim()) { res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'empty utterance' })); return; }
    res.writeHead(202, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true })); // the answer streams on the open interactive SSE
    interactive.ask(text, speaker).catch(() => { /* errors are emitted on the SSE */ });
    return;
  }

  // Scripted session: open the SSE for a WORKFLOW, drive its screens in fixed order (no LLM). Steps stream
  // here; the client advances via POST /session/advance. Mirrors /session/interactive's lifecycle.
  if (req.method === 'GET' && url.pathname === '/session/scripted') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', ...cors });
    let open = true;
    let mySession: ScriptedSession | null = null;
    const emit = (ev: Record<string, unknown>) => { if (open) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    const myId = claim(() => { open = false; void mySession?.close(); try { res.end(); } catch { /* */ } }); // preempt → close my browser
    req.on('close', () => { void mySession?.close(); release(myId); });

    const workflowId = url.searchParams.get('workflowId')?.trim() || '';
    console.log(`[engine] scripted session start for ${payload.email} (wf ${workflowId})`);
    try {
      mySession = await startScripted(emit, workflowId, targetFrom(url));
      scripted = mySession;
      if (!mySession) { res.end(); release(myId); } // startScripted emitted the error
    } catch (e: any) {
      emit({ type: 'error', message: String(e?.message ?? e) });
      console.error('[engine] scripted start failed:', e);
      res.end(); release(myId);
    }
    return;
  }

  // Advance the open scripted session: { dir: 'next' | 'back' | 'goto', index? }. The step streams on its SSE.
  if (req.method === 'POST' && url.pathname === '/session/advance') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    if (!scripted) { res.writeHead(409, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'no active scripted session' })); return; }
    const body = await readJson(req);
    const dir = typeof body?.dir === 'string' ? body.dir : 'next';
    res.writeHead(202, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true })); // the step streams on the open scripted SSE
    const s = scripted;
    if (dir === 'back') s.back().catch(() => {});
    else if (dir === 'goto' && typeof body?.index === 'number') s.goto(body.index).catch(() => {});
    else s.advance().catch(() => {});
    return;
  }

  // Agentic drive step — the brain for the desktop's perceive→reason→act loop. Product-AGNOSTIC: it
  // reasons purely over the live page the embedded browser sends (url/headings/interactive elements),
  // returns ONE next action (click/type/done) + narration, and HARD-blocks any mutating click in
  // read-only (the human completes commits). One LLM call per step; the desktop runs the loop.
  if (req.method === 'POST' && url.pathname === '/agent/step') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    const body = await readJson(req);
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    const page = body?.page ?? {};
    const role = typeof body?.role === 'string' ? body.role : 'admin';
    const ALLOWED: ExecutionMode[] = ['read-only', 'safe', 'approval', 'execution'];
    const mode: ExecutionMode = ALLOWED.includes(body?.mode) ? body.mode : 'read-only';
    const history = Array.isArray(body?.history) ? body.history.filter((x: any) => typeof x === 'string').slice(-12) : [];
    const elements = Array.isArray(page?.elements)
      ? page.elements.slice(0, 140).map((e: any) => ({
          ref: Number(e?.ref), text: String(e?.text ?? '').slice(0, 120),
          role: e?.role ? String(e.role) : undefined, kind: e?.kind ? String(e.kind) : undefined,
          options: Array.isArray(e?.options) ? e.options.slice(0, 25).map((o: any) => String(o).slice(0, 60)) : undefined,
          required: e?.required === true || undefined, filled: e?.filled === true || undefined,
        })).filter((e: any) => Number.isInteger(e.ref))
      : [];
    if (!goal) { res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'no goal' })); return; }
    const finish = (step: any) => { res.writeHead(200, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(step)); };
    // Execution governance: the drive loop's session id (sent by the desktop) tags the agentStep LLM cost
    // to the session AND lets a BLOCKED step be recorded to the audit trail / escalation log (so the
    // governance dashboard's "execution blocks" reflects real driving, not just the conversational turns).
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
    if (sessionId) beginCostSession(sessionId);
    // Phase 2 BRIDGE — the demo graph informs the DOM-driven agent: load the product's VERIFIED screens and
    // hand them to agentStep so it prefers reaching them by name/route (the graph as navigation authority),
    // while still reading the live DOM (no regression to the form-drive). productId comes from the desktop target.
    const productId = typeof body?.productId === 'string' && body.productId.trim() ? body.productId.trim() : null;
    let knownScreens: { label: string; route: string | null }[] = [];
    if (productId) { try { knownScreens = (await selectNavigation(productId, role)).allVerified.slice(0, 30).map((n) => ({ label: n.intent_label, route: n.screen_route })); } catch { /* best-effort */ } }
    // Active specialist (if handed off): its overlay focuses the agent + its prohibited actions tighten the gate.
    const persona = await loadPersona(typeof body?.personaId === 'string' ? body.personaId : null);
    // A governance block on this step (recorded below). layer/escalate drive the audit + escalation rows.
    let block: { control: string; layer: 'behavior' | 'execution'; reason: string; escalate: boolean } | null = null;
    try {
      let step = await getLlm().agentStep({ goal, url: String(page.url ?? ''), title: String(page.title ?? ''), headings: Array.isArray(page.headings) ? page.headings.slice(0, 12).map(String) : [], elements, history, role, mode, personaPreamble: personaPreamble(persona), knownScreens });
      if (step.action === 'click') {
        const el = elements.find((e: any) => e.ref === step.ref);
        if (!el) {
          step = { action: 'done', ref: -1, value: '', say: step.say || 'That control is no longer on screen — take over if you like.' };
        } else {
          // Persona guardrail (enforced, not just prompted): if the active specialist's prohibited-actions
          // list forbids this control, hand back regardless of mode — a specialist can't be talked around it.
          const forbidden = personaForbids(persona, el.text);
          if (forbidden) {
            step = { action: 'done', ref: -1, value: '', say: `As the ${persona!.name}, “${el.text}” is outside my remit (“${forbidden}”). I'll hand back to the lead consultant or a human to handle that.` };
            block = { control: el.text, layer: 'behavior', reason: `prohibited action "${forbidden}"`, escalate: true };
          } else {
            // Hard guarantee (classifier decides, not the LLM), mode-aware: a CONFIRMED commit (clear mutating
            // verb) is blocked UNLESS the operator chose execution mode (permits mutating). Opening forms,
            // walking wizard steps, filtering, tabs, and unrecognized buttons (fail-closed but NOT confident)
            // are safe navigation in every mode. So read-only/safe/approval → navigate only; execution → may save.
            const cand = { tag: el.kind === 'link' ? 'a' : (el.kind === 'input' || el.kind === 'select' || el.kind === 'textarea') ? 'input' : 'button', text: el.text, role: el.role ?? null, type: null, href: el.kind === 'link' ? '#' : null, ariaLabel: null, title: null, className: null, inNav: false };
            const { cls, confident } = classifyAction(cand);
            // Execution governance: a confirmed mutating action must be permitted by BOTH the session mode
            // AND the persona's permissions. allowedActions is a whitelist (when non-empty); prohibited is
            // already enforced above. Empty allowedActions ⇒ no whitelist (governed by mode alone).
            const personaPermits = personaPermitsAction(persona, el.text);
            if (cls === 'mutating' && confident && !permits(cls, mode).permitted) {
              step = { action: 'done', ref: -1, value: '', say: `The next step — “${el.text}” — commits a change. In ${mode} mode I'll stop here; switch to Execution (or click it yourself) to complete it.` };
              block = { control: el.text, layer: 'execution', reason: `${mode} mode forbids a confirmed mutating action`, escalate: false };
            } else if (cls === 'mutating' && confident && !personaPermits) {
              step = { action: 'done', ref: -1, value: '', say: `As the ${persona!.name}, “${el.text}” isn't in my permitted actions — I'll hand back rather than act outside my remit.` };
              block = { control: el.text, layer: 'execution', reason: `outside ${persona!.name} permitted actions`, escalate: true };
            }
          }
        }
      }
      // Record the blocked step to the audit trail (Execution governance is now actually logged, not just
      // enforced) + an escalation when a persona-specific guardrail fired. Best-effort; never delays a no-block step.
      if (block && sessionId) {
        await recordAuditTurn({
          sessionId, personaId: persona?.id ?? null, personaName: persona?.name ?? 'Consultant', promptVersion: persona?.version ?? 1,
          utterance: goal, intent: 'drive-step', knowledgeUsed: [], citations: [], confidenceBand: 'n/a',
          actionsConsidered: [block.control], actionsRejected: [block.control], handoff: null,
          escalation: block.escalate ? { trigger: 'execution', reason: block.reason, toPersona: null } : null,
          compliance: { ok: false, action: 'block', violations: [{ layer: block.layer, rule: `execution:${block.layer}`, detail: block.reason, action: 'block' }], escalateTo: null },
        });
        if (block.escalate) await recordEscalation(sessionId, persona?.id ?? null, null, 'execution', block.reason);
      }
      // Phase 2 telemetry (the bridge — the DOM-driven agent FEEDS the graph): resolve the acted screen to a
      // node + record the attempt. ok = an executable action was issued (not blocked/done). Best-effort.
      if (productId) {
        const actedEl = step.ref >= 0 ? elements.find((e: any) => e.ref === step.ref) : null;
        const acted = (step.action === 'click' || step.action === 'type' || step.action === 'select') && !block;
        if (actedEl || block) {
          const resolved = await resolveNodeForScreen(productId, String(page.url ?? ''), actedEl?.text ?? '');
          await recordNavAttempt({ source: 'agent-step', productId, sessionId, graphId: resolved?.graphId ?? null, nodeId: resolved?.nodeId ?? null, intent: goal, url: String(page.url ?? ''), ok: acted, healedVia: null, selectorUsed: actedEl?.text ?? null });
        }
      }
      finish(step);
    } catch (e: any) {
      console.error('[engine] agent/step error:', e);
      finish({ action: 'done', ref: -1, value: '', say: 'I hit a snag planning the next step — take over whenever you like.' });
    }
    return;
  }

  // Record a real persona hand-off (the metric + audit source). The Control Center calls this when the
  // operator switches specialist; from/to are persona ids (null = lead consultant).
  if (req.method === 'POST' && url.pathname === '/persona/handoff') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    const body = await readJson(req);
    // Prefer the client-supplied sessionId (the desktop has it from the `start` event) so hand-offs are
    // recorded in Talk/Reel too — not only when an interactive SSE happens to be open (the prior gap).
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : interactive?.ctx.sessionId ?? null;
    const toId = (typeof body?.toId === 'string' && body.toId.trim()) ? body.toId.trim() : null;
    // Activate the specialist on the open interactive session so subsequent turns use its overlay/gate.
    if (interactive) interactive.ctx.personaId = toId;
    await recordHandoff(sessionId, body?.fromId ?? null, toId, typeof body?.trigger === 'string' ? body.trigger : 'operator');
    res.writeHead(202, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // In-console knowledge mutations (Phase C). Engine-side because embedding (Voyage) + DB live here; the
  // web console proxies here with the operator's signed token (RBAC enforced web-side). actor = the token's
  // email, recorded in knowledge_events. add/edit re-embed (reindex); validate/archive are metadata + audit.
  if (req.method === 'POST' && url.pathname === '/knowledge') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    const body = await readJson(req);
    const actor = payload.email;
    try {
      let result: { id: string };
      switch (body?.action) {
        case 'add': result = await addChunk({ productId: String(body.productId ?? ''), content: String(body.content ?? ''), sourceTitle: String(body.sourceTitle ?? ''), sourceType: body.sourceType, category: body.category, actor }); break;
        case 'edit': result = await editChunk({ chunkId: String(body.chunkId ?? ''), content: String(body.content ?? ''), actor }); break;
        case 'validate': result = await validateChunk({ chunkId: String(body.chunkId ?? ''), actor, method: body.method }); break;
        case 'archive': result = await archiveChunk({ chunkId: String(body.chunkId ?? ''), actor }); break;
        default: res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: `unknown action: ${body?.action}` })); return;
      }
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e: any) {
      console.error('[engine] /knowledge error:', e);
      res.writeHead(500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // In-console DEMO GRAPH actions (Phase E). Engine-side because autogen + verify drive Playwright + the
  // LLM (which live here), exactly like /knowledge owns Voyage. The web console proxies here with the
  // operator's signed token (RBAC enforced web-side). autogen = derive a DRAFT graph from validated
  // knowledge; verify = recon-validate the active graph (drift); publish/archive = lifecycle (audited).
  if (req.method === 'POST' && url.pathname === '/graph') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    const body = await readJson(req);
    const actor = payload.email;
    const role = typeof body?.role === 'string' && body.role.trim() ? body.role.trim() : 'admin';
    try {
      let result: any;
      switch (body?.action) {
        case 'autogen': result = await runAutogen(String(body.product ?? ''), role, { verify: body.verify !== false }); break;
        case 'verify': result = await runGraphVerify(String(body.product ?? ''), role); break;
        case 'publish': await publishGraph(String(body.graphId ?? ''), actor); result = { graphId: body.graphId }; break;
        case 'archive': await archiveGraph(String(body.graphId ?? ''), actor); result = { graphId: body.graphId }; break;
        // Workflow authoring (0015) — pure-DB CRUD over a graph's demo_graph_workflows, audited to graph_events.
        case 'workflow.create': result = await createWorkflow(String(body.graphId ?? ''), body.data ?? {}, body.approved !== false, actor); break;
        case 'workflow.update': result = await updateWorkflow(String(body.workflowId ?? ''), body.data ?? {}, actor); break;
        case 'workflow.approve': result = await setWorkflowApproval(String(body.workflowId ?? ''), !!body.approved, actor); break;
        case 'workflow.archive': result = await archiveWorkflow(String(body.workflowId ?? ''), actor); break;
        // Node authoring / manual override (V3.2) — operator CRUD over demo_graph_nodes, audited to graph_events.
        case 'node.create': result = await createNode(String(body.graphId ?? ''), body.data ?? {}, actor); break;
        case 'node.update': result = await updateNode(String(body.nodeId ?? ''), body.data ?? {}, actor); break;
        case 'node.archive': result = await archiveNode(String(body.nodeId ?? ''), actor); break;
        // Versioning/rollback + full tour→node-id linkage (V3.2 Phase 4 — governed authority convergence).
        case 'rollback': result = await rollbackGraph(String(body.graphId ?? ''), actor); break;
        case 'tour.link': result = await linkTourNodes(String(body.productId ?? ''), actor); break;
        default: res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: `unknown action: ${body?.action}` })); return;
      }
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e: any) {
      console.error('[engine] /graph error:', e);
      res.writeHead(500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // In-console EXPERIENCE registry actions (V5 Guided Experience Platform, Phase 1) — Business Outcome
  // Registry + Stakeholder Registry (the per-product buying committee) + the influence graph. Engine-side (DB
  // lives here) exactly like /graph and /knowledge; the web console proxies with the operator's signed token
  // (RBAC enforced web-side). actor = the token's email, recorded in outcome_events. Pure DB (no LLM/browser).
  if (req.method === 'POST' && url.pathname === '/experience') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    const body = await readJson(req);
    const actor = payload.email;
    try {
      let result: any;
      switch (body?.action) {
        // Business Outcome Registry
        case 'outcome.create': result = await createOutcome(String(body.productId ?? ''), body.data ?? {}, actor); break;
        case 'outcome.update': result = await updateOutcome(String(body.outcomeId ?? ''), body.data ?? {}, actor); break;
        case 'outcome.archive': result = await archiveOutcome(String(body.outcomeId ?? ''), actor); break;
        case 'outcome.link': await setWorkflowOutcome(String(body.workflowId ?? ''), body.outcomeId ? String(body.outcomeId) : null, actor); result = { workflowId: body.workflowId, outcomeId: body.outcomeId ?? null }; break;
        // Stakeholder Registry (the per-product buying committee)
        case 'stakeholder.create': result = await createProductStakeholder(String(body.productId ?? ''), body.data ?? {}, actor); break;
        case 'stakeholder.update': await updateProductStakeholder(String(body.stakeholderId ?? ''), body.data ?? {}, actor); result = { stakeholderId: body.stakeholderId }; break;
        case 'stakeholder.archive': await archiveProductStakeholder(String(body.stakeholderId ?? ''), actor); result = { stakeholderId: body.stakeholderId }; break;
        // Influence graph (edges between committee members)
        case 'relationship.create': result = await addStakeholderRelationship(String(body.productId ?? ''), String(body.fromId ?? ''), String(body.toId ?? ''), body.relation ?? null, body.weight ?? null, actor); break;
        case 'relationship.archive': await archiveStakeholderRelationship(String(body.relationshipId ?? ''), actor); result = { relationshipId: body.relationshipId }; break;
        // Journey Layer (V5 Phase 2 — the keystone) — orchestration object CRUD. References existing assets
        // (workflows/tours/knowledge); never replaces them. Reference integrity is checked at read time.
        case 'journey.create': result = await createJourney(String(body.productId ?? ''), body.data ?? {}, actor); break;
        case 'journey.update': result = await updateJourney(String(body.journeyId ?? ''), body.data ?? {}, actor); break;
        case 'journey.status': result = await setJourneyStatus(String(body.journeyId ?? ''), body.status, actor); break;
        case 'journey.archive': result = await archiveJourney(String(body.journeyId ?? ''), actor); break;
        // Org Chart (migration 0024) — the real organization's people + reporting lines; job_title is the operator-assigned ROLE.
        case 'orgPerson.create': result = await createOrgPerson(body.data ?? {}, actor); break;
        case 'orgPerson.update': await updateOrgPerson(String(body.orgPersonId ?? ''), body.data ?? {}, actor); result = { orgPersonId: body.orgPersonId }; break;
        case 'orgPerson.archive': await archiveOrgPerson(String(body.orgPersonId ?? ''), actor); result = { orgPersonId: body.orgPersonId }; break;
        // Journey ASSEMBLER (mig 0025) — downstream consumer: assembles a draft journey from EXISTING assets +
        // persists Gap Records for anything missing. Creates ONLY a journey + gap_records, never an asset.
        case 'journey.assemble': result = await assembleJourney({ productId: String(body.productId ?? ''), outcomeId: String(body.outcomeId ?? ''), committeeIds: Array.isArray(body.committeeIds) ? body.committeeIds.map(String) : undefined, organization: body.organization ?? null, industry: body.industry ?? null }, actor); break;
        case 'gap.resolve': await setGapStatus(String(body.gapId ?? ''), 'resolved', actor); result = { gapId: body.gapId }; break;
        case 'gap.dismiss': await setGapStatus(String(body.gapId ?? ''), 'dismissed', actor); result = { gapId: body.gapId }; break;
        default: res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: `unknown action: ${body?.action}` })); return;
      }
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e: any) {
      console.error('[engine] /experience error:', e);
      res.writeHead(500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/evals') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    const body = await readJson(req);
    const suite = String(body?.suite ?? '');
    const script = EVAL_SUITES[suite];
    if (!script) { res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: `unknown suite: ${suite}` })); return; }
    const product = suite === 'coverage' && typeof body?.product === 'string' && body.product.trim() ? body.product.trim() : undefined;
    try {
      const { code, tail } = await runEvalSuite(script, product);
      // The runner records its own eval_runs row; read it back for the real pass/total to return + display.
      const latest = (await db().query<{ passed: number; total: number; ran_at: string }>(
        `SELECT passed, total, ran_at::text FROM eval_runs WHERE suite = $1 ORDER BY ran_at DESC LIMIT 1`, [suite])).rows[0];
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: code === 0, suite, code, passed: latest?.passed ?? null, total: latest?.total ?? null, tail }));
    } catch (e: any) {
      console.error('[engine] /evals error:', e);
      res.writeHead(500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // AI Control (migrations 0027 prompt_overrides + 0028 app_settings) — surface + edit HOW the AI is led:
  // the per-function default prompts (override-aware) and the model the demo brain runs on. Engine-side
  // because the registry/settings + their caches live with the LLM; the web console proxies here with the
  // operator's signed token (RBAC enforced web-side). A save refreshes the in-process cache so it applies
  // LIVE on the next turn (no redeploy). GET returns the full catalog for the editor.
  if (req.method === 'GET' && url.pathname === '/ai-config') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    // RBAC AT THE ENGINE (not only the web proxy): the engine is internet-reachable, and /ai-config controls
    // every system prompt + the model — the highest blast radius. A valid token alone is not enough.
    if (payload.role !== 'admin' && payload.role !== 'operator') { res.writeHead(403, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'insufficient role' })); return; }
    try {
      await loadOverrides(); await loadSettings(); // freshest view (another operator may have edited)
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ prompts: promptCatalog(), model: modelCatalog() }));
    } catch (e: any) {
      console.error('[engine] /ai-config GET error:', e);
      res.writeHead(500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'ai-config read failed' })); // generic — don't reflect raw DB/internal detail
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/ai-config') {
    const payload = await verifyToken(tokenFrom(req, url));
    if (!payload) { res.writeHead(401, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    if (payload.role !== 'admin' && payload.role !== 'operator') { res.writeHead(403, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'insufficient role' })); return; }
    const body = await readJson(req);
    const actor = payload.email;
    try {
      switch (body?.action) {
        case 'prompt.save': await saveOverride(String(body.key ?? ''), String(body.text ?? ''), actor); break;
        case 'prompt.reset': await resetOverride(String(body.key ?? '')); break;
        case 'model.set': await setModel(String(body.model ?? ''), actor); break;
        case 'model.reset': await clearModel(); break;
        default: res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: `unknown action: ${body?.action}` })); return;
      }
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: true, prompts: promptCatalog(), model: modelCatalog() }));
    } catch (e: any) {
      console.error('[engine] /ai-config POST error:', e);
      // Validation errors (bad key/model/text) are the caller's fault → 400 with the safe message; anything
      // else (e.g. a DB failure) is 500 with a generic message so we never reflect raw internals.
      const msg = String(e?.message ?? e);
      const isValidation = /^(unknown |override text )/.test(msg);
      res.writeHead(isValidation ? 400 : 500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: isValidation ? msg : 'ai-config update failed' }));
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Voice gateway — WebSocket on /voice, same signed-token gate + single-session serialize as HTTP.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  let url: URL;
  try { url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`); } catch { socket.destroy(); return; }
  if (url.pathname !== '/voice') { socket.destroy(); return; }
  const payload = await verifyToken(tokenFrom(req, url));
  if (!payload) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const myId = claim(() => { try { ws.close(); } catch { /* */ } }); // new session preempts any prior one
    console.log(`[engine] voice session start for ${payload.email}`);
    ws.on('close', () => { release(myId); console.log(`[engine] voice session end for ${payload.email}`); });
    startVoiceSession(ws, targetFrom(url)).catch((e) => { console.error('[engine] voice session error:', e); release(myId); try { ws.close(); } catch { /* */ } });
  });
});

// Warm the AI-control caches (prompt overrides + model setting) so the very first turn uses any operator
// edits. Best-effort — currentModel()/rp() fall back to the known-good defaults if these never resolve.
void loadOverrides();
void loadSettings();

server.listen(PORT, '0.0.0.0', () => console.log(`[engine] listening on :${PORT}`));

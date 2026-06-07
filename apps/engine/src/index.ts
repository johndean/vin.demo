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
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { runLiveSession, type SessionTarget } from '../../../src/core/live-session.js';
import { startInteractive, type InteractiveSession } from './interactive-session.js';
import { startVoiceSession } from './voice-session.js';
import { verifyToken } from './session-token.js';
import { type ExecutionMode, classifyAction, permits } from '../../../src/core/safety.js';
import { getLlm } from '../../../src/core/llm.js';
import { loadPersona, personaPreamble, recordHandoff } from '../../../src/core/persona.js';

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
  activeId = 0; preempt = null; interactive = null;
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
  return { productId: g('productId'), role: g('role'), mode: g('mode') as ExecutionMode | undefined, baseUrl: g('url'), scenario: g('scenario'), clientNav: url.searchParams.get('clientNav') === '1' };
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
    if (!text.trim()) { res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'empty utterance' })); return; }
    res.writeHead(202, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true })); // the answer streams on the open interactive SSE
    interactive.ask(text, speaker).catch(() => { /* errors are emitted on the SSE */ });
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
      ? page.elements.slice(0, 120).map((e: any) => ({ ref: Number(e?.ref), text: String(e?.text ?? '').slice(0, 120), role: e?.role ? String(e.role) : undefined, kind: e?.kind ? String(e.kind) : undefined })).filter((e: any) => Number.isInteger(e.ref))
      : [];
    if (!goal) { res.writeHead(400, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'no goal' })); return; }
    const finish = (step: any) => { res.writeHead(200, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(step)); };
    // Active specialist (if handed off): its overlay focuses the agent + its prohibited actions tighten the gate.
    const persona = await loadPersona(typeof body?.personaId === 'string' ? body.personaId : null);
    try {
      let step = await getLlm().agentStep({ goal, url: String(page.url ?? ''), title: String(page.title ?? ''), headings: Array.isArray(page.headings) ? page.headings.slice(0, 12).map(String) : [], elements, history, role, mode, personaPreamble: personaPreamble(persona) });
      if (step.action === 'click') {
        const el = elements.find((e: any) => e.ref === step.ref);
        if (!el) {
          step = { action: 'done', ref: -1, value: '', say: step.say || 'That control is no longer on screen — take over if you like.' };
        } else {
          // Hard guarantee (classifier decides, not the LLM), mode-aware: a CONFIRMED commit (clear mutating
          // verb) is blocked UNLESS the operator chose execution mode (permits mutating). Opening forms,
          // walking wizard steps, filtering, tabs, and unrecognized buttons (fail-closed but NOT confident)
          // are safe navigation in every mode. So read-only/safe/approval → navigate only; execution → may save.
          const cand = { tag: el.kind === 'link' ? 'a' : (el.kind === 'input' || el.kind === 'select' || el.kind === 'textarea') ? 'input' : 'button', text: el.text, role: el.role ?? null, type: null, href: el.kind === 'link' ? '#' : null, ariaLabel: null, title: null, className: null, inNav: false };
          const { cls, confident } = classifyAction(cand);
          if (cls === 'mutating' && confident && !permits(cls, mode).permitted) {
            step = { action: 'done', ref: -1, value: '', say: `The next step — “${el.text}” — commits a change. In ${mode} mode I'll stop here; switch to Execution (or click it yourself) to complete it.` };
          }
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
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : interactive?.ctx.sessionId ?? null;
    await recordHandoff(sessionId, body?.fromId ?? null, body?.toId ?? null, typeof body?.trigger === 'string' ? body.trigger : 'operator');
    res.writeHead(202, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true }));
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

server.listen(PORT, '0.0.0.0', () => console.log(`[engine] listening on :${PORT}`));

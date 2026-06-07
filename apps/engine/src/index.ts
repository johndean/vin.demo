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
 * serves ONE live session at a time; a second concurrent request gets {type:'busy'} and closes.
 * Multi-session (per-session browser contexts / replicas) is deferred until real concurrent demand.
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { runLiveSession } from '../../../src/core/live-session.js';
import { startInteractive, type InteractiveSession } from './interactive-session.js';
import { startVoiceSession } from './voice-session.js';
import { verifyToken } from './session-token.js';

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

let active = false; // serialize: one live session at a time (singleton browser + shared shot file)
let interactive: InteractiveSession | null = null; // the open interactive session, fed by POST /session/utterance

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

    if (active) { // serialize — another demo is already running; surface it, never drop silently
      console.warn(`[engine] busy: rejected concurrent session for ${payload.email}`);
      emit({ type: 'busy', message: 'The engine is already running a live session. Try again shortly.' });
      res.end();
      return;
    }

    active = true;
    console.log(`[engine] session start for ${payload.email}`);
    try {
      await runLiveSession(emit);
    } catch (e: any) {
      emit({ type: 'error', message: String(e?.message ?? e) });
      console.error('[engine] session failed:', e);
    } finally {
      active = false;
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
    const cleanup = () => { open = false; interactive = null; active = false; };
    req.on('close', cleanup);

    if (active) { emit({ type: 'busy', message: 'The engine is already running a session. Try again shortly.' }); res.end(); return; }

    active = true;
    console.log(`[engine] interactive session start for ${payload.email}`);
    try {
      interactive = await startInteractive(emit);
      if (!interactive) { res.end(); cleanup(); } // not seeded — startInteractive already emitted the error
      // else: keep the SSE open; POST /session/utterance drives each turn until the client disconnects
    } catch (e: any) {
      emit({ type: 'error', message: String(e?.message ?? e) });
      console.error('[engine] interactive start failed:', e);
      res.end(); cleanup();
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
  if (active) { socket.write('HTTP/1.1 409 Conflict\r\n\r\n'); socket.destroy(); return; }
  active = true;
  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log(`[engine] voice session start for ${payload.email}`);
    ws.on('close', () => { active = false; console.log(`[engine] voice session end for ${payload.email}`); });
    startVoiceSession(ws).catch((e) => { console.error('[engine] voice session error:', e); active = false; try { ws.close(); } catch { /* */ } });
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[engine] listening on :${PORT}`));

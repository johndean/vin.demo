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
 * Endpoints:
 *   GET /health          → 200 (Railway healthcheck)
 *   GET /session/stream  → SSE; requires a valid signed token (same SESSION_SECRET as the web
 *                          console issues at login). Streams the real loop's events as
 *                          `data: <json>\n\n` — the exact objects the desktop renderer already
 *                          consumes, so no renderer change is needed.
 *
 * Concurrency (MVP): the engine uses a singleton Chromium + one shared screenshot file, so it
 * serves ONE live session at a time; a second concurrent request gets {type:'busy'} and closes.
 * Multi-session (per-session browser contexts / replicas) is deferred until real concurrent demand.
 */
import http from 'node:http';
import 'dotenv/config';
import { runLiveSession } from '../../../src/core/live-session.js';
import { verifyToken } from './session-token.js';

const PORT = Number(process.env.PORT ?? 8080);
const COOKIE_NAME = 'vin_demo_session'; // must match apps/web/middleware.ts SESSION_COOKIE

// Fail fast on misconfiguration — never run an engine that can't authenticate its callers.
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set — refusing to start an unauthenticated engine.');
  process.exit(1);
}

let active = false; // serialize: one live session at a time (singleton browser + shared shot file)

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

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => console.log(`[engine] listening on :${PORT}`));

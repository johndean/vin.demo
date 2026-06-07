const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process'); // dev-only local engine fallback (see below)

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    frame: false,            // design supplies its own window chrome (deskwin card)
    backgroundColor: '#0c141c',
    title: 'VIN Demo Control Room',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Open any external links (e.g. "back to console" → demofor.vin) in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Auth SSOT ────────────────────────────────────────────────────────────────────────────────
// The desktop authenticates against the web console's /api/auth/login (same seeded admin, same
// validation). Runs in the main process to avoid CORS. Override the base with VIN_DEMO_WEB_URL
// for local dev. On success we capture the SIGNED session cookie and reuse it for data + stream.
const AUTH_BASE = process.env.VIN_DEMO_WEB_URL || 'https://demofor.vin';
// The hosted engine (apps/engine on Railway). The thin client streams the live session from here —
// it holds ZERO credentials/Chromium/engine code. Override for local dev with VIN_DEMO_ENGINE_URL.
// (Optional polish: map a custom domain like engine.demofor.vin to this service and swap it in.)
const ENGINE_BASE = process.env.VIN_DEMO_ENGINE_URL || 'https://vin-demo-engine-production.up.railway.app';
let sessionCookie = null; // captured signed token from /api/auth/login (gates data + the stream)

ipcMain.handle('auth:login', async (_e, { email, password }) => {
  try {
    const res = await fetch(`${AUTH_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const sc = res.headers.get('set-cookie');
    if (res.ok && sc) sessionCookie = sc.split(';')[0]; // "vin_demo_session=<signed token>"
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Log out: drop the captured token and abort any running session. The desktop holds no browser
// cookie jar (it sends the Cookie header manually), so clearing sessionCookie fully signs out.
ipcMain.handle('auth:logout', () => { stopSession(); sessionCookie = null; return { ok: true }; });

// Voice: hand the renderer the captured token + engine URL so it can open the /voice WebSocket
// directly (Chromium has getUserMedia + WebSocket). No secrets beyond the short-lived session token.
ipcMain.handle('auth:voiceToken', () => ({
  token: sessionCookie ? sessionCookie.split('=').slice(1).join('=') : null,
  engineUrl: ENGINE_BASE,
}));

// Thin client: fetch the SAME real console data the web renders (the SSOT), using the captured cookie.
ipcMain.handle('data:fetch', async () => {
  try {
    const res = await fetch(`${AUTH_BASE}/api/console/data`, {
      headers: sessionCookie ? { Cookie: sessionCookie } : {},
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// ── Live session SERVICE ───────────────────────────────────────────────────────────────────────
// DEFAULT (and the only path in the packaged app): stream the real engine loop from the HOSTED
// service over an auth-gated SSE connection. The credentials, Chromium, and engine all live
// server-side — nothing sensitive is shipped. Events are forwarded verbatim over IPC, so the
// renderer (runtime.tsx) is unchanged. The scripted BEATS remain a client-side QA toggle.
let sessionAbort = null; // hosted stream
let sessionProc = null;  // dev-only local spawn
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function stopSession() {
  if (sessionAbort) { try { sessionAbort.abort(); } catch { /* */ } sessionAbort = null; }
  if (sessionProc) { try { sessionProc.kill(); } catch { /* */ } sessionProc = null; }
}

// Parse an SSE byte stream (`data: <json>\n\n`) and forward each event over IPC.
async function pumpSSE(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('');
        if (!data) continue; // SSE comment / keep-alive
        try { win?.webContents.send('session:event', JSON.parse(data)); } catch { /* non-JSON line */ }
      }
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') win?.webContents.send('session:event', { type: 'error', message: String(err.message ?? err) });
  } finally {
    win?.webContents.send('session:event', { type: 'closed' });
    sessionAbort = null;
  }
}

async function startHostedSession(path = '/session/stream') {
  if (!sessionCookie) {
    win?.webContents.send('session:event', { type: 'error', message: 'Not signed in — log in first.' });
    return { ok: false };
  }
  sessionAbort = new AbortController();
  try {
    const res = await fetch(`${ENGINE_BASE}${path}`, {
      headers: { Cookie: sessionCookie, accept: 'text/event-stream' },
      signal: sessionAbort.signal,
    });
    if (!res.ok || !res.body) {
      win?.webContents.send('session:event', { type: 'error', message: `Engine unavailable (HTTP ${res.status}).` });
      sessionAbort = null;
      return { ok: false };
    }
    pumpSSE(res.body); // stream in the background; IPC events arrive on 'session:event'
    return { ok: true };
  } catch (err) {
    if (!(err && err.name === 'AbortError')) win?.webContents.send('session:event', { type: 'error', message: String(err && err.message ? err.message : err) });
    sessionAbort = null;
    return { ok: false };
  }
}

// DEV-ONLY fallback: spawn the engine locally (the founder's machine has the repo + .env). The
// packaged app sets neither VIN_DEMO_ENGINE_URL nor VIN_DEMO_LOCAL_ENGINE, so this is never reached
// in distribution — no engine/credentials are bundled. Use it for fast local iteration.
function startLocalSession() {
  const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const env = { ...process.env, CAPTURE_SHOTS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    sessionProc = spawn(tsx, ['src/core/live-session.ts'], { cwd: REPO_ROOT, env });
  } catch (err) {
    win?.webContents.send('session:event', { type: 'error', message: String(err && err.message ? err.message : err) });
    return { ok: false };
  }
  let buf = '';
  sessionProc.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { win?.webContents.send('session:event', JSON.parse(line)); } catch { /* ignore non-JSON log lines */ }
    }
  });
  sessionProc.stderr.on('data', () => { /* engine diagnostics; ignore on the wire */ });
  sessionProc.on('close', (code) => { win?.webContents.send('session:event', { type: 'closed', code }); sessionProc = null; });
  return { ok: true };
}

ipcMain.handle('session:start', async () => {
  stopSession();
  const useLocal = !process.env.VIN_DEMO_ENGINE_URL && process.env.VIN_DEMO_LOCAL_ENGINE === '1';
  return useLocal ? startLocalSession() : startHostedSession();
});
// Interactive session: open the hosted /session/interactive SSE; questions are sent via session:ask.
ipcMain.handle('session:startInteractive', async () => { stopSession(); return startHostedSession('/session/interactive'); });
ipcMain.handle('session:ask', async (_e, { text, speaker }) => {
  if (!sessionCookie) return { ok: false, error: 'not signed in' };
  try {
    const res = await fetch(`${ENGINE_BASE}/session/utterance`, {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text, speaker }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});
ipcMain.handle('session:stop', () => { stopSession(); return { ok: true }; });
app.on('before-quit', stopSession);

ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize(); });
ipcMain.on('win:close', () => win?.close());

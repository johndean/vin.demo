const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

// Live session SERVICE (Phase 4): spawn the real engine loop (tsx src/core/live-session.ts
// from the repo root) and stream its NDJSON events to the renderer over IPC. The engine has
// the credentials/Playwright/DB it needs locally. Live is the default runtime; scripted BEATS
// remain a QA toggle in the renderer.
let sessionProc = null;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
function stopSession() { if (sessionProc) { try { sessionProc.kill(); } catch { /* */ } sessionProc = null; } }

ipcMain.handle('session:start', () => {
  stopSession();
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
});
ipcMain.handle('session:stop', () => { stopSession(); return { ok: true }; });
app.on('before-quit', stopSession);

ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize(); });
ipcMain.on('win:close', () => win?.close());

// Auth SSOT: the desktop authenticates against the web console's /api/auth/login (same
// seeded admin, same validation). Runs in the main process to avoid CORS. Override the
// base with VIN_DEMO_WEB_URL for local dev.
const AUTH_BASE = process.env.VIN_DEMO_WEB_URL || 'https://demofor.vin';
let sessionCookie = null; // captured from /api/auth/login so the desktop can read gated data

ipcMain.handle('auth:login', async (_e, { email, password }) => {
  try {
    const res = await fetch(`${AUTH_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const sc = res.headers.get('set-cookie');
    if (res.ok && sc) sessionCookie = sc.split(';')[0]; // "vin_demo_session=<value>"
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Thin client: fetch the SAME real console data the web renders (the SSOT), using the
// session cookie captured at login.
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

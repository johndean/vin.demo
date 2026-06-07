const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

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

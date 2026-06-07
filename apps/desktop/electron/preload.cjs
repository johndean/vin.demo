const { contextBridge, ipcRenderer } = require('electron');

// Expose minimal window controls so the (frameless) titlebar's traffic-light dots work.
contextBridge.exposeInMainWorld('win', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
});

// Auth against the SAME source of truth as the web console (its /api/auth/login). The
// request runs in the main process (no CORS) — the desktop is a thin client of the web SSOT.
contextBridge.exposeInMainWorld('auth', {
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
});

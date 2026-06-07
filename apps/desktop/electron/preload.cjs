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
  logout: () => ipcRenderer.invoke('auth:logout'),
});

// Real console data from the web SSOT (gated by the captured session cookie).
contextBridge.exposeInMainWorld('consoleData', {
  fetch: () => ipcRenderer.invoke('data:fetch'),
});

// Live demo session service: start/stop the real engine loop + receive its streamed events.
contextBridge.exposeInMainWorld('session', {
  start: () => ipcRenderer.invoke('session:start'),
  startInteractive: () => ipcRenderer.invoke('session:startInteractive'),
  ask: (text, speaker) => ipcRenderer.invoke('session:ask', { text, speaker }),
  stop: () => ipcRenderer.invoke('session:stop'),
  onEvent: (cb) => {
    const h = (_e, ev) => cb(ev);
    ipcRenderer.on('session:event', h);
    return () => ipcRenderer.removeListener('session:event', h);
  },
});

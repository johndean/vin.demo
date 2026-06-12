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
  voiceToken: () => ipcRenderer.invoke('auth:voiceToken'),
});

// Real console data from the web SSOT (gated by the captured session cookie). `mutate` writes through the
// web console's table-driven admin endpoint (used to save/update/archive guided demo tours from the desktop).
contextBridge.exposeInMainWorld('consoleData', {
  fetch: () => ipcRenderer.invoke('data:fetch'),
  mutate: (body) => ipcRenderer.invoke('admin:mutate', body),
});

// Live demo session service: start/stop the real engine loop + receive its streamed events.
contextBridge.exposeInMainWorld('session', {
  start: (target) => ipcRenderer.invoke('session:start', { target }),
  startInteractive: (target) => ipcRenderer.invoke('session:startInteractive', { target }),
  // Scripted workflow runner: open /session/scripted for a workflow + advance through its steps.
  startScripted: (target, workflowId) => ipcRenderer.invoke('session:startScripted', { target, workflowId }),
  advance: (dir, index) => ipcRenderer.invoke('session:advance', { dir, index }),
  ask: (text, speaker) => ipcRenderer.invoke('session:ask', { text, speaker }),
  // One step of the agentic drive loop — sends the live page + goal, gets back the next action.
  agentStep: (payload) => ipcRenderer.invoke('session:agentStep', payload),
  // RC-31: report the URL the live webview LANDED on after a client-driven nav, so the engine can turn the
  // ok=NULL selection into a real outcome + surface drift. Fire-and-forget (best-effort telemetry).
  navLanded: (payload) => ipcRenderer.invoke('session:navLanded', payload),
  // Record a specialist hand-off (the active persona for subsequent agent steps + the real metric).
  handoff: (payload) => ipcRenderer.invoke('session:handoff', payload),
  stop: () => ipcRenderer.invoke('session:stop'),
  onEvent: (cb) => {
    const h = (_e, ev) => cb(ev);
    ipcRenderer.on('session:event', h);
    return () => ipcRenderer.removeListener('session:event', h);
  },
});

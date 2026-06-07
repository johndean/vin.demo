const { contextBridge, ipcRenderer } = require('electron');

// Expose minimal window controls so the (frameless) titlebar's traffic-light dots work.
contextBridge.exposeInMainWorld('win', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
});

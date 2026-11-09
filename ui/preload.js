const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sabir', {
  state: () => ipcRenderer.invoke('state'),
  action: (name, payload) => ipcRenderer.invoke('action', name, payload),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onEvent: (cb) => ipcRenderer.on('event', (_e, name, payload) => cb(name, payload)),
});

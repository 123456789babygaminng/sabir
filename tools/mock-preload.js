// Preload for tools/capture.js: serves fixed demo state instead of the live app.
const { contextBridge } = require('electron');
const arg = process.argv.find((a) => a.startsWith('--sabir-mock='));
const mock = JSON.parse(Buffer.from(arg.slice('--sabir-mock='.length), 'base64').toString('utf8'));
const listeners = [];
contextBridge.exposeInMainWorld('sabir', {
  state: async () => mock.state,
  action: async () => undefined,
  onState: () => {},
  onEvent: (cb) => { listeners.push(cb); if (mock.event) setTimeout(() => cb(mock.event[0], mock.event[1]), 0); },
});

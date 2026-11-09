// Renders the four screens offscreen with the demo data from the design artifact,
// at 2x, into test/capture/*.png. Run: electron tools/capture.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'test', 'capture');
const UI = path.join(__dirname, '..', 'ui');

const at = (hm) => { const d = new Date(); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };
const row = (time, agent, app, action, status) => ({ id: time + action, time: at(time), agent, app, action, status });
const agents = [
  { name: 'Claude', status: 'Active', configured: true },
  { name: 'Codex', status: 'Connected', configured: false },
  { name: 'Gemini CLI', status: 'Disconnected', configured: false },
];
const base = { version: '0.1.0', paused: false, agents, apps: [], permissions: [], activityCount: 7, config: { url: 'http://127.0.0.1:47821/mcp', setupDone: true, autostart: false, dataDir: '' } };

const pages = {
  main: {
    file: 'main.html', w: 980, h: 640,
    state: {
      ...base,
      agents: [agents[0], { ...agents[1] }, agents[2]],
      activity: [
        row('23:06', 'Claude', 'Excel', 'Sorted column C by date', 'Done'),
        row('23:05', 'Claude', 'Excel', 'Saved “Filter” as a tool', 'Discovered'),
        row('23:04', 'Claude', 'Excel', 'Opened “Q4 Revenue.xlsx”', 'Done'),
        row('23:01', 'Claude', 'Photoshop', 'Wants to use Photoshop', 'Permission'),
        row('22:58', 'Codex', 'Explorer', 'Created folder “Invoices”', 'Done'),
        row('22:57', 'Codex', 'Explorer', 'Moved 12 files', 'Done'),
        row('22:41', 'Codex', 'Spotify', 'Discovered “Create playlist”', 'Discovered'),
      ],
    },
  },
  tray: {
    file: 'tray.html', w: 380, h: 580,
    state: {
      ...base,
      working: { agent: 'Claude', appName: 'Excel', title: 'Sheet “Q4 Revenue”', at: Date.now() },
      activity: [
        row('23:06', 'Claude', 'Excel', 'Sorted column C by date', 'Done'),
        row('23:05', 'Claude', 'Excel', 'New function discovered: Filter', 'Discovered'),
        row('22:58', 'Codex', 'Explorer', 'Created folder “Invoices”', 'Done'),
      ],
    },
  },
  permission: {
    file: 'permission.html', w: 420, h: 250, state: base,
    event: ['perm:show', { id: 1, agent: 'Claude', appKey: 'photoshop', appName: 'Photoshop', firstTime: true, toolCount: 0 }],
  },
  setup: { file: 'setup.html', hash: 'step2', w: 680, h: 460, state: { ...base, activity: [] } },
};

async function capture(name, p) {
  const mock = Buffer.from(JSON.stringify({ state: p.state, event: p.event })).toString('base64');
  const win = new BrowserWindow({
    show: false, frame: false, transparent: true, useContentSize: true, width: p.w * 2, height: p.h * 2,
    webPreferences: { offscreen: true, zoomFactor: 2, preload: path.join(__dirname, 'mock-preload.js'), sandbox: false, contextIsolation: true, additionalArguments: ['--sabir-mock=' + mock] },
  });
  for (let i = 0; ; i++) {
    try { await win.loadFile(path.join(UI, p.file), p.hash ? { hash: p.hash } : undefined); break; }
    catch (e) { if (i > 2) throw e; await new Promise((r) => setTimeout(r, 500)); }
  }
  win.webContents.setZoomFactor(2);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400)))');
  // freeze the gear animation at its start so captures are comparable
  await win.webContents.insertCSS('.gA, .gB { animation: none !important; }');
  await new Promise((r) => setTimeout(r, 200));
  const img = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 5000);
    win.webContents.once('paint', (_e, _d, image) => { clearTimeout(t); resolve(image); });
    win.webContents.invalidate();
  });
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log(name, img.getSize());
  win.destroy();
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  setTimeout(() => app.exit(1), 90000);
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => pages[a]);
  for (const [name, p] of Object.entries(pages)) if (!only.length || only.includes(name)) await capture(name, p);
  app.quit();
});

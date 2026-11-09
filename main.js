// Sabir desktop app: tray, windows, MCP server, permission dialog.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, clipboard, nativeImage, shell } = require('electron');
const path = require('path');
const { Store } = require('./core/store');
const { Uia } = require('./core/uia');
const { Engine } = require('./core/engine');
const { McpServer } = require('./core/mcp');
const { Connector } = require('./core/connect');

const VERSION = require('./package.json').version;
const DATA_DIR = path.join(app.getPath('appData'), 'Sabir');
app.setPath('userData', path.join(DATA_DIR, 'Chromium'));
// Windows groups taskbar buttons and picks their large icon by this id; the Start menu
// shortcut below carries the same id and the exe icon, so the taskbar shows the Sabir logo.
const AUMID = 'Sabir.Desktop.App';
app.setAppUserModelId(AUMID);

const HIDDEN = process.argv.includes('--hidden');
const ASSETS = path.join(__dirname, 'assets');
const UI = path.join(__dirname, 'ui');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let store, uia, engine, mcp, connector, tray;
let mainWin = null, trayWin = null, permWin = null, setupWin = null;
let quitting = false;

// ---------- windows ----------
let iconCache = null;
function appIcon() {
  if (!iconCache) {
    iconCache = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
    if (iconCache.isEmpty()) logLine('[icon] could not load icon.png');
  }
  return iconCache;
}

function baseWindow(opts) {
  return new BrowserWindow({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    icon: appIcon(),
    webPreferences: { preload: path.join(UI, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    ...opts,
  });
}

function logLine(...a) {
  try { require('fs').appendFileSync(path.join(DATA_DIR, 'sabir.log'), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch {}
}

function lockDown(win) {
  win.webContents.on('console-message', (e) => {
    const lvl = e.level ?? '';
    if (lvl === 'warning' || lvl === 'error' || lvl === 2 || lvl === 3) logLine('[renderer]', win.getTitle(), e.message, e.sourceId || '', e.lineNumber || '');
  });
  win.webContents.on('render-process-gone', (_e, d) => logLine('[renderer gone]', win.getTitle(), d.reason));
  win.webContents.on('preload-error', (_e, p, err) => logLine('[preload]', p, err.message));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function openMain(pageName) {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = baseWindow({ width: 980, height: 640, title: 'Sabir', minimizable: true });
    lockDown(mainWin);
    mainWin.loadFile(path.join(UI, 'main.html'));
    mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
    mainWin.once('ready-to-show', () => { mainWin.show(); if (pageName) send(mainWin, 'event', 'go', pageName); });
  } else {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    if (pageName) send(mainWin, 'event', 'go', pageName);
  }
  hideTray();
}

let normalBounds = null;
function toggleMaximize(win) {
  if (normalBounds) {
    win.setBounds(normalBounds);
    normalBounds = null;
    win.webContents.executeJavaScript("document.body.classList.remove('max')");
  } else {
    normalBounds = win.getBounds();
    const wa = screen.getDisplayMatching(normalBounds).workArea;
    win.setBounds(wa);
    win.webContents.executeJavaScript("document.body.classList.add('max')");
  }
}

function createTrayWin() {
  trayWin = baseWindow({ width: 380, height: 580, skipTaskbar: true, alwaysOnTop: true, minimizable: false });
  lockDown(trayWin);
  trayWin.loadFile(path.join(UI, 'tray.html'));
  trayWin.on('blur', () => { trayHiddenAt = Date.now(); trayWin.hide(); });
}

let trayHiddenAt = 0;
function toggleTray() {
  if (!trayWin || trayWin.isDestroyed()) createTrayWin();
  if (trayWin.isVisible()) { trayWin.hide(); return; }
  if (Date.now() - trayHiddenAt < 250) return; // the click that blurred it
  const tb = tray.getBounds();
  const disp = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
  const wa = disp.workArea;
  const [w, h] = [380, 580];
  let x = Math.round(tb.x + tb.width / 2 - w / 2);
  let y = tb.y > wa.y + wa.height / 2 ? wa.y + wa.height - h - 8 : wa.y + 8;
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  trayWin.setPosition(x, y);
  trayWin.show();
  trayWin.focus();
}

function hideTray() { if (trayWin && !trayWin.isDestroyed() && trayWin.isVisible()) trayWin.hide(); }

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
  setupWin = baseWindow({ width: 680, height: 460, title: 'Sabir Setup', center: true });
  lockDown(setupWin);
  setupWin.loadFile(path.join(UI, 'setup.html'));
  setupWin.once('ready-to-show', () => setupWin.show());
  setupWin.on('closed', () => { setupWin = null; });
  hideTray();
}

// ---------- permission dialog ----------
const permQueue = [];
let permCurrent = null;
let permSeq = 1;

function askPermission(req) {
  return new Promise((resolve) => { permQueue.push({ req: { ...req, id: permSeq++ }, resolve }); pumpPerm(); });
}

function pumpPerm() {
  if (permCurrent || !permQueue.length) return;
  permCurrent = permQueue.shift();
  if (!permWin || permWin.isDestroyed()) {
    permWin = baseWindow({ width: 420, height: 250, skipTaskbar: true, alwaysOnTop: true, minimizable: false, title: 'Sabir Permission Request' });
    lockDown(permWin);
    permWin.on('close', (e) => { if (!quitting) { e.preventDefault(); answerPerm(permCurrent && permCurrent.req.id, 'deny'); } });
  }
  const show = () => {
    const wa = screen.getPrimaryDisplay().workArea;
    permWin.setPosition(wa.x + wa.width - 420 - 16, wa.y + wa.height - 250 - 16);
    send(permWin, 'event', 'perm:show', permCurrent.req);
    permWin.setAlwaysOnTop(true, 'pop-up-menu');
    permWin.showInactive();
  };
  if (permWin.webContents.getURL()) show();
  else { permWin.loadFile(path.join(UI, 'permission.html')); permWin.webContents.once('did-finish-load', show); }
  permCurrent.timer = setTimeout(() => answerPerm(permCurrent && permCurrent.req.id, 'timeout'), 120000);
}

function answerPerm(id, decision) {
  if (!permCurrent || permCurrent.req.id !== id) return;
  const c = permCurrent;
  permCurrent = null;
  clearTimeout(c.timer);
  if (permWin && !permWin.isDestroyed()) permWin.hide();
  c.resolve(decision);
  setTimeout(pumpPerm, 250);
}

// ---------- state ----------
let connCache = { at: 0, v: null };
function connections() {
  if (Date.now() - connCache.at > 4000) connCache = { at: Date.now(), v: connector.detect() };
  return connCache.v;
}

function buildState() {
  const now = Date.now();
  const conns = connections();
  const sessions = mcp.liveSessions();
  const names = ['Claude', 'Codex', 'Gemini CLI'];
  for (const s of sessions) if (!names.includes(s.agent)) names.push(s.agent);
  const agents = names.map((name) => {
    const last = engine.lastCall[name] || 0;
    const live = sessions.some((s) => s.agent === name && now - s.lastSeen < 30 * 60e3);
    const status = now - last < 90e3 ? 'Active' : (live || conns[name]) ? 'Connected' : 'Disconnected';
    return { name, status, configured: !!conns[name], live };
  });
  // agents in use come first, as in the tray design
  const rank = { Active: 0, Connected: 1, Disconnected: 2 };
  agents.sort((a, b) => rank[a.status] - rank[b.status] || names.indexOf(a.name) - names.indexOf(b.name));
  const working = engine.working && now - engine.working.at < 60e3 && !store.config.paused ? engine.working : null;
  const permissions = [];
  for (const [agent, apps] of Object.entries(store.permissions)) {
    for (const [appKey, p] of Object.entries(apps)) if (p.decision === 'always') permissions.push({ agent, appKey, appName: p.appName, at: p.at });
  }
  permissions.sort((a, b) => b.at - a.at);
  const apps = Object.entries(store.apps).map(([appKey, a]) => ({ appKey, appName: a.appName, tools: a.tools.length, lastUsed: a.lastUsed || a.learnedAt }))
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return {
    version: VERSION,
    paused: !!store.config.paused,
    working,
    agents,
    activity: store.activity.slice(-400).reverse(),
    activityCount: store.activity.length,
    apps,
    permissions,
    config: { url: mcp.url(), setupDone: !!store.config.setupDone, autostart: app.getLoginItemSettings().openAtLogin, dataDir: DATA_DIR },
  };
}

function send(win, channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

let pushTimer = null;
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const s = buildState();
    for (const w of [mainWin, trayWin, setupWin]) send(w, 'state', s);
    updateTrayTooltip(s);
  }, 80);
}

function updateTrayTooltip(s) {
  if (!tray) return;
  tray.setToolTip(s.paused ? 'Sabir · paused' : s.working ? `Sabir · ${s.working.agent} is working in ${s.working.appName}` : 'Sabir');
}

// ---------- IPC ----------
function senderWin(e) { return BrowserWindow.fromWebContents(e.sender); }

ipcMain.handle('state', () => buildState());
ipcMain.handle('action', async (e, name, payload) => {
  const win = senderWin(e);
  switch (name) {
    case 'window:minimize': win.minimize(); return;
    case 'window:maximize': toggleMaximize(win); return;
    case 'window:close': win.close(); return;
    case 'open:main': openMain(payload); return;
    case 'open:setup': openSetup(); return;
    case 'tray:hide': hideTray(); return;
    case 'pause:toggle': store.setConfig({ paused: !store.config.paused }); rebuildTrayMenu(); return;
    case 'perm:answer':
      if (win !== permWin) return; // only the dialog itself may answer
      answerPerm(payload.id, ['always', 'once', 'deny'].includes(payload.decision) ? payload.decision : 'deny');
      return;
    case 'perm:revoke': store.revokePermission(payload.agent, payload.appKey); return;
    case 'app:forget': store.forgetApp(payload); engine.emit('toolsChanged'); return;
    case 'connect':
      try { const done = await connector.connect(payload); connCache.at = 0; pushState(); return { message: 'Connected: ' + done.join(', ') + '. Restart the agent once.' }; }
      catch (err) { return { error: err.message }; }
    case 'snippet:copy': clipboard.writeText(connector.otherSnippet()); return { message: 'MCP config copied to the clipboard.' };
    case 'copy:url': clipboard.writeText(mcp.url()); return { message: 'Copied' };
    case 'activity:clear': store.clearActivity(); return { message: 'Log cleared.' };
    case 'settings:autostart':
      app.setLoginItemSettings({ openAtLogin: !!payload, args: ['--hidden'] });
      pushState();
      return;
    case 'setup:finish': store.setConfig({ setupDone: true }); if (setupWin) setupWin.close(); if (!mainWin || !mainWin.isVisible()) openMain('activity'); return;
    case 'setup:close': if (setupWin) setupWin.close(); return;
    default: return;
  }
});

// ---------- tray ----------
function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(null);
  trayMenu = Menu.buildFromTemplate([
    { label: 'Open Sabir', click: () => openMain('activity') },
    { label: store.config.paused ? 'Resume' : 'Pause', click: () => { store.setConfig({ paused: !store.config.paused }); rebuildTrayMenu(); } },
    { label: 'Setup…', click: () => openSetup() },
    { type: 'separator' },
    { label: 'Quit Sabir', click: () => { quitting = true; app.quit(); } },
  ]);
}
let trayMenu = null;

function createTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  img.addRepresentation({ scaleFactor: 2, buffer: require('fs').readFileSync(path.join(ASSETS, 'tray@2x.png')) });
  tray = new Tray(img);
  tray.setToolTip('Sabir');
  rebuildTrayMenu();
  tray.on('click', toggleTray);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu));
}

// ---------- shortcuts ----------
function ensureShortcuts() {
  const opts = { target: process.execPath, cwd: path.dirname(process.execPath), icon: process.execPath, iconIndex: 0, appUserModelId: AUMID, description: 'Sabir' };
  const places = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Sabir.lnk')];
  const desktop = path.join(app.getPath('desktop'), 'Sabir.lnk');
  if (require('fs').existsSync(desktop)) places.push(desktop); // only refresh a desktop shortcut that already exists
  for (const lnk of places) {
    try {
      let current = null;
      try { current = shell.readShortcutLink(lnk); } catch {}
      if (!current || current.target !== opts.target || current.appUserModelId !== AUMID) {
        shell.writeShortcutLink(lnk, current ? 'replace' : 'create', opts);
        logLine('[shortcut] wrote', lnk);
      }
    } catch (e) { logLine('[shortcut] failed', lnk, e.message); }
  }
}

// ---------- start ----------
app.on('second-instance', () => openMain());
app.on('window-all-closed', (e) => e.preventDefault()); // keep running in the tray
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { mcp && mcp.stop(); uia && uia.stop(); } catch {} });

app.whenReady().then(async () => {
  store = new Store(DATA_DIR);
  store.setConfig({
    launch: app.isPackaged ? { command: process.execPath, args: [] } : { command: process.execPath, args: [path.resolve(__dirname)] },
    version: VERSION,
  });
  uia = new Uia({ excludePids: [process.pid] });
  engine = new Engine({ store, uia, askPermission });
  mcp = new McpServer({ engine, store, version: VERSION });
  connector = new Connector({
    store,
    bridgePath: app.isPackaged ? path.join(process.resourcesPath, 'bridge', 'sabir-mcp.js') : path.join(__dirname, 'bridge', 'sabir-mcp.js'),
    runtime: process.execPath,
  });
  await mcp.start();
  if (app.isPackaged) ensureShortcuts();
  try { const moved = connector.refresh(); if (moved.length) logLine('[connect] updated', moved.join(', ')); } catch (e) { logLine('[connect] refresh failed', e.message); }
  uia.start();

  store.on('change', pushState);
  engine.on('working', pushState);
  engine.on('sessions', pushState);
  setInterval(pushState, 15000);

  createTray();
  createTrayWin();
  if (!store.config.setupDone) openSetup();
  else if (!HIDDEN) openMain('activity');
});


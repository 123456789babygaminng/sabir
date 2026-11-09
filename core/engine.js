// Sabir engine: learns apps via UI Automation, stores their functions as tools,
// enforces per-app permissions and writes every action to the activity log.
const { EventEmitter } = require('events');

const TRANSLIT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue' };

function slug(s, max = 40) {
  return String(s || '')
    .replace(/[äöüßÄÖÜ]/g, (c) => TRANSLIT[c])
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/, '');
}

function cleanLabel(s) {
  return String(s || '').replace(/\s*(\.\.\.|…)\s*$/, '').replace(/\s+/g, ' ').trim();
}

function quote(s, max = 48) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return '“' + (t.length > max ? t.slice(0, max - 1) + '…' : t) + '”';
}

const KIND_PREFIX = { click: '', set_text: 'set_', toggle: 'toggle_', select: 'select_', choose: 'choose_', set_value: 'set_' };

function toolsFromDiscovery(elements) {
  const tools = [];
  const ids = new Set();
  const seen = new Set();
  for (const e of elements) {
    if (!e.kind || e.controlType === 'Text') continue;
    const name = cleanLabel(e.name) || e.automationId;
    if (!name) continue;
    const menuPath = (e.menuPath || []).map(cleanLabel);
    const label = [...menuPath, name].join(' › ');
    const dedupeKey = e.kind + '|' + label;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    let id = (KIND_PREFIX[e.kind] || '') + (slug([...menuPath, name].join(' ')) || slug(e.automationId) || 'element');
    if (ids.has(id)) { let i = 2; while (ids.has(id + '_' + i)) i++; id = id + '_' + i; }
    ids.add(id);
    tools.push({
      id, label, kind: e.kind, controlType: e.controlType,
      locator: { name: e.name, automationId: e.automationId, controlType: e.controlType, ...(e.menuPath ? { menuPath: e.menuPath } : {}) },
      help: e.help || '',
    });
  }
  return tools;
}

function toolInputSchema(kind) {
  switch (kind) {
    case 'set_text': return { type: 'object', properties: { text: { type: 'string', description: 'Text to put into the field.' }, mode: { type: 'string', enum: ['replace', 'append'], description: 'replace (default) or append.' } }, required: ['text'] };
    case 'toggle': return { type: 'object', properties: { state: { type: 'string', enum: ['on', 'off'], description: 'Wanted state. Omit to flip.' } } };
    case 'choose': return { type: 'object', properties: { option: { type: 'string', description: 'Visible name of the option to choose.' } }, required: ['option'] };
    case 'set_value': return { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] };
    default: return { type: 'object', properties: {} };
  }
}

function toolVerb(t) {
  const where = t.locator.menuPath ? 'menu ' : '';
  switch (t.kind) {
    case 'set_text': return `Type text into ${quote(t.label)} (replaces its content unless mode=append).`;
    case 'toggle': return `Switch ${where}${quote(t.label)} on or off.`;
    case 'select': return `Select ${quote(t.label)}.`;
    case 'choose': return `Choose an option in ${quote(t.label)}.`;
    case 'set_value': return `Set the value of ${quote(t.label)}.`;
    default: return `Click ${where}${quote(t.label)}${t.controlType && !t.locator.menuPath ? ' (' + t.controlType.toLowerCase() + ')' : ''}.`;
  }
}

function agentFromClient(clientName) {
  const n = String(clientName || '').toLowerCase();
  if (n.includes('claude')) return 'Claude';
  if (n.includes('codex')) return 'Codex';
  if (n.includes('gemini')) return 'Gemini CLI';
  if (n.includes('cursor')) return 'Cursor';
  if (!n) return 'Agent';
  return clientName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s*(Mcp|Client)\b/gi, '').trim() || 'Agent';
}

const GENERIC_TOOLS = [
  {
    name: 'sabir_list_apps',
    description: 'List the Windows apps that are open right now, with their window titles, whether Sabir already learned them, and how many tools each has.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sabir_open_app',
    description: 'Start a Windows app, e.g. "notepad", "calc", "mspaint", "explorer" or a full .exe path. Asks the user for permission the first time.',
    inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'App name, command or path.' }, args: { type: 'string', description: 'Optional command line arguments.' } }, required: ['app'] },
  },
  {
    name: 'sabir_learn_app',
    description: 'Look at an open app\'s interface with Windows UI Automation and save every function found (buttons, menus, text fields, switches) as a reusable tool. Run once per app; run again if the app changed. Asks the user for permission the first time.',
    inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'App key or name from sabir_list_apps, e.g. "notepad".' } }, required: ['app'] },
  },
  {
    name: 'sabir_list_tools',
    description: 'List the saved tools of a learned app (tool id, kind, label). Call them with sabir_use_tool or directly as <app>__<tool id>.',
    inputSchema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
  },
  {
    name: 'sabir_use_tool',
    description: 'Run a saved tool of an app. Pass text for set_text tools, state ("on"/"off") for toggles, option for choose tools.',
    inputSchema: { type: 'object', properties: { app: { type: 'string' }, tool: { type: 'string', description: 'Tool id from sabir_list_tools.' }, text: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] }, state: { type: 'string', enum: ['on', 'off'] }, option: { type: 'string' }, value: { type: 'number' } }, required: ['app', 'tool'] },
  },
  {
    name: 'sabir_read_app',
    description: 'Read what an app window shows right now: texts, field values, button and list item names, checkbox states. Use it to check results.',
    inputSchema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
  },
  {
    name: 'sabir_act',
    description: 'Act on any element of an app by its visible name or automationId (for things that are not saved tools yet, e.g. list items seen with sabir_read_app). New functions found this way are saved as tools.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        name: { type: 'string', description: 'Visible name of the element.' },
        automationId: { type: 'string' },
        controlType: { type: 'string', description: 'Optional, e.g. Button, ListItem, Edit, MenuItem.' },
        action: { type: 'string', enum: ['click', 'set_text', 'append_text', 'toggle', 'select', 'choose', 'expand', 'collapse', 'focus', 'read'], description: 'Default: click.' },
        value: { type: 'string', description: 'Text for set_text/append_text, option for choose, on/off for toggle.' },
      },
      required: ['app'],
    },
  },
  {
    name: 'sabir_press_keys',
    description: 'Bring the app to the front and press keys. Syntax: ^ = Ctrl, % = Alt, + = Shift, {ENTER}, {TAB}, {ESC}, {F5}; e.g. "^s" saves. Prefer saved tools when they exist.',
    inputSchema: { type: 'object', properties: { app: { type: 'string' }, keys: { type: 'string' } }, required: ['app', 'keys'] },
  },
];

const ACTION_VERBS = { click: 'Clicked', toggle: 'Toggled', select: 'Selected', expand: 'Expanded', collapse: 'Collapsed', focus: 'Focused', read: 'Read' };

class ToolError extends Error {}

function prettyKeys(keys) {
  const mods = { '^': 'Ctrl+', '%': 'Alt+', '+': 'Shift+' };
  let out = '';
  const s = String(keys);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (mods[c]) { out += mods[c]; continue; }
    if (c === '{') { const j = s.indexOf('}', i + 1); if (j > i) { const k = s.slice(i + 1, j); out += k.charAt(0) + k.slice(1).toLowerCase() + ' '; i = j; continue; } }
    out += /\+$/.test(out) ? c.toUpperCase() : c;
  }
  return out.trim();
}

class Engine extends EventEmitter {
  constructor({ store, uia, askPermission }) {
    super();
    this.store = store;
    this.uia = uia;
    this.askPermission = askPermission; // async ({agent, appKey, appName, firstTime}) => 'always' | 'once' | 'deny'
    this.working = null;
    this.lastCall = {}; // agent -> time
    this.pendingPerms = new Map();
  }

  // ---------- helpers ----------
  appsByKey(windows) {
    const map = new Map();
    for (const w of windows) {
      if (!map.has(w.appKey)) map.set(w.appKey, { appKey: w.appKey, appName: w.appName, windows: [] });
      map.get(w.appKey).windows.push(w.title);
    }
    return map;
  }

  async resolveApp(appArg) {
    const q = String(appArg || '').trim().toLowerCase().replace(/\.exe$/, '');
    if (!q) throw new ToolError('Pass the app, e.g. "notepad". Call sabir_list_apps to see what is open.');
    const windows = await this.uia.call('windows');
    const apps = [...this.appsByKey(windows).values()];
    let hit = apps.find((a) => a.appKey === q) || apps.find((a) => a.appName.toLowerCase() === q)
      || apps.find((a) => slug(a.appKey) === slug(q))
      || apps.find((a) => a.appName.toLowerCase().includes(q) || a.appKey.includes(q));
    if (hit) return { appKey: hit.appKey, appName: hit.appName, open: true, title: hit.windows[0] };
    const learned = Object.entries(this.store.apps).find(([k, v]) => k === q || slug(k) === slug(q) || (v.appName || '').toLowerCase() === q || (v.aliases || []).includes(q));
    if (learned) return { appKey: learned[0], appName: learned[1].appName, open: false };
    return { appKey: slug(q, 60) || q, appName: q, open: false, unknown: true };
  }

  requireOpen(app) {
    if (!app.open) throw new ToolError(`${app.appName} is not open. Start it with sabir_open_app first.`);
  }

  checkPaused() {
    if (this.store.config.paused) throw new ToolError('Sabir is paused by the user. Try again later.');
  }

  markWorking(session, app, title) {
    this.lastCall[session.agent] = Date.now();
    this.working = { agent: session.agent, appName: app.appName, title: title || app.title || '', at: Date.now() };
    this.emit('working');
  }

  log(session, app, action, status = 'Done', detail) {
    return this.store.addActivity({ agent: session.agent, app: app.appName, appKey: app.appKey, action, status, ...(detail ? { detail } : {}) });
  }

  // ---------- permissions ----------
  async ensurePermission(session, app) {
    const p = this.store.getPermission(session.agent, app.appKey);
    if (p && p.decision === 'always') return true;
    if (session.allowedOnce.has(app.appKey)) return true;
    if (session.denied.has(app.appKey)) throw new ToolError(`The user denied access to ${app.appName} for this session.`);

    const key = session.agent + '|' + app.appKey;
    let pending = this.pendingPerms.get(key);
    if (!pending) {
      this.log(session, app, `Wants to use ${app.appName}`, 'Permission');
      const learned = this.store.getApp(app.appKey);
      pending = this.askPermission({ agent: session.agent, appKey: app.appKey, appName: app.appName, firstTime: !learned, toolCount: learned ? learned.tools.length : 0 })
        .finally(() => this.pendingPerms.delete(key));
      this.pendingPerms.set(key, pending);
    }
    const decision = await pending;
    if (decision === 'always') {
      if (!this.store.getPermission(session.agent, app.appKey)) {
        this.store.setPermission(session.agent, app.appKey, app.appName, 'always');
        this.log(session, app, `Allowed to use ${app.appName}`, 'Done', 'Always allow');
      }
      return true;
    }
    if (decision === 'once') {
      if (!session.allowedOnce.has(app.appKey)) {
        session.allowedOnce.add(app.appKey);
        this.log(session, app, `Allowed to use ${app.appName} once`, 'Done', 'Allow once');
      }
      return true;
    }
    if (!session.denied.has(app.appKey)) {
      session.denied.add(app.appKey);
      this.log(session, app, `Denied access to ${app.appName}`, 'Denied', decision === 'timeout' ? 'No answer within 2 minutes' : undefined);
    }
    throw new ToolError(`The user denied access to ${app.appName}.`);
  }

  // ---------- MCP tool surface ----------
  listTools() {
    const out = [...GENERIC_TOOLS];
    const apps = Object.entries(this.store.apps).sort((a, b) => (b[1].lastUsed || b[1].learnedAt || 0) - (a[1].lastUsed || a[1].learnedAt || 0));
    let budget = 300;
    for (const [appKey, app] of apps) {
      for (const t of app.tools) {
        if (budget-- <= 0) break;
        out.push({
          name: this.mcpName(appKey, t.id),
          description: `${app.appName}: ${toolVerb(t)}${t.help ? ' ' + t.help : ''}`,
          inputSchema: toolInputSchema(t.kind),
        });
      }
    }
    return out;
  }

  mcpName(appKey, toolId) {
    return (slug(appKey, 20) + '__' + toolId).slice(0, 64);
  }

  findDynamic(name) {
    for (const [appKey, app] of Object.entries(this.store.apps)) {
      for (const t of app.tools) if (this.mcpName(appKey, t.id) === name) return { appKey, tool: t };
    }
    return null;
  }

  async callTool(session, name, args = {}) {
    switch (name) {
      case 'sabir_list_apps': return this.listApps(session);
      case 'sabir_open_app': return this.openApp(session, args.app, args.args);
      case 'sabir_learn_app': return this.learnApp(session, args.app);
      case 'sabir_list_tools': return this.listAppTools(args.app);
      case 'sabir_use_tool': return this.useTool(session, args.app, args.tool, args);
      case 'sabir_read_app': return this.readApp(session, args.app);
      case 'sabir_act': return this.actAdHoc(session, args);
      case 'sabir_press_keys': return this.pressKeys(session, args.app, args.keys);
      default: {
        const dyn = this.findDynamic(name);
        if (!dyn) throw new ToolError(`Unknown tool ${name}.`);
        return this.useTool(session, dyn.appKey, dyn.tool.id, args);
      }
    }
  }

  async listApps(session) {
    const windows = await this.uia.call('windows');
    const apps = [...this.appsByKey(windows).values()];
    const lines = apps.map((a) => {
      const learned = this.store.getApp(a.appKey);
      const perm = this.store.getPermission(session.agent, a.appKey);
      return `- ${a.appKey} (${a.appName}): ${a.windows.slice(0, 3).map((t) => quote(t, 60)).join(', ')}` +
        (learned ? ` · learned, ${learned.tools.length} tools` : ' · not learned yet') +
        (perm ? ' · always allowed' : '');
    });
    const closed = Object.entries(this.store.apps).filter(([k]) => !apps.some((a) => a.appKey === k));
    if (closed.length) lines.push('', 'Learned but not open: ' + closed.map(([k, v]) => `${k} (${v.appName})`).join(', '));
    return lines.join('\n') || 'No app windows are open.';
  }

  async openApp(session, target, args) {
    this.checkPaused();
    if (!target) throw new ToolError('Pass the app to open, e.g. "notepad".');
    const known = await this.resolveApp(target);
    const app = { appKey: known.appKey, appName: known.unknown ? target : known.appName };
    await this.ensurePermission(session, app);
    const launchTarget = known.unknown || !known.open ? (this.store.apps[known.appKey]?.exe || target) : target;
    this.markWorking(session, app);
    let res;
    try {
      res = await this.uia.call('launch', { target: launchTarget, ...(args ? { args } : {}) }, 20000);
    } catch (e) {
      this.log(session, app, `Could not open ${app.appName}`, 'Failed', e.message);
      throw new ToolError(`Could not open ${target}: ${e.message}`);
    }
    const w = res.window;
    if (w) {
      const real = { appKey: w.appKey, appName: w.appName };
      if (real.appKey !== app.appKey) {
        // the command (e.g. "calc") started a differently named process: carry the user's answer over
        const p = this.store.getPermission(session.agent, app.appKey);
        if (p && p.decision === 'always') this.store.setPermission(session.agent, real.appKey, real.appName, 'always');
        if (session.allowedOnce.has(app.appKey)) session.allowedOnce.add(real.appKey);
        if (this.store.apps[real.appKey]) {
          const aliases = new Set(this.store.apps[real.appKey].aliases || []);
          aliases.add(String(target).toLowerCase());
          this.store.apps[real.appKey].aliases = [...aliases];
          this.store.saveApps();
        }
      }
      this.markWorking(session, real, w.title);
      this.log(session, real, `Opened ${real.appName}`);
      const learned = this.store.getApp(real.appKey);
      return `Opened ${real.appName} (app key "${real.appKey}", window ${quote(w.title)}). ` +
        (learned ? `Sabir knows ${learned.tools.length} tools for it; see sabir_list_tools.` : 'Call sabir_learn_app to discover its functions.');
    }
    this.log(session, app, `Started ${app.appName}`);
    return `Started ${target}, but no new window appeared within 10 seconds. Check sabir_list_apps.`;
  }

  async learnApp(session, appArg) {
    this.checkPaused();
    const app = await this.resolveApp(appArg);
    this.requireOpen(app);
    await this.ensurePermission(session, app);
    this.markWorking(session, app);
    let d;
    try {
      d = await this.uia.call('discover', { app: app.appKey }, 90000);
    } catch (e) {
      this.log(session, app, `Could not look at ${app.appName}`, 'Failed', e.message);
      throw new ToolError(e.message);
    }
    const before = this.store.getApp(app.appKey);
    const tools = toolsFromDiscovery(d.elements);
    // keep tools saved earlier via sabir_act that the scan did not see (e.g. inside dialogs)
    if (before) for (const t of before.tools) if (t.adHoc && !tools.some((x) => x.id === t.id)) tools.push(t);
    const fresh = before ? tools.filter((t) => !before.tools.some((b) => b.id === t.id)).length : tools.length;
    this.store.saveAppTools(app.appKey, { appName: app.appName, exe: d.window.exe, process: d.window.process }, tools);
    this.log(session, app, before ? `Relearned ${app.appName}: ${tools.length} functions (${fresh} new)` : `Discovered ${tools.length} functions`, 'Discovered');
    this.emit('toolsChanged');
    const lines = tools.map((t) => `- ${this.mcpName(app.appKey, t.id)}  [${t.kind}] ${t.label}`);
    return `Learned ${app.appName}: ${tools.length} tools (scanned ${d.scanned} elements, ${d.menuItems} menu items).\n` +
      `Call them directly by name (if your client refreshed its tool list) or via sabir_use_tool with app="${app.appKey}" and tool=<id after "__">.\n` + lines.join('\n');
  }

  listAppTools(appArg) {
    const q = String(appArg || '').toLowerCase();
    const entry = Object.entries(this.store.apps).find(([k, v]) => k === q || slug(k) === slug(q) || (v.appName || '').toLowerCase() === q || (v.aliases || []).includes(q));
    if (!entry) throw new ToolError(`Sabir has not learned "${appArg}" yet. Open it and call sabir_learn_app.`);
    const [appKey, app] = entry;
    return `${app.appName} (${appKey}), ${app.tools.length} tools:\n` + app.tools.map((t) => `- ${t.id}  [${t.kind}] ${t.label}`).join('\n');
  }

  async useTool(session, appArg, toolId, args = {}) {
    this.checkPaused();
    const app = await this.resolveApp(appArg);
    const learned = this.store.getApp(app.appKey);
    if (!learned) throw new ToolError(`Sabir has not learned ${app.appName} yet. Call sabir_learn_app first.`);
    const tool = learned.tools.find((t) => t.id === toolId) || learned.tools.find((t) => this.mcpName(app.appKey, t.id) === toolId);
    if (!tool) throw new ToolError(`${app.appName} has no tool "${toolId}". See sabir_list_tools.`);
    this.requireOpen(app);
    await this.ensurePermission(session, app);
    this.markWorking(session, app);
    let action = tool.kind;
    let value;
    if (tool.kind === 'set_text') { value = args.text ?? args.value ?? ''; if (args.mode === 'append') action = 'append_text'; }
    if (tool.kind === 'toggle') value = args.state;
    if (tool.kind === 'choose') value = args.option ?? args.value;
    if (tool.kind === 'set_value') value = args.value;
    const res = await this.runAct(session, app, tool.locator, action, value, this.describe(tool, action, value));
    this.store.touchApp(app.appKey);
    return res;
  }

  describe(tool, action, value) {
    if (action === 'set_text') return `Typed ${quote(value, 40)} into ${tool.label}`;
    if (action === 'append_text') return `Added ${quote(value, 40)} to ${tool.label}`;
    if (action === 'choose') return `Chose ${quote(value)} in ${tool.label}`;
    if (action === 'set_value') return `Set ${tool.label} to ${value}`;
    if (action === 'toggle') return `Switched ${quote(tool.label)}${value ? ' ' + value : ''}`;
    return `${ACTION_VERBS[action] || 'Used'} ${quote(tool.label)}`;
  }

  async runAct(session, app, locator, action, value, description) {
    let res;
    try {
      res = await this.uia.call('act', { app: app.appKey, locator, action, ...(value !== undefined && value !== null ? { value: String(value) } : {}) }, 30000);
    } catch (e) {
      this.log(session, app, description, 'Failed', e.message);
      throw new ToolError(e.message);
    }
    this.markWorking(session, app, res.window && res.window.title);
    this.log(session, app, description);
    const r = res.result;
    if (action === 'read') return `${res.element}: ${r}`;
    return `${description} — ${r}. Window: ${quote(res.window.title, 80)}. Use sabir_read_app to check the result.`;
  }

  async readApp(session, appArg) {
    this.checkPaused();
    const app = await this.resolveApp(appArg);
    this.requireOpen(app);
    await this.ensurePermission(session, app);
    this.markWorking(session, app);
    let r;
    try { r = await this.uia.call('read', { app: app.appKey }, 30000); }
    catch (e) { this.log(session, app, 'Read the window', 'Failed', e.message); throw new ToolError(e.message); }
    this.log(session, app, `Read ${quote(r.window.title, 40)}`);
    const lines = r.elements.map((e) => {
      let s = `[${e.type}] ${e.name || ''}`;
      if (e.automationId && !/^\d+$/.test(e.automationId)) s += ` (id: ${e.automationId})`;
      if (e.value !== undefined && e.value !== e.name) s += ` = ${JSON.stringify(e.value)}`;
      if (e.state) s += ` [${e.state}]`;
      if (e.selected) s += ' [selected]';
      if (e.disabled) s += ' [disabled]';
      return s;
    });
    return `Window ${quote(r.window.title, 100)} of ${app.appName}:\n` + lines.join('\n');
  }

  async actAdHoc(session, args) {
    this.checkPaused();
    const app = await this.resolveApp(args.app);
    this.requireOpen(app);
    if (!args.name && !args.automationId) throw new ToolError('Pass the element name or automationId.');
    await this.ensurePermission(session, app);
    this.markWorking(session, app);
    const action = args.action || 'click';
    const locator = { name: args.name || '', automationId: args.automationId || '', controlType: args.controlType || '' };
    const label = cleanLabel(args.name || args.automationId);
    const pseudo = { label, kind: action, locator, controlType: args.controlType };
    const res = await this.runAct(session, app, locator, action, args.value, this.describe(pseudo, action, args.value));
    // remember stable, reusable functions (not list content) as tools
    const learned = this.store.getApp(app.appKey);
    const kind = { click: 'click', toggle: 'toggle', set_text: 'set_text', append_text: 'set_text', choose: 'choose', select: 'select' }[action];
    if (learned && kind && args.controlType && !/ListItem|TreeItem|DataItem|Text/i.test(args.controlType)) {
      const id = (KIND_PREFIX[kind] || '') + slug(label);
      const added = id && this.store.addTool(app.appKey, { id, label, kind, controlType: args.controlType, locator, help: '', adHoc: true });
      if (added) {
        this.log(session, app, `Saved ${quote(label)} as a tool`, 'Discovered');
        this.emit('toolsChanged');
      }
    }
    return res;
  }

  async pressKeys(session, appArg, keys) {
    this.checkPaused();
    const app = await this.resolveApp(appArg);
    this.requireOpen(app);
    if (!keys) throw new ToolError('Pass keys, e.g. "^s".');
    await this.ensurePermission(session, app);
    this.markWorking(session, app);
    const pretty = prettyKeys(keys);
    try {
      const r = await this.uia.call('keys', { app: app.appKey, keys });
      this.markWorking(session, app, r.window.title);
      this.log(session, app, `Pressed ${pretty}`);
      return `Pressed ${keys} in ${quote(r.window.title, 80)}.`;
    } catch (e) {
      this.log(session, app, `Pressed ${pretty}`, 'Failed', e.message);
      throw new ToolError(e.message);
    }
  }
}

module.exports = { Engine, ToolError, agentFromClient, slug, toolsFromDiscovery, GENERIC_TOOLS };

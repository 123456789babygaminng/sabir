// Persistent state: config, learned apps/tools, permissions, activity log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAX_ACTIVITY = 2000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.files = {
      config: path.join(dir, 'config.json'),
      apps: path.join(dir, 'apps.json'),
      permissions: path.join(dir, 'permissions.json'),
      activity: path.join(dir, 'activity.jsonl'),
    };
    this.config = readJson(this.files.config, {});
    if (!this.config.token) this.config.token = crypto.randomBytes(24).toString('hex');
    if (!this.config.port) this.config.port = 47821;
    if (this.config.paused === undefined) this.config.paused = false;
    this.apps = readJson(this.files.apps, {});
    this.permissions = readJson(this.files.permissions, {});
    this.activity = this.loadActivity();
    this.saveConfig();
  }

  loadActivity() {
    try {
      const lines = fs.readFileSync(this.files.activity, 'utf8').split('\n').filter(Boolean);
      const items = lines.slice(-MAX_ACTIVITY).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (lines.length > MAX_ACTIVITY * 1.5) fs.writeFileSync(this.files.activity, items.map((i) => JSON.stringify(i)).join('\n') + '\n');
      return items;
    } catch { return []; }
  }

  changed(what) { this.emit('change', what); }

  saveConfig() { writeJson(this.files.config, this.config); }
  setConfig(patch) { Object.assign(this.config, patch); this.saveConfig(); this.changed('config'); }

  saveApps() { writeJson(this.files.apps, this.apps); this.changed('apps'); }
  savePermissions() { writeJson(this.files.permissions, this.permissions); this.changed('permissions'); }

  // ---- activity ----
  addActivity(entry) {
    const item = { id: crypto.randomUUID(), time: Date.now(), status: 'Done', ...entry };
    this.activity.push(item);
    if (this.activity.length > MAX_ACTIVITY) this.activity.splice(0, this.activity.length - MAX_ACTIVITY);
    fs.appendFileSync(this.files.activity, JSON.stringify(item) + '\n');
    this.changed('activity');
    return item;
  }

  clearActivity() {
    this.activity = [];
    fs.writeFileSync(this.files.activity, '');
    this.changed('activity');
  }

  // ---- permissions: per agent, per app ----
  getPermission(agent, appKey) {
    return (this.permissions[agent] || {})[appKey] || null;
  }

  setPermission(agent, appKey, appName, decision) {
    if (!this.permissions[agent]) this.permissions[agent] = {};
    this.permissions[agent][appKey] = { decision, appName, at: Date.now() };
    this.savePermissions();
  }

  revokePermission(agent, appKey) {
    if (this.permissions[agent]) delete this.permissions[agent][appKey];
    this.savePermissions();
  }

  // ---- learned apps ----
  getApp(appKey) { return this.apps[appKey] || null; }

  saveAppTools(appKey, info, tools) {
    const prev = this.apps[appKey] || {};
    this.apps[appKey] = { ...prev, ...info, tools, learnedAt: Date.now(), lastUsed: prev.lastUsed || null };
    this.saveApps();
    return this.apps[appKey];
  }

  addTool(appKey, tool) {
    const app = this.apps[appKey];
    if (!app) return false;
    if (app.tools.some((t) => t.id === tool.id)) return false;
    app.tools.push(tool);
    this.saveApps();
    return true;
  }

  touchApp(appKey) {
    if (this.apps[appKey]) { this.apps[appKey].lastUsed = Date.now(); writeJson(this.files.apps, this.apps); }
  }

  forgetApp(appKey) { delete this.apps[appKey]; this.saveApps(); }
}

module.exports = { Store };

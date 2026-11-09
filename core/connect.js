// Detects and writes the MCP configuration of supported agents.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function readText(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }

function backupOnce(f) {
  try { if (fs.existsSync(f) && !fs.existsSync(f + '.sabir-backup')) fs.copyFileSync(f, f + '.sabir-backup'); } catch {}
}

function claudeDesktopConfigs() {
  const list = [path.join(APPDATA, 'Claude', 'claude_desktop_config.json')];
  try {
    for (const d of fs.readdirSync(path.join(LOCALAPPDATA, 'Packages'))) {
      if (/^Claude_/i.test(d)) list.push(path.join(LOCALAPPDATA, 'Packages', d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
    }
  } catch {}
  return list;
}

const PATHS = {
  claudeCode: path.join(HOME, '.claude.json'),
  codex: path.join(HOME, '.codex', 'config.toml'),
  gemini: path.join(HOME, '.gemini', 'settings.json'),
};

class Connector {
  constructor({ store, bridgePath, runtime }) {
    this.store = store;
    this.bridgePath = bridgePath; // path to bridge/sabir-mcp.js
    this.runtime = runtime;       // exe that runs the bridge with ELECTRON_RUN_AS_NODE=1
  }

  httpConfig() {
    return { type: 'http', url: `http://127.0.0.1:${this.store.config.port}/mcp`, headers: { Authorization: `Bearer ${this.store.config.token}` } };
  }

  stdioConfig(agent) {
    return { command: this.runtime, args: [this.bridgePath], env: { ELECTRON_RUN_AS_NODE: '1', ...(agent ? { SABIR_AGENT: agent } : {}) } };
  }

  detect() {
    const cc = readJson(PATHS.claudeCode);
    const claudeCode = !!(cc && cc.mcpServers && cc.mcpServers.sabir);
    const claudeDesktop = claudeDesktopConfigs().some((f) => { const j = readJson(f); return !!(j && j.mcpServers && j.mcpServers.sabir); });
    const codexToml = readText(PATHS.codex) || '';
    const gem = readJson(PATHS.gemini);
    return {
      Claude: claudeCode || claudeDesktop,
      Codex: /^\s*\[mcp_servers\.sabir\]/m.test(codexToml),
      'Gemini CLI': !!(gem && gem.mcpServers && gem.mcpServers.sabir),
      details: { claudeCode, claudeDesktop },
    };
  }

  async connect(agent) {
    if (agent === 'Claude') return this.connectClaude();
    if (agent === 'Codex') return this.connectCodex();
    if (agent === 'Gemini CLI') return this.connectGemini();
    throw new Error('Unknown agent ' + agent);
  }

  async connectClaude() {
    const done = [];
    // Claude Code: user-scope HTTP server via its CLI
    const json = JSON.stringify(this.httpConfig());
    const cli = await new Promise((resolve) => {
      execFile('claude', ['mcp', 'add-json', '--scope', 'user', 'sabir', json], { shell: false, windowsHide: true, timeout: 30000 }, (err) => resolve(!err));
    });
    if (cli) done.push('Claude Code');
    else {
      const cc = readJson(PATHS.claudeCode);
      if (cc) {
        backupOnce(PATHS.claudeCode);
        cc.mcpServers = cc.mcpServers || {};
        cc.mcpServers.sabir = this.httpConfig();
        fs.writeFileSync(PATHS.claudeCode, JSON.stringify(cc, null, 2));
        done.push('Claude Code');
      }
    }
    // Claude Desktop: stdio bridge
    for (const f of claudeDesktopConfigs()) {
      if (!fs.existsSync(path.dirname(f))) continue;
      const j = readJson(f) || {};
      backupOnce(f);
      j.mcpServers = j.mcpServers || {};
      j.mcpServers.sabir = this.stdioConfig('Claude');
      fs.writeFileSync(f, JSON.stringify(j, null, 2));
      if (!done.includes('Claude Desktop')) done.push('Claude Desktop');
    }
    if (!done.length) throw new Error('Neither Claude Code nor Claude Desktop was found.');
    return done;
  }

  async connectCodex() {
    fs.mkdirSync(path.dirname(PATHS.codex), { recursive: true });
    let toml = readText(PATHS.codex) || '';
    if (/^\s*\[mcp_servers\.sabir\]/m.test(toml)) return ['Codex'];
    backupOnce(PATHS.codex);
    toml += (toml && !toml.endsWith('\n') ? '\n' : '') + '\n' + this.codexSection();
    fs.writeFileSync(PATHS.codex, toml);
    return ['Codex'];
  }

  async connectGemini() {
    fs.mkdirSync(path.dirname(PATHS.gemini), { recursive: true });
    const j = readJson(PATHS.gemini) || {};
    backupOnce(PATHS.gemini);
    j.mcpServers = j.mcpServers || {};
    j.mcpServers.sabir = this.stdioConfig('Gemini CLI');
    fs.writeFileSync(PATHS.gemini, JSON.stringify(j, null, 2));
    return ['Gemini CLI'];
  }

  // Existing Sabir entries follow the app when it moves (e.g. from the dev folder to Sabir.exe)
  // or when port/token change. Only entries named "sabir" are touched.
  refresh() {
    const changed = [];
    const sameStdio = (e, agent) => e && e.command === this.runtime && JSON.stringify(e.args) === JSON.stringify([this.bridgePath]) && e.env && e.env.SABIR_AGENT === agent;
    for (const f of claudeDesktopConfigs()) {
      const j = readJson(f);
      if (j && j.mcpServers && j.mcpServers.sabir && !sameStdio(j.mcpServers.sabir, 'Claude')) {
        j.mcpServers.sabir = this.stdioConfig('Claude');
        fs.writeFileSync(f, JSON.stringify(j, null, 2));
        changed.push(f);
      }
    }
    const gem = readJson(PATHS.gemini);
    if (gem && gem.mcpServers && gem.mcpServers.sabir && !sameStdio(gem.mcpServers.sabir, 'Gemini CLI')) {
      gem.mcpServers.sabir = this.stdioConfig('Gemini CLI');
      fs.writeFileSync(PATHS.gemini, JSON.stringify(gem, null, 2));
      changed.push(PATHS.gemini);
    }
    const toml = readText(PATHS.codex);
    if (toml && /^\s*\[mcp_servers\.sabir\]/m.test(toml)) {
      const section = this.codexSection();
      const next = toml.replace(/^\[mcp_servers\.sabir\]\r?\n(?:(?!\[)[^\n]*\n?)*/m, section + '\n');
      if (next !== toml) { fs.writeFileSync(PATHS.codex, next); changed.push(PATHS.codex); }
    }
    const cc = readJson(PATHS.claudeCode);
    if (cc && cc.mcpServers && cc.mcpServers.sabir && cc.mcpServers.sabir.type === 'http') {
      const want = this.httpConfig();
      if (JSON.stringify(cc.mcpServers.sabir) !== JSON.stringify(want)) {
        const opts = { windowsHide: true, timeout: 30000 };
        execFile('claude', ['mcp', 'remove', '--scope', 'user', 'sabir'], opts, () =>
          execFile('claude', ['mcp', 'add-json', '--scope', 'user', 'sabir', JSON.stringify(want)], opts, () => {}));
        changed.push(PATHS.claudeCode);
      }
    }
    return changed;
  }

  codexSection() {
    const lit = (s) => `'${s}'`; // TOML literal string: backslashes stay as they are
    const c = this.stdioConfig('Codex');
    return '[mcp_servers.sabir]\n' +
      `command = ${lit(c.command)}\n` +
      `args = [${c.args.map(lit).join(', ')}]\n` +
      `env = { ELECTRON_RUN_AS_NODE = "1", SABIR_AGENT = "Codex" }\n`;
  }

  otherSnippet() {
    return JSON.stringify({ mcpServers: { sabir: this.stdioConfig() } }, null, 2) +
      '\n\n// Or, for clients with Streamable HTTP support:\n' + JSON.stringify({ mcpServers: { sabir: this.httpConfig() } }, null, 2);
  }
}

module.exports = { Connector };

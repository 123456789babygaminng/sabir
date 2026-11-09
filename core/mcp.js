// MCP server (Streamable HTTP, JSON-RPC 2.0) on 127.0.0.1.
const http = require('http');
const crypto = require('crypto');
const { ToolError, agentFromClient } = require('./engine');

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = [
  'Sabir lets you operate Windows desktop apps through Windows UI Automation, also apps without an API.',
  'Typical flow: sabir_list_apps -> sabir_open_app (if needed) -> sabir_learn_app (once per app) -> call the learned tools',
  '(named <app>__<function>, or via sabir_use_tool) -> sabir_read_app to check the result.',
  'The user approves each app the first time you use it; if denied, do not retry.',
].join(' ');

class McpServer {
  constructor({ engine, store, version }) {
    this.engine = engine;
    this.store = store;
    this.version = version;
    this.sessions = new Map();
    this.server = null;
    engine.on('toolsChanged', () => this.broadcast({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
  }

  async start() {
    let port = this.store.config.port;
    for (let i = 0; i < 20; i++, port++) {
      try {
        await new Promise((resolve, reject) => {
          const srv = http.createServer((req, res) => this.handle(req, res).catch((e) => {
            try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } catch {}
          }));
          srv.once('error', reject);
          srv.listen(port, '127.0.0.1', () => { this.server = srv; resolve(); });
        });
        if (port !== this.store.config.port) this.store.setConfig({ port });
        return port;
      } catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
      }
    }
    throw new Error('No free port for the MCP server.');
  }

  stop() { try { this.server && this.server.close(); } catch {} }

  url() { return `http://127.0.0.1:${this.store.config.port}/mcp`; }

  liveSessions() { return [...this.sessions.values()]; }

  broadcast(msg) {
    const data = `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
    for (const s of this.sessions.values()) if (s.sse) { try { s.sse.write(data); } catch {} }
  }

  async readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) throw new Error('Body too large'); chunks.push(c); }
    return Buffer.concat(chunks).toString('utf8');
  }

  async handle(req, res) {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
      res.writeHead(403); res.end('Forbidden origin'); return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Sabir', version: this.version, pid: process.pid }));
      return;
    }
    if (url.pathname !== '/mcp') { res.writeHead(404); res.end(); return; }
    const auth = req.headers.authorization || '';
    const token = this.store.config.token;
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!given || given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: Sabir token missing or wrong. Reconnect the agent in Sabir.' }, id: null }));
      return;
    }
    const sid = req.headers['mcp-session-id'];

    if (req.method === 'GET') {
      const s = sid && this.sessions.get(sid);
      if (!s) { res.writeHead(sid ? 404 : 400); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': sabir\n\n');
      s.sse = res;
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25000);
      req.on('close', () => { clearInterval(ka); if (s.sse === res) s.sse = null; });
      return;
    }
    if (req.method === 'DELETE') {
      if (sid && this.sessions.has(sid)) { this.sessions.delete(sid); this.engine.emit('sessions'); }
      res.writeHead(200); res.end(); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST, DELETE' }); res.end(); return; }

    let body;
    try { body = JSON.parse(await this.readBody(req)); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
      return;
    }
    const batch = Array.isArray(body);
    const msgs = batch ? body : [body];
    const isInit = msgs.some((m) => m && m.method === 'initialize');
    let session = sid ? this.sessions.get(sid) : null;
    if (!isInit && !session) {
      res.writeHead(sid ? 404 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: sid ? 'Session not found' : 'Missing Mcp-Session-Id' }, id: null }));
      return;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (isInit) {
      const init = msgs.find((m) => m.method === 'initialize');
      const client = (init.params && init.params.clientInfo) || {};
      const override = req.headers['x-sabir-agent'];
      session = {
        id: crypto.randomUUID(),
        clientName: client.name || 'unknown',
        clientVersion: client.version || '',
        agent: override ? String(override).slice(0, 40) : agentFromClient(client.name),
        created: Date.now(),
        lastSeen: Date.now(),
        sse: null,
        allowedOnce: new Set(),
        denied: new Set(),
      };
      this.sessions.set(session.id, session);
      headers['Mcp-Session-Id'] = session.id;
      this.engine.emit('sessions');
    }
    session.lastSeen = Date.now();

    const replies = [];
    for (const m of msgs) {
      if (!m || typeof m !== 'object' || !m.method) continue; // responses from client: ignore
      const reply = await this.dispatch(session, m);
      if (m.id !== undefined && m.id !== null) replies.push(reply);
    }
    if (replies.length === 0) { res.writeHead(202, headers); res.end(); return; }
    res.writeHead(200, headers);
    res.end(JSON.stringify(batch ? replies : replies[0]));
  }

  async dispatch(session, m) {
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    const err = (code, message) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
    try {
      switch (m.method) {
        case 'initialize': {
          const asked = m.params && m.params.protocolVersion;
          return ok({
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'sabir', title: 'Sabir', version: this.version },
            instructions: INSTRUCTIONS,
          });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: this.engine.listTools() });
        case 'resources/list': return ok({ resources: [] });
        case 'resources/templates/list': return ok({ resourceTemplates: [] });
        case 'prompts/list': return ok({ prompts: [] });
        case 'tools/call': {
          const name = m.params && m.params.name;
          const args = (m.params && m.params.arguments) || {};
          try {
            const text = await this.engine.callTool(session, name, args);
            return ok({ content: [{ type: 'text', text: String(text) }] });
          } catch (e) {
            const msg = e instanceof ToolError ? e.message : `Sabir error: ${e.message}`;
            return ok({ content: [{ type: 'text', text: msg }], isError: true });
          }
        }
        default:
          if (m.method.startsWith('notifications/')) return null;
          return err(-32601, `Method not found: ${m.method}`);
      }
    } catch (e) {
      return err(-32603, e.message);
    }
  }
}

module.exports = { McpServer };

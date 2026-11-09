// Minimal MCP client over the stdio bridge: initialize, list tools, list apps.
const { spawn } = require('child_process');
const path = require('path');
const p = spawn(process.execPath, [path.join(__dirname, '..', 'bridge', 'sabir-mcp.js')], { env: { ...process.env, SABIR_AGENT: process.env.SABIR_AGENT || '' } });
let buf = '', id = 0; const waits = {};
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(l); if (m.id && waits[m.id]) waits[m.id](m); else console.log('notify', l); } });
p.stderr.on('data', (d) => process.stderr.write(d));
const rpc = (method, params) => new Promise((r) => { const i = ++id; waits[i] = r; p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: process.argv[2] || 'sabir-smoke', version: '1' } });
  console.log('init', JSON.stringify(init.result.serverInfo), init.result.protocolVersion);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tl = await rpc('tools/list', {});
  console.log('tools', tl.result.tools.length, tl.result.tools.slice(0, 9).map((t) => t.name).join(', '));
  const la = await rpc('tools/call', { name: 'sabir_list_apps', arguments: {} });
  console.log(la.result.content[0].text.slice(0, 1200));
  p.stdin.end();
})();

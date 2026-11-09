#!/usr/bin/env node
// stdio <-> HTTP bridge for MCP clients that only start local commands (Codex, Gemini CLI, Claude Desktop).
// Run with node, or with Sabir's own runtime: ELECTRON_RUN_AS_NODE=1 Sabir.exe sabir-mcp.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const CFG = path.join(process.env.APPDATA || '', 'Sabir', 'config.json');
const AGENT = process.env.SABIR_AGENT || '';

function cfg() { return JSON.parse(fs.readFileSync(CFG, 'utf8')); }
function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function logErr(...a) { process.stderr.write('[sabir-bridge] ' + a.join(' ') + '\n'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sessionId = null;
let initMsg = null;
let initPromise = null;
let sseAbort = null;

async function healthy() {
  try {
    const c = cfg();
    const r = await fetch(`http://127.0.0.1:${c.port}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function ensureRunning() {
  if (await healthy()) return true;
  let c;
  try { c = cfg(); } catch { return false; }
  if (c.launch && c.launch.command) {
    logErr('Sabir is not running, starting it');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawn(c.launch.command, [...(c.launch.args || []), '--hidden'], { detached: true, stdio: 'ignore', env, windowsHide: false });
    p.unref();
    for (let i = 0; i < 40; i++) { await sleep(500); if (await healthy()) return true; }
  }
  return false;
}

async function post(msg) {
  const c = cfg();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${c.token}` };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (AGENT) headers['X-Sabir-Agent'] = AGENT;
  return fetch(`http://127.0.0.1:${c.port}/mcp`, { method: 'POST', headers, body: JSON.stringify(msg) });
}

async function forward(res) {
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (res.status === 202) return;
  const text = await res.text();
  if (!text) return;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) if (line.startsWith('data:')) out(JSON.parse(line.slice(5)));
    return;
  }
  const body = JSON.parse(text);
  if (Array.isArray(body)) body.forEach(out); else out(body);
}

async function reinitialize() {
  sessionId = null;
  const r = await post(initMsg);
  const sid = r.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  await r.text();
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  startSse();
}

async function send(msg, retried = false) {
  try {
    const res = await post(msg);
    if (res.status === 404 && initMsg && msg.method !== 'initialize' && !retried) {
      await reinitialize(); // Sabir restarted: open a fresh session and retry
      return send(msg, true);
    }
    await forward(res);
    if (msg.method === 'initialize') startSse();
  } catch (e) {
    if (!retried && (await ensureRunning())) {
      if (msg.method !== 'initialize' && initMsg) await reinitialize().catch(() => {});
      return send(msg, true);
    }
    if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Sabir is not running. Start Sabir and try again.' } });
  }
}

async function startSse() {
  if (sseAbort) sseAbort.abort();
  const ctrl = new AbortController();
  sseAbort = ctrl;
  (async () => {
    while (!ctrl.signal.aborted) {
      try {
        const c = cfg();
        const res = await fetch(`http://127.0.0.1:${c.port}/mcp`, { headers: { Accept: 'text/event-stream', Authorization: `Bearer ${c.token}`, 'Mcp-Session-Id': sessionId }, signal: ctrl.signal });
        if (!res.ok || !res.body) { await sleep(3000); continue; }
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
            if (data) { try { out(JSON.parse(data)); } catch {} }
          }
        }
      } catch { if (ctrl.signal.aborted) return; }
      await sleep(2000);
    }
  })();
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    initMsg = msg;
    initPromise = (async () => { await ensureRunning(); await send(msg); })();
    return;
  }
  (initPromise || Promise.resolve()).then(() => send(msg));
});
rl.on('close', async () => {
  if (sseAbort) sseAbort.abort();
  try {
    if (sessionId) {
      const c = cfg();
      await fetch(`http://127.0.0.1:${c.port}/mcp`, { method: 'DELETE', headers: { Authorization: `Bearer ${c.token}`, 'Mcp-Session-Id': sessionId }, signal: AbortSignal.timeout(1500) });
    }
  } catch {}
  process.exit(0);
});

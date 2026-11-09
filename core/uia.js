// Talks to the SabirUia.exe helper (Windows UI Automation) over JSON lines.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function helperPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'uia', 'SabirUia.exe'),
    path.join(__dirname, '..', 'uia', 'dist', 'SabirUia.exe'),
  ];
  for (const p of candidates) if (p && fs.existsSync(p)) return p;
  throw new Error('SabirUia.exe not found. Run: npm run build:uia');
}

class Uia {
  constructor({ excludePids = [] } = {}) {
    this.excludePids = excludePids;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.queue = Promise.resolve();
  }

  start() {
    if (this.proc) return;
    const proc = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
    });
    proc.stderr.on('data', () => {});
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('UI Automation helper stopped.')); }
      this.pending.clear();
    });
  }

  // Calls run one at a time: UI Automation work on the same app must not interleave.
  call(cmd, args = {}, timeoutMs = 30000) {
    const run = () => new Promise((resolve, reject) => {
      this.start();
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UI Automation timed out (${cmd}).`));
        // a hung helper would block the queue: restart it
        try { this.proc && this.proc.kill(); } catch {}
        this.proc = null;
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args: { exclude: this.excludePids, ...args } }) + '\n');
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() { try { this.proc && this.proc.kill(); } catch {} this.proc = null; }
}

module.exports = { Uia };
